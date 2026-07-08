## Idea Vault — Version 5 Implementation Notes

---

## Backend Summary (Interview-Focused)

Version 5 added production-safe collection management and hardened idea image lifecycle behavior.

Most relevant backend themes:
- user-scoped authorization on every collection/image mutation
- ownership validation before writes
- safe handling of malformed legacy image data
- indexed query paths for common filters

---

## Collections: Flat Categorisation

### Why
Ideas needed a simple, user-friendly way to be grouped without introducing heavy hierarchy management.

Nested folders were intentionally avoided. Flat collections reduce query and mutation complexity while preserving practical grouping.

### Feature definition
A Collection is a named group an idea can belong to.
- One idea can belong to one collection or none (uncategorised).
- Collections are user-scoped.
- No nested collections.

### Data model
MongoDB collection: collections

Document shape:
- _id: ObjectId
- userId: string
- name: string
- emoji: string
- color: string (hex)
- createdAt: datetime
- updatedAt: datetime

Ideas were extended with:
- collectionId: Optional string (Mongo ObjectId as string), null for uncategorised

### Security model
All collection operations are authenticated and user-scoped.
- Every endpoint uses Depends(get_current_user).
- Every read/write query includes userId filtering.
- Collection IDs from URL/body are never trusted without ownership validation.

This prevents cross-user access even if someone guesses a valid ObjectId.

---

## Collections API: Full CRUD

### Canonical endpoints
- POST /api/collections
- GET /api/collections
- PUT /api/collections/{id}
- DELETE /api/collections/{id}

Additional read endpoint:
- GET /api/collections/get/{id}

### Behavior details
Create:
- Validates name, emoji, color.
- Enforces case-insensitive unique collection names per user.

List:
- Returns only current user's collections.
- Includes ideaCount per collection.

Update:
- Partial update supported (name/emoji/color optional).
- Name uniqueness check excludes current collection record.

Delete:
- Soft unlink is enforced.
- Ideas are never cascade-deleted when a collection is deleted.

Soft unlink flow:
1. Update matching ideas to collectionId = None
2. Delete the collection document

---

## Ideas API Integration: Collection Filtering

### What changed
GET ideas now supports optional collection filtering.

Route support:
- GET /api/ideas
- GET /api/ideas/list

New query parameter:
- collectionId

Filter rules:
- collectionId=<objectId> returns ideas in that collection
- collectionId=none returns uncategorised ideas only (collectionId is null)

Validation:
- Invalid ObjectId values for collectionId filter return 400

### Create and update idea integration
Idea create/update now validates collection assignment:
- collectionId must be a valid ObjectId string
- collection must belong to the current user
- invalid or foreign collectionId is rejected

Update supports explicit uncategorisation:
- collectionId null clears the assignment

---

## Ideas API Integration: Image Upload/Delete Hardening

### Endpoints
- POST /api/ideas/image
- DELETE /api/ideas/{idea_id}/image

### Security and correctness behavior
- Auth required and ownership enforced on delete (403 for non-owner).
- 404 for missing idea, 400 when no image is set.
- Cloudinary public_id extraction supports multiple URL shapes.
- Malformed/non-Cloudinary imageUrl values are handled safely:
	- database imageUrl is still cleared
	- request returns 204 (no user-visible failure)
	- structured warning/error is logged for audit/debug
- External CDN deletion is best-effort; DB state is the source of truth for UX consistency.

### Why this matters
This prevents brittle 500s from legacy/corrupt imageUrl data and keeps delete operations idempotent and production-safe.

---

## Agent Runtime Hardening (Production Bug Fix)

### Bug observed
`POST /api/agent` intermittently failed with a 500 when provider responses returned an empty or null `choices` payload.
{ The AI agent returned "Internal Server Error" because the question did not match any of the saved ideas. }

Representative failure:
- `TypeError: 'NoneType' object is not subscriptable`
- crash point: `response.choices[0]` in agent execution flow

### Root cause
The service assumed every successful completion call always contained at least one choice. Under transient provider/proxy edge cases, this assumption was invalid.

### Fix implemented
- Added defensive guards before indexing `response.choices` in both:
	- main agent completion turn
	- proposal-summary completion turn
- Added structured logging when no choices are returned.
- Added graceful fallback user message instead of raising unhandled exceptions.

### Why this matters
This converts a provider-side transient anomaly into a controlled degraded response, preserving API uptime and preventing user-facing 500s.

---

## Pydantic Schemas Added/Updated

### New file
- backend/app/schemas/collection.py
	- CollectionCreate
	- CollectionUpdate
	- CollectionResponse (with ideaCount)

### Updated file
- backend/app/schemas/idea.py
	- Added optional collectionId to IdeaCreate, IdeaUpdate, IdeaResponse, IdeaInDB
	- imageUrl remains optional and is used by image upload/delete flow

Validation highlights:
- Collection name trimmed, required, max length 50
- Color must be valid hex (example: #6366f1)

---

## Database and Indexing Updates

MongoDB connection bootstrap now creates:
- ideas index on userId
- ideas compound index on (userId, collectionId)
- collections index on userId

This keeps user-scoped lookups and collection-filtered idea queries fast and aligned with query patterns.

---

## Files Changed

- backend/app/api/collections.py
- backend/app/api/ideas.py
- backend/app/schemas/collection.py
- backend/app/schemas/idea.py
- backend/app/db/mongodb.py
- backend/app/services/image_service.py
- backend/app/services/agentic_ai/agent_service.py
- backend/app/main.py

---

## Validation and Current Status

### Completed checks
- Backend modules compile successfully after changes.
- Collections CRUD routes are wired into FastAPI.
- Soft unlink logic on delete is implemented.
- Ideas collectionId filtering is implemented.
- Image delete endpoint is resilient to malformed stored URLs and clears DB state reliably.
- Agent endpoint no longer crashes when LLM provider returns empty/null `choices`.

### Notes on Swagger verification
Implementation is complete and wired for the required flow.
Manual API acceptance checklist:
- create/list/update/delete collection
- assign and clear collectionId on idea update
- filter ideas by collectionId and by none
- upload image, delete image, verify imageUrl clears
- test delete image with malformed imageUrl value and confirm 204 + cleanup
- call `/api/agent` with normal prompts and verify graceful response even when upstream completion payload has empty/null choices

---

## Unified AI Chat Endpoint: One Door, Two Brains

> This section is written to be read start-to-finish by someone new to the codebase.
> It explains not just *what* was built, but *why* each decision was made and what
> alternatives were rejected. Take your time with it.

### The problem in plain English

Before this change, the app had **two separate AI features**, each with its own URL:

1. `POST /api/chat` — the **"read"** assistant. You ask a question about your ideas
   ("what are my fitness ideas?", "how many ideas do I have?") and it answers in
   plain text, streamed word-by-word like ChatGPT. Internally this is a **RAG**
   pipeline (explained below).
2. `POST /api/agent` — the **"write"** assistant. You ask it to *change* something
   ("improve my first idea", "add a task to my meal-prep idea") and it replies with
   **proposals** — suggested edits that you must approve before anything is saved.

The problem: **the frontend had to know in advance which one to call.** A user just
types a sentence into a chat box. They don't think "this is a read request" or "this
is a write request" — they just talk. Forcing the UI (or the user) to pick the right
endpoint is fragile and leaks backend structure into the frontend.

**The goal:** create a single endpoint, `POST /api/ai/chat`, that the frontend always
calls. The *backend* decides whether the message is a read or a write, and routes it
to the correct pipeline automatically.

### Background you need first (skip if you already know this)

**What is RAG?**
RAG = "Retrieval-Augmented Generation". Instead of letting the LLM answer from its
own memory (which knows nothing about *your* ideas), we first **retrieve** the user's
relevant ideas from the database, paste them into the prompt as context, and then ask
the LLM to **generate** an answer using that context. It's how the assistant can talk
about *your* private data without that data ever being part of the model's training.

**What is "the agent"?**
The agent is an LLM that has been given **tools** (functions it can call), like
`propose_idea_update` or `propose_task_creation`. When you ask it to change something,
it doesn't edit the database directly — it produces a **proposal** object describing
the change. A human approves or rejects it later. This "human-in-the-loop" design is a
safety feature: the AI can *suggest* writes, but never *performs* them on its own.

**What is SSE (Server-Sent Events)?**
A normal HTTP response sends the whole body at once. SSE keeps the connection open and
streams many small messages over time, each line starting with `data: `. We use it so
the read assistant can show its answer appearing token-by-token instead of making the
user stare at a spinner until the full answer is ready.

**What is "intent classification"?**
Asking a small, fast LLM to read a sentence and output a single label describing what
the user *wants* (e.g. `COUNT`, `LISTING`). It's a cheap way to make routing decisions.

### The core idea: classify first, then route

The new endpoint does three things in order:

1. **Rate-limit** the user (reject abusive volumes before spending any money on LLM calls).
2. **Classify** the message into one of two buckets: `AGENT_WRITE` or `AGENT_READ`.
3. **Route**:
   - `AGENT_WRITE` → run the agent → return **JSON** with proposals.
   - `AGENT_READ` → run the RAG pipeline → return an **SSE stream** of text.

```mermaid
flowchart TD
    A[POST /api/ai/chat<br/>message + JWT] --> B[Rate limit check<br/>20/hour per user]
    B -->|over limit| Z[429 Too Many Requests]
    B -->|ok| C[classify_chat_route]
    C -->|AGENT_WRITE| D[run_agent]
    D --> E[JSON response<br/>mode=agent, message, proposals]
    C -->|AGENT_READ| F[stream_rag_sse]
    F --> G[SSE stream<br/>mode, status, thinking, text, done]
```

### Decision 1 — A separate "routing brain", NOT an extension of the existing one

The existing read pipeline already has an intent classifier with an enum called
`QueryIntent` (`CONVERSATIONAL`, `LISTING`, `SEMANTIC_SEARCH`, `COUNT`). The obvious
shortcut would be: "just add two more values, `AGENT_WRITE` and `AGENT_READ`, to that
same enum."

**We deliberately did NOT do that.** Here's why:

`QueryIntent` is consumed by other functions deep inside the RAG pipeline —
`route_query` (decides which database lookup to run) and `select_tier_for_intent`
(decides which LLM model size to use). Those functions have a hard assumption: *every*
`QueryIntent` value is a kind of read. If we added `AGENT_WRITE` to that enum, every
one of those functions would suddenly receive a value it has no idea how to handle. We'd
have to hunt down and patch each one, and we'd risk subtle bugs where a write intent
accidentally flows into read-only retrieval code.

So instead we created a **brand-new, separate enum** called `ChatRoute` with exactly two
values (`AGENT_WRITE`, `AGENT_READ`) and a separate function `classify_chat_route()`.
This is a coarser, higher-level decision that sits *above* the existing one:

- `classify_chat_route()` decides **which pipeline** (agent vs RAG).
- The old `classify_intent()` still runs *inside* the RAG pipeline to decide **how to
  read** (count vs list vs search).

This is a general principle worth remembering: **when a new concept doesn't fit the
assumptions of an existing type, make a new type rather than overloading the old one.**
Overloading saves three lines today and costs you a week of debugging later.

### Decision 2 — Regex fast-path first, LLM second (a hybrid classifier)

How does `classify_chat_route()` actually decide write vs read? There were three options:

- **Option A: pure keyword/regex matching.** Fast and free, but brittle. The sentence
  "I have ideas about *improving* my sleep" contains the word "improve" but is clearly a
  *read*, not a command to edit anything. Pure keywords produce false positives.
- **Option B: pure LLM classification.** Accurate, but every single message — including
  trivial ones like "improve my first idea" — costs an LLM call and adds latency.
- **Option C (chosen): a hybrid.** First run a *very conservative* regex that only
  matches obvious, unambiguous write commands. If it matches, we're done instantly — no
  LLM call. If it doesn't match, fall back to a small/fast LLM that makes the final call.

The regex (`_WRITE_FASTPATH`) is intentionally **high-precision, low-recall**: it would
rather miss a real write (and let the LLM catch it) than wrongly flag a read. That's why
it requires the action verb to sit *next to* a reference to the user's content. For
example it matches "improve **my idea**" or "rewrite **the description**", but it will
**not** match "ideas about improving sleep", because "improve" there isn't followed by
words like *idea / task / description / it / my*.

Anything the regex isn't sure about goes to the LLM, which is given a focused prompt with
worked examples and must answer with just `AGENT_WRITE` or `AGENT_READ`.

**The safety net:** if the LLM is rate-limited, returns nothing, or returns garbage, we
default to `AGENT_READ`. Why read and not write? Because the read path is non-destructive
— the worst case is the user gets an answer instead of a proposal, which is mildly
annoying. Defaulting to *write* could surface confusing, unwanted edit suggestions.
**When in doubt, pick the safer behavior.**

### Decision 3 — Two different response *shapes*, on purpose

This endpoint is unusual: it can return **two completely different types of HTTP response**
depending on the route.

- **Write** → a normal JSON object:
  `{"mode": "agent", "message": "...", "proposals": [ ... ]}`
- **Read** → an SSE stream (`Content-Type: text/event-stream`).

Why not force both into the same shape? Because they have genuinely different needs. A set
of proposals is a *finished, structured object* — the UI needs all of it at once to render
review cards with Accept/Reject buttons. A conversational answer is *a flow of text* that
feels best when streamed live. Forcing proposals into a stream, or buffering the chat answer
into one big JSON blob, would make both worse.

So the frontend tells the two apart by looking at the response's `Content-Type` header:
`application/json` means "agent proposals", `text/event-stream` means "live chat".

To make the streaming case even easier for the client, the **very first SSE event** we send
is `{"type": "mode", "content": "rag"}`. This way the frontend instantly knows "this is a
read stream" without waiting or guessing.

One small but important detail: proposals contain enum values (like idea status/priority).
Python's default JSON serializer can't handle enums, so we serialize with
`model_dump(mode="json")`, which converts enums into plain strings. (This is the kind of bug
that only shows up at runtime, so it's worth knowing.)

### Decision 4 — Share code, don't copy-paste

Both the old `/api/chat` and the new `/api/ai/chat` need the *exact same* read behavior
(rate limiting + the RAG streaming logic). Copy-pasting that logic into two files would mean
every future bug fix has to be made twice — and someone will eventually forget. So we pulled
the shared pieces into their own small modules:

- `app/core/rate_limit.py` → `check_message_rate_limit()`. Both endpoints call this. Because
  they share the **same Redis key** (`chat_rl:{user_id}`), a user can't dodge the limit by
  hopping between endpoints — all their AI usage counts against one budget.
- `app/ai/chat_pipeline.py` → `stream_rag_sse()` and `format_sse()`. This is now the single
  source of truth for "decompose the question → fetch the user's ideas → stream the answer as
  SSE". The old `/api/chat` was refactored to call this instead of holding its own copy.

This is the **DRY principle** ("Don't Repeat Yourself"): one behavior should live in exactly
one place.

### Decision 5 — Keep the old endpoints, but mark them deprecated

We did **not** delete `/api/chat` and `/api/agent`. Anything still calling them (the current
frontend, saved bookmarks, tests) would break instantly if we removed them. Instead we marked
them with `deprecated=True`, which:

- keeps them fully working, and
- visibly flags them as "old" in the auto-generated API docs (Swagger),

so we can migrate the frontend calmly and delete them in a later cleanup pass. This is the
standard, professional way to retire an API: **deprecate first, remove later.** Note that
`/api/agent/decide` (the Accept/Reject approval step) is **not** deprecated — the unified
endpoint only replaces the *propose* and *ask* steps, not the approval step.

### Security guarantees (these were preserved, not invented)

The new endpoint follows the same rules every protected route in this app follows:

- **`user_id` always comes from the verified JWT, never from the request body.** A user
  physically cannot ask about or edit someone else's ideas, because the identity is taken from
  their signed token, not from anything they typed.
- **Input is length-capped** at the HTTP boundary (`ChatRequest`, max 500 chars) and *again*
  inside the classifier (truncated to 200 chars). This is "defence in depth" — limiting the
  blast radius of any prompt-injection attempt.
- **Rate limiting runs before any LLM call**, so abusive traffic is rejected for free.

### The request/response contract (what the frontend must handle)

Request (identical for both routes):
```
POST /api/ai/chat
Authorization: Bearer <jwt>
Body: { "message": "..." }   // 1–500 characters
```

Response — write route:
```
Content-Type: application/json
{ "mode": "agent", "message": "Here are my suggestions", "proposals": [ {...}, {...} ] }
```

Response — read route:
```
Content-Type: text/event-stream
data: {"type": "mode",     "content": "rag"}
data: {"type": "status",   "content": "Searching your ideas..."}
data: {"type": "thinking", "content": "..."}
data: {"type": "text",     "content": "Your"}
data: {"type": "text",     "content": " ideas"}
data: {"type": "done",     "content": ""}
```

### Files changed

New files:
- `backend/app/api/ai.py` — the unified `POST /api/ai/chat` endpoint.
- `backend/app/ai/chat_pipeline.py` — shared RAG-to-SSE streaming helper (`stream_rag_sse`, `format_sse`).
- `backend/app/core/rate_limit.py` — shared per-user rate limiter (`check_message_rate_limit`).

Updated files:
- `backend/app/services/intent_classifier.py` — added `ChatRoute` enum, `_WRITE_FASTPATH` regex, and `classify_chat_route()`.
- `backend/app/api/chat.py` — refactored to use the shared helpers; marked `deprecated=True`.
- `backend/app/api/agent.py` — propose endpoint marked `deprecated=True` (approval endpoint untouched).
- `backend/app/main.py` — registered the new `ai` router under `/api`.

### How to verify it works

1. Send `POST /api/ai/chat` with `{"message": "what are my ideas?"}` →
   expect `Content-Type: text/event-stream`, a leading `mode: rag` event, then streamed text.
2. Send `POST /api/ai/chat` with `{"message": "improve my first idea"}` →
   expect `Content-Type: application/json` with `"mode": "agent"` and a `proposals` array.
3. Send 21 messages within an hour → the 21st should return `429`.
4. Confirm the old `/api/chat` and `/api/agent` still respond but appear struck-through /
   marked deprecated in Swagger.

---

## Topic Guardrails: Keeping the Assistant On-Topic

> Like the section above, this is written to be read start-to-finish by a beginner.
> It explains the problem, every option we considered, why we rejected the tempting-but-
> dangerous one, and exactly what we built. Go slowly — the *reasoning* matters more than
> the code.

### The problem in plain English

Idea Vault's assistant is meant to talk about **one thing only: your own saved ideas and
tasks.** But because it is powered by a general-purpose LLM, it was happy to do things it
was never meant to do:

1. **Answer general-knowledge questions** — "what is the capital of France?", "explain
   quantum physics", "who won the World Cup in 2018?". The model just knows these, so it
   answered them. That makes the product feel like a generic ChatGPT clone instead of a
   focused idea companion.
2. **Write code** — "give me Python code to reverse a number". Again, the model can do
   this, so it did. But Idea Vault is not a coding tool.

We wanted two specific behaviors instead:

- Off-topic question → politely refuse with one fixed sentence:
  *"I can only help you with your saved ideas and tasks in Idea Vault."*
- "Write me code" request → politely refuse with a different fixed sentence:
  *"I don't write code. I can help you think through the idea behind it though."*

### The trap: the "obvious" solution is the wrong one

The tempting fix is a **keyword blocklist**: keep a list of banned words/phrases like
`"write a"`, `"javascript"`, `"who is"`, `"history of"`, `"python code"`, and if the user's
message contains any of them, refuse.

This is fast, free, and **dangerously wrong**. A blocklist looks only at the *letters* in
the sentence, not its *meaning*. Watch how each banned phrase destroys a perfectly valid,
on-topic request:

| Banned phrase | Innocent message it would wrongly block |
|---|---|
| `"javascript"` | "I have an idea for a **JavaScript** learning app" |
| `"who is"` | "**Who is** my target audience for this idea?" |
| `"history of"` | "What's the **history of** my fitness idea?" |
| `"write a"` | "Help me **write a** better description for my idea" |

Every one of those is exactly the kind of thing the assistant *should* help with — and the
blocklist would slam the door on all of them. This is called a **false positive**: blocking
something that should have been allowed. For a feature whose whole job is to be helpful about
ideas, false positives are the worst possible failure. **A guardrail that blocks real work is
worse than no guardrail at all.**

So the guiding rule for this whole feature became: **be strict about refusing off-topic and
code requests, but never at the cost of blocking a genuine idea conversation.**

### The solution: three layers, each catching what the others miss

Rather than one crude filter, we built **three layers of defense**. Each layer is good at a
different thing, and they back each other up. Think of it like airport security: a quick metal
detector for the obvious stuff, a trained officer for judgment calls, and clear posted rules as
the final backstop.

```mermaid
flowchart TD
    A[User message] --> L1{Layer 1<br/>Code-request regex<br/>zero LLM cost}
    L1 -->|clear code request| R1["Refuse: I don't write code..."]
    L1 -->|not a clear code request| L2{Layer 2<br/>LLM intent classifier}
    L2 -->|OUT_OF_SCOPE| R2["Refuse: I can only help with your ideas..."]
    L2 -->|about their ideas| L3[Layer 3<br/>Strict rules baked into<br/>every system prompt]
    L3 --> ANS[Normal helpful answer<br/>grounded in the user's ideas]
```

Let's walk through each layer and *why* it exists.

### Layer 1 — A tiny, ultra-precise code detector (costs nothing)

**What it is:** a single regular expression (a text-pattern matcher) that runs *before any AI
call at all*. If it fires, we instantly return the code refusal and stop. No LLM, no latency,
no cost. This lives in `is_code_generation_request()` in `intent_classifier.py`.

**Why have it at all, if Layer 2 already catches off-topic stuff?** Two reasons:

1. **Speed and cost.** "Give me Python code to reverse a number" is *obviously* a code
   request. Spending an LLM call to figure that out is wasteful. A regex answers in
   microseconds for free.
2. **A hard guarantee.** Because this runs first and doesn't depend on a model behaving well,
   it is a deterministic promise: the clearest code requests are *always* refused, even if the
   AI were having a bad day.

**The critical design choice: high precision, low recall.** Remember the false-positive trap.
We deliberately made this regex *picky* — it would rather **miss** a code request (and let
Layer 2 catch it) than **wrongly flag** an idea conversation. It only fires when the message is
unmistakably asking the assistant to *produce code*. Concretely, it triggers on things like:

- a "make" verb sitting right next to the word **code** — "write code", "give me python **code**"
- a programming language glued to a code word — "python **script**", "bash **code**"
- "**code** to / that / for ..." — "**code** to reverse a string"
- inherently-code words — "**one-liner**", "**pseudocode**"
- "debug / refactor **my code**"

And — just as important — it is built to **stay silent** on things that merely *sound*
technical but are really idea talk:

- "do I have any **coding** ideas?" → allowed
- "what should I **build** for my app idea?" → allowed
- "I have an idea for a **JavaScript** learning app" → allowed
- "I want a **script** for a short film idea" → allowed (a film script, not code!)

We verified this with a test of 31 sentences: **all 15 real code requests were caught, and all
16 innocent idea messages were let through.** Zero false positives.

> **One sharp edge worth remembering** (this is the kind of bug that wastes an afternoon): the
> regex is written in "verbose mode", where a `#` character normally starts a comment. The
> language `c#` therefore had to be escaped as `c\#`, otherwise Python silently treats the rest
> of the line as a comment and the pattern fails to build. Tools like `compileall` won't catch
> this because the regex is only *built* when the code actually runs.

### Layer 2 — Let a small AI use *judgment*, not keywords

Layer 1 only handles code. What about "what is the capital of France?" That's not code, so
Layer 1 ignores it — and we still need to refuse it.

Here's the key insight: **the problem with the keyword blocklist was never that it used a
computer to decide — it was that keywords can't understand meaning.** So for the harder
"is this even about their ideas?" question, we use the thing that *can* understand meaning: an
LLM, used as a **classifier**.

The app already had a small, fast classifier (`classify_intent`) that sorts read questions into
buckets — `CONVERSATIONAL`, `LISTING`, `SEMANTIC_SEARCH`, `COUNT`. We added one more bucket:
**`OUT_OF_SCOPE`**. Now the classifier's job includes deciding "is this message about the
user's own ideas, or is it something from the outside world?"

Because it judges *meaning*, it can make the distinction a blocklist never could:

- "do I have any **coding** ideas?" → `SEMANTIC_SEARCH` (about their ideas — answer it)
- "what's the **history of** my fitness idea?" → `SEMANTIC_SEARCH` (about their idea — answer it)
- "what is the **capital of France**?" → `OUT_OF_SCOPE` (outside world — refuse)
- "explain **quantum physics**" → `OUT_OF_SCOPE` (outside world — refuse)

We also fixed a subtle hole we found along the way. The old classifier description for
`CONVERSATIONAL` literally said *"general questions not about ideas"* — which was quietly giving
the assistant permission to answer trivia as "small talk". We tightened it: `CONVERSATIONAL` now
means **only** greetings and chit-chat aimed at the assistant ("hi", "thanks", "what can you
do?"). Anything from the outside world goes to `OUT_OF_SCOPE`.

**What happens when a message is `OUT_OF_SCOPE`?** The pipeline short-circuits: it immediately
sends the fixed scope refusal and **skips the expensive answer-generation step entirely.** This
is the "intercept at the classifier level" behavior — we don't waste a big LLM call generating
an answer we're just going to throw away. The off-topic message is stopped at the cheap front
gate, not the expensive back room.

> **A nice property for mixed messages:** if someone asks two things at once — "hi, and what's
> the capital of France?" — the idea-related part always wins the routing, so we never
> accidentally refuse a message that contains *some* legitimate request. Pure off-topic messages
> are the only ones that get refused.

### Layer 3 — Write the rules into the assistant's "job description"

Layers 1 and 2 are gatekeepers that run *before* the main assistant. Layer 3 is different: it's a
set of **hard rules baked into the system prompt** — the hidden instructions the LLM reads before
every single answer. Think of it as the assistant's employment contract.

We created one shared rules block (`STRICT_GUARDRAILS`) and injected it into **every** generation
prompt — the read assistant (RAG) *and* the write assistant (the agent). In plain language, the
rules say:

1. Only ever discuss the user's own saved ideas and tasks.
2. Never write, complete, or debug code — in any language — even if asked directly.
3. Never answer general-knowledge questions.
4. Discussing the *concept* behind a coding idea is fine; writing the actual code is not.
5. If a request is off-topic, reply with exactly the scope-refusal sentence.
6. If a request is to write code, reply with exactly the code-refusal sentence.

**Why do we need this if Layers 1 and 2 already exist?** Because no gatekeeper is perfect. A
cleverly-worded request might slip past the regex and get mislabeled by the classifier. Layer 3 is
the **last line of defense**: even if a bad request reaches the main assistant, the assistant's own
instructions tell it to refuse. Defense in depth means *every* layer would have to fail at once for
a bad answer to get through — which is far less likely than any single layer failing.

Notice rule 4 — it captures the most important nuance of the whole feature: **talking about a
coding idea is encouraged; writing the code is forbidden.** "What should I build for my app idea?"
gets a thoughtful, helpful answer. "Write the app's login function" gets refused. Same topic,
different action.

### Why three layers instead of just one?

Each layer covers a different weakness of the others:

| Layer | Strength | Weakness (covered by...) |
|---|---|---|
| 1. Regex | Instant, free, guaranteed for obvious code | Only knows code, not meaning → Layer 2 |
| 2. LLM classifier | Understands meaning, catches all off-topic | Costs a small call; can occasionally misjudge → Layer 3 |
| 3. System-prompt rules | Always present, final backstop | Relies on the big model obeying → Layers 1 & 2 catch most first |

Crucially, **none of the three layers is the keyword blocklist we rejected.** The cheap layer
(regex) is deliberately narrow enough to never block idea talk, and the broad decisions are made by
*meaning-aware* AI judgment. That is the whole point: we got strictness **without** the false
positives.

### The two refusal messages (kept identical everywhere)

There are exactly two fixed responses, defined once as constants and reused by all three layers so
the wording can never drift apart:

- **Off-topic:** "I can only help you with your saved ideas and tasks in Idea Vault."
- **Code request:** "I don't write code. I can help you think through the idea behind it though."

Refusals are delivered to the browser as a normal streamed assistant message, so to the user they
look just like any other reply in the chat — no scary error popups, no broken UI.

### Files changed

Updated files:
- `backend/app/services/intent_classifier.py` — added the two refusal constants
  (`SCOPE_REFUSAL`, `CODE_REFUSAL`), the shared `STRICT_GUARDRAILS` rules block, the high-precision
  `is_code_generation_request()` detector, and the new `OUT_OF_SCOPE` value on `QueryIntent` (with
  a rewritten classifier prompt).
- `backend/app/ai/query_router.py` — added an `OUT_OF_SCOPE` route that returns an empty context
  with no database lookup.
- `backend/app/ai/chat_pipeline.py` — short-circuits `OUT_OF_SCOPE` to the fixed scope refusal
  (skipping answer generation) and added a small `refusal_stream()` helper.
- `backend/app/api/ai.py` — runs the zero-cost code detector at the very top of the endpoint,
  before any LLM call.
- `backend/app/services/rag_service.py` — injected `STRICT_GUARDRAILS` into every read-assistant
  system prompt and added a defensive `OUT_OF_SCOPE` prompt branch.
- `backend/app/services/agentic_ai/agent_service.py` — appended `STRICT_GUARDRAILS` to the write
  agent's system prompt.

### How to verify it works

1. Send "give me a python code to reverse a number" → expect the **code refusal**, returned
   instantly with **no LLM call** (Layer 1).
2. Send "do I have any coding ideas?" → expect a **normal, helpful answer** about your ideas
   (not blocked).
3. Send "what should I build for my coding idea?" → expect the assistant to **discuss the idea**
   without writing any code.
4. Send "what is the capital of France?" → expect the **scope refusal**, with the answer-generation
   step **skipped** at the classifier level (Layer 2).
5. Try several off-topic questions (trivia, math, science, definitions) → all should be refused
   with the same scope-refusal sentence.

---

## Re-Summarising and Re-Embedding Edited Ideas

### The bug
Semantic search in Idea Vault ranks ideas by an **embedding** (a numeric "meaning" vector)
built from **only the `title` + `summary`** — not the description, tags, or status.

When the agent edited an idea's title/description, it left the `summary` unchanged. So after a
meaningful edit the embedding became a stale mix (new title, old summary), and searching for the
idea's *new* concept could fail to find it. No error, just silently wrong search results.

### The fix
When an edit genuinely changes an idea's meaning, the agent also proposes a new summary, and
accepting it rebuilds the embedding from the new title + new summary.

Two guards keep this safe:
- **Only on real meaning changes.** `new_summary` is optional and judgment-based — the agent's
  prompt and the tool description tell it to propose one only when a title/description change
  alters the concept, and to omit it for typos/wording tweaks (2–3 sentences, max ~190 words).
- **Only re-embed when needed, in the background.** Embedding is CPU-heavy, so we reuse the
  existing `_embed_and_store` background-task pattern: save the change immediately, then re-embed
  *after* responding — and only if the title or summary actually changed (compared against the
  stored values). Edits that touch only status/priority skip it entirely.

### Decisions
- Matched the real helper signature `_embed_and_store(db, idea_id, title, summary)` (the spec
  had it wrong).
- Re-embed on genuine change only, not on every accept (mirrors the normal edit endpoint).
- Used a local import of `_embed_and_store` inside `execute_proposal` to avoid a circular import
  (the ideas API already depends on services).
- Left the idea-*creation* path alone — it already summarised and embedded correctly.

### Files changed
- `backend/app/schemas/agent.py` — optional `current_summary` / `new_summary` on the update proposal.
- `backend/app/services/agentic_ai/agent_tools.py` — `current_summary` / `new_summary` added to the
  `propose_idea_update` tool.
- `backend/app/services/agentic_ai/agent_service.py` — prompt guidance on when to propose a summary;
  `execute_proposal` saves it and schedules a background re-embed (gained a `BackgroundTasks` param).
- `backend/app/api/agent.py` — `/agent/decide` passes `BackgroundTasks` through to `execute_proposal`.
- `frontend/components/agent/ProposalCard.tsx` — summary fields on the type plus a "Summary" `DiffView`
  shown when a new summary is proposed.

### How to verify it works
1. Ask the agent to significantly rewrite an idea → the proposal card shows a **Summary** diff.
2. Ask for a tiny wording fix → no summary diff appears.
3. Accept a meaning-changing update → response returns immediately; embedding refreshes in the background.
4. Search for the idea by its new concept → it is found, proving the embedding caught up.
5. Accept a status/priority-only change → no re-embedding is triggered.

---

## Conversation History: Redis Sessions, Context Window, and Query Rewriting

### The problem
Each chat message was handled in isolation — the assistant had no memory of the conversation.
A follow-up like *"which of these relate to weight loss?"* was meaningless: there was no "these",
and embedding such a sentence for semantic search produces a noise vector that finds nothing.

### The fix
Three pieces working together:
- **Server-side sessions (Redis).** Every conversation gets a unique `session_id`. Messages are
  stored under `chat_session:{user_id}:{session_id}` and loaded on each new message so the model
  sees prior turns. Redis is used (not MongoDB) for microsecond reads/writes and a built-in **TTL**
  that auto-expires idle sessions after **3 hours** — no cleanup job, no stale data.
- **Context-window management (sliding window).** LLMs have a finite context, so we feed only the
  **last 10 messages** to the model and cap what we keep in Redis (40 messages). Recent turns are
  enough for continuity without blowing the token budget. (A rolling LLM summary of older turns
  could be layered on later.)
- **Query rewriting.** Before retrieval, a fast LLM call uses the history to rewrite a follow-up
  into a **standalone search query** (*"which of these relate to weight loss?"* →
  *"ideas about weight loss and diet"*). The rewritten query is used **only for retrieval**; the
  original message is still what the answer model sees, so replies stay natural. Whenever history
  exists we always run the reformulation (the model returns the message unchanged if it is already
  self-contained) — this also feeds the intent classifier a context-grounded query, so elliptical
  follow-ups like *"what about crocodiles?"* are no longer misread as off-topic.

### Decisions
- **Security: user_id always from the JWT** when building the Redis key — never from the request
  body. A forged/guessed `session_id` can only ever reach the caller's own history.
- **Pass `redis` as a parameter** (matching `rate_limit.py` / dependency injection) rather than
  importing a module global — consistent and testable.
- **Persist only clean exchanges.** The user message + full assistant reply are saved *after*
  streaming completes; errors are never written, so a failed turn can be retried cleanly.
- **session_id delivery differs by path.** The agent (write) path returns it in the JSON body; the
  RAG (read) path can't, so it emits a leading `{"type":"session", ...}` SSE event the client reads.
- **Rewrite whenever there is history (no keyword gate).** An earlier version skipped rewriting
  unless the message contained a referential word ("these", "it", "that one"). That broke
  *elliptical* follow-ups like *"what about crocodiles?"* — no pronoun, but fully context-dependent:
  the bare query reached the off-topic guardrail and got a canned refusal. The fix follows the
  standard history-aware-retriever pattern: always reformulate when history exists and let the LLM
  no-op truly standalone messages. A separate "only if intent is semantic" gate was also **not**
  added — intent is classified downstream, so gating on it would cost an extra LLM call, and the
  reformulation already grounds the query so the classifier routes it correctly.
- **History threads into both brains.** Recent turns are inserted between the system prompt and the
  new message for both the RAG answer and the agent loop, so follow-ups like *"now improve it"* work.
- **Reuse the existing "Clear chat" button as the session reset — no separate "New Chat".** A
  dedicated "New Chat" control implies past conversations are saved and switchable, which would
  invite a chat-history list (explicitly out of scope for this project). One delete button keeps the
  mental model unambiguous: there is one live conversation — clear it to start a fresh session
  (resets `session_id` to null and wipes the thread).
- **Backward compatible.** New params are all optional/keyword — the legacy `/api/chat` and
  `/api/agent` callers are unchanged and store nothing.

### Files changed
- `backend/app/services/session_service.py` *(new)* — Redis session storage: `generate_session_id`,
  `get_session_history`, `save_exchange`, `clear_session`, `history_window`; TTL + window constants.
- `backend/app/ai/query_rewriter.py` *(new)* — `rewrite_query(history, message)` using the fast
  classifier model, with a fall-back to the original message.
- `backend/app/schemas/chat.py` — `ChatRequest` gains optional `session_id`.
- `backend/app/ai/chat_pipeline.py` — `stream_rag_sse` accepts `history`/`redis`/`session_id`, does
  query rewriting, accumulates the reply and persists the exchange; `refusal_stream` emits the
  session event.
- `backend/app/services/rag_service.py` — `stream_rag_response` accepts `history` and inserts prior
  turns into the prompt.
- `backend/app/services/agentic_ai/agent_service.py` — `run_agent` accepts `history` and inserts
  prior turns before the new message.
- `backend/app/api/ai.py` — `unified_chat` generates/loads the session, threads history into both
  paths, saves messages, and returns `session_id`.
- `frontend/components/chat/UnifiedChatWindow.tsx` — persists `session_id`, sends it on every
  message, and captures it from both the JSON and SSE responses; "Clear chat" starts a fresh session.

### How to verify it works
1. Send a message → the response carries a `session_id` (SSE `session` event or JSON field).
2. Send a second message with that `session_id` → prior turns are loaded; a follow-up like
   *"which of those are about fitness?"* now finds the right ideas (query rewriting at work).
3. Redis CLI: `KEYS chat_session:*` shows your key; `TTL <key>` shows it counting down from 10800s.
4. Wait past the TTL (or `DEL` the key) → the next message starts a fresh conversation.
5. Click **Clear chat** → a new `session_id` is issued on the next message.

---

## Rolling summary memory (context-window management)

### The problem
The sliding window already caps prompt size, but it *forgets* anything older than the last 10
messages. In a long session the model loses the broad topic of the earlier conversation, and a
naive fix (summarise on every turn, with the answer model) would add an LLM call per message —
exactly what is throttling us on the free tier.

### The fix
A **rolling summary** keeps memory of old turns without growing the prompt. Once a conversation
passes `_SUMMARY_TRIGGER_MESSAGES` (20), the oldest messages (everything beyond the recent 10) are
folded into a short running summary; only the last 10 messages plus that summary are kept. On the
next read, `get_managed_history` returns the summary as a leading `system` message followed by the
recent window, so the model still "remembers" the earlier topic while the prompt stays bounded.

### Decisions (the cost-conscious build)
- **Summarise on the SAVE path, not on read.** `save_exchange` (which runs *after* the reply has
  streamed) does the folding, so summarisation never adds latency to what the user sees.
  `get_managed_history` is a pure read — it never calls the LLM.
- **Rare trigger (20 messages).** Most conversations here are short and never summarise at all; the
  extra call only fires on genuinely long sessions, so it doesn't worsen rate limits.
- **Fast/cheap model.** Summarisation uses the same `classifier_model` as query rewriting, not the
  answer model.
- **Cached in Redis.** The summary is stored once and reused on every subsequent turn until the next
  fold — it is regenerated only when a *new* batch of old messages needs folding in.
- **Fail-safe, never lose content.** If the summariser is rate-limited/errors it returns `None`; the
  exchange is still saved (messages kept, bounded by the `_MAX_STORED_MESSAGES` hard cap) and the
  existing summary is preserved, so nothing is silently dropped.
- **Backward compatible storage.** Sessions are now `{"summary", "messages"}`; older bare-list
  sessions are still read transparently, so nothing breaks on deploy.
- **Summary reaches the model.** The RAG and agent prompt builders now accept a leading `system`
  turn from history — this is *our* controlled summary (never user input), so it's safe to include.

### Files changed
- `backend/app/ai/history_summarizer.py` *(new)* — `summarize_history(previous_summary, messages)`
  folds a batch into the running summary using the fast model; returns `None` on failure.
- `backend/app/services/session_service.py` — structured `{"summary","messages"}` storage with
  `_load`/`_store`; new `get_managed_history` (summary + window, no LLM); `save_exchange` now folds
  old turns into the summary once past the trigger; `get_session_history` kept for compatibility.
- `backend/app/api/ai.py` — `unified_chat` now builds the context via `get_managed_history`.
- `backend/app/services/rag_service.py`, `backend/app/services/agentic_ai/agent_service.py` — accept
  a leading `system` (summary) turn from history.

### How to verify it works
1. Hold one `session_id` and send 11+ exchanges (22+ messages). After the 11th, the Redis blob
   becomes `{"summary": "...", "messages": [...]}` with `messages` trimmed back to the recent 10.
2. `GET chat_session:<uid>:<sid>` in the Redis CLI shows the cached summary text.
3. Ask about a topic from the *earliest* messages — the reply still reflects it, because the summary
   is injected as a leading system message (the prompt no longer carries those raw turns).
4. The prompt size stays flat as the conversation grows past 10 messages — no context overflow.

---

## Stop generation (mid-stream cancellation)

### The problem
Once a reply started streaming, the user had to wait for it to finish — even if the first sentence
already showed it was going the wrong way. Worse, on the free LLM tier every wasted token counts: a
user abandoning a long answer still burns the full quota, because **the backend keeps generating even
after the browser stops listening.**

### The fix
A **Stop button** that solves both halves of the problem:
- **Frontend** — an `AbortController` is attached to the `fetch`. Hitting Stop aborts it, which
  immediately stops reading the SSE stream and re-enables the input so the user can type again right
  away. The partial reply stays on screen with a subtle **"⚠ Stopped"** badge.
- **Backend** — the streaming generator polls `request.is_disconnected()` after every token. When the
  client hangs up it **breaks the loop, closing the upstream LLM stream** so no further tokens are
  generated or billed. Whatever partial text was produced is persisted, tagged `interrupted`.

### Decisions (the careful parts)
- **Stop the LLM, don't just hide it.** Cancelling only on the frontend would leave the backend
  generating into the void on our dime. The real win is `is_disconnected()` breaking the server-side
  token loop — that's what protects the OpenRouter quota.
- **Detect disconnect *inside* the pipeline, not the route wrapper.** `is_disconnected` is passed into
  `stream_rag_sse` as an injected async callable (same DI style as `redis`), so the pipeline that owns
  the token loop is also the one that decides to stop and persist the partial — in one place, and
  testable without a real `Request`.
- **Persist the partial, tagged `interrupted`.** Redis is the server-side source of truth; saving the
  half-reply keeps the next turn's context coherent. Empty partials (stopped before any token) and
  errored streams are never saved.
- **Exclude interrupted turns from query rewriting, keep them everywhere else.** A half-sentence makes
  a *terrible* standalone search query, so `rewrite_query` skips `interrupted` turns. The rolling
  summary still folds them in (incomplete context is still context), and they remain visible in the UI.
- **Frontend and backend mark interruption independently.** The browser flags its local copy; the
  backend flags Redis. They never need to exchange an "interrupted" signal — each store stays correct
  on its own.
- **Graceful degradation.** If `is_disconnected()` is unavailable on the host, the stream simply runs
  to completion server-side; the frontend Stop still works. (Verify token usage actually drops on
  Render before relying on the backend half.)
- **Agent (write) path unchanged.** It returns a single JSON blob, not a stream — there is no
  mid-flight token loop to interrupt, so Stop there just discards the (short, bounded) result.

### Files changed
- `backend/app/ai/chat_pipeline.py` — `stream_rag_sse` accepts `is_disconnected`; breaks the token
  loop on disconnect and saves the partial with `interrupted=True`.
- `backend/app/api/ai.py` — injects the Starlette `Request` and passes `http_request.is_disconnected`
  into the stream.
- `backend/app/services/session_service.py` — `save_exchange` gains an `interrupted` flag that tags
  the assistant turn (`{"role":"assistant","content":..., "interrupted": true}`).
- `backend/app/ai/query_rewriter.py` — skips `interrupted` turns when building rewrite context.
- `frontend/components/chat/ChatInput.tsx` — `streaming`/`onStop` props; a red **Stop** (square)
  button replaces Send while a response is in flight.
- `frontend/components/chat/MessageBubble.tsx` — `interrupted` flag on `Message` + the "⚠ Stopped"
  indicator.
- `frontend/components/chat/UnifiedChatWindow.tsx` — `AbortController` ref, signal on the `fetch`,
  `stopGeneration()` (marks/drops the partial), and `AbortError` swallowed so Stop shows no error.

### How to verify it works
1. Ask something that produces a long answer → a red **Stop** button appears while it streams.
2. Click Stop → the stream halts instantly, the partial stays with a **"⚠ Stopped"** badge, and the
   input is immediately usable again.
3. Send a follow-up → it works normally; the interrupted half-sentence is **not** used to build the
   retrieval query (check logs — no nonsensical rewrite).
4. On Render, watch token usage: stopping a long generation should stop new tokens being billed
   (confirms `is_disconnected()` is breaking the backend loop).

---

## Status-Aware Result Ranking (active ideas first)

### The problem
Semantic search ranked ideas by similarity **score alone**, with no awareness of their `status`.
For a user with many ideas — some **shipped**, some **abandoned** — a query like *"do I have any
fitness ideas?"* could return mostly completed ones, burying the active ideas they actually want to
act on. But simply **hard-filtering** completed ideas out is also wrong: it breaks legitimate queries
like *"what fitness ideas have I shipped?"*.

### The fix
A lightweight, **metadata-aware ranking** step that runs after retrieval:
1. **Retrieve a wider candidate pool** — the semantic handler now fetches **15** candidates instead of
   5, leaving room to demote completed ideas without dropping genuinely relevant active ones.
2. **Adjust scores by status** — each candidate's similarity score is multiplied by a per-status
   weight (active statuses `raw/exploring/validated/building` = `1.0`; `shipped` = `0.6`;
   `abandoned` = `0.5`), then the list is re-sorted and trimmed to the top 5.
3. **Detect explicit "completed" queries** — a cheap, high-precision regex (`query_targets_completed`)
   recognises when the user is *asking about* shipped/abandoned/past ideas (*"did I ship…"*,
   *"have I ever…"*, *"abandoned ideas"*). In that case the penalty is **skipped** and results stay in
   pure similarity order so those ideas surface prominently.
4. **Prompt guidance** — for default queries the system prompt tells the model to prioritise active
   ideas and mention any completed ones separately under a *"Previously completed ideas"* note; for
   explicit completed queries it is told to present them prominently and not deprioritise them.

> **Naming note (interview-accurate):** this is **not** cross-encoder *reranking* (Cohere / BGE-Reranker)
> — there is no extra model call. It is a rule-based post-processing step over a field we already store.
> Call it **"metadata-aware result ranking"**, not "reranking", to stay accurate.

### Decisions
- **Adjust scores, don't hard-filter.** Demoting (not deleting) completed ideas keeps default queries
  clean *and* keeps explicit "what did I ship?" queries working — hard-filtering would break the latter.
- **Regex to detect intent, not another LLM call.** The completed-query detector mirrors the project's
  existing layered fast-path guards (zero cost, deterministic) and is deliberately **high-precision**:
  it must never fire on ordinary active-idea queries.
- **Retrieve 15, serve 5.** A wider pool is what makes ranking meaningful; without it, demoting a
  completed idea would just promote whatever the 6th result happened to be. The final result count is
  unchanged.
- **Multipliers, not a fixed penalty.** Scaling preserves *relative* similarity within a status band —
  a strongly-matching shipped idea still beats a weakly-matching one — while cleanly separating the bands.
- **Fallback path untouched.** When vector search returns nothing (generic query / sparse vault) we
  still serve recent ideas in recency order — no ranking applied, matching prior behaviour.
- **Flag flows through compound queries.** `include_completed` is propagated through the decomposer's
  merge (`any(...)` across sub-queries) so a multi-part message still drives the right prompt guidance.
- **Prompt guidance scoped to `SEMANTIC_SEARCH`.** Listing ("show my ideas") is left alone — the
  status separation only applies where relevance ranking actually happens.

### Files changed
- `backend/app/services/vector_search.py` — added `rerank_by_status()` (status-weighted re-sort,
  writes `adjusted_score`, leaves `score` intact) and `query_targets_completed()` (regex intent guard).
- `backend/app/ai/handlers.py` — `handle_semantic_search` retrieves 15 candidates, applies the status
  penalty for default queries (or keeps similarity order for explicit completed queries), and returns
  the new `include_completed` flag.
- `backend/app/ai/query_decomposer.py` — propagates `include_completed` through the compound-query merge.
- `backend/app/services/rag_service.py` — injects status-aware guidance into the `SEMANTIC_SEARCH`
  system prompt, driven by `include_completed`.

### How to verify it works
1. *"Do I have any fitness ideas?"* → active fitness ideas surface first; any completed ones are
   mentioned separately at the end.
2. *"Have I ever had any fitness ideas?"* → **all** fitness ideas returned, including completed.
3. *"What fitness ideas did I ship?"* → shipped ideas returned **prominently**, not penalised.
4. *"Fitness ideas I can work on"* → active ideas lead; completed ones are pushed down.
5. Unit check (no DB needed): an active idea at score `0.80` and a raw idea at `0.72` outrank a shipped
   idea at `0.95` (→`0.57`) and an abandoned one at `0.90` (→`0.45`); the completed-query detector scores
   the four phrasings above as `False / True / True / False` respectively.

---

## Email Verification: Temporarily Disabled (and Why Resend, not SMTP)

### The problem
Two things collided:
1. **No paid domain yet.** Transactional email providers only deliver to arbitrary inboxes once you
   verify a real sending **domain**. Without one, every verification link was being routed to a personal
   inbox (via the dev override) instead of the actual user — not something acceptable in production.
2. **A hard login gate.** New local accounts were created `email_verified=False` and the login route
   blocked them until they clicked a link that, in this pre-domain state, they'd never usefully receive.
   The result: a user could sign up but never get in.

This is a resume/portfolio project, so the pragmatic call was to **defer** email verification (buy a
domain later) rather than let a half-wired email flow block the core signup experience today.

### The fix
Email verification is switched **off** end-to-end, but every piece is preserved so it can be switched
back on in minutes once a domain exists:
- **Signup creates pre-verified accounts.** `register()` now sets `email_verified=True`, generates no
  token, and sends no email — so registration simply creates a usable account.
- **Login gate lifted.** The "please verify your email" 403 check in `login()` is commented out so any
  account (including any legacy unverified rows) can sign in.
- **Frontend skips the "check your email" screen.** A single flag `EMAIL_VERIFICATION_ENABLED = false`
  in `SignupForm.tsx` redirects a successful signup straight to `/login`; the entire check-email/resend
  UI is left intact behind the flag.

### Why comment the code out instead of deleting it
- **This is a "not yet", not a "never".** The email flow is correct and fully built — it's blocked only
  by an external dependency (a domain). Deleting working code you intend to restore just means rewriting
  and re-testing it later.
- **Reversibility is a one-liner.** Re-enabling is: flip `EMAIL_VERIFICATION_ENABLED` to `true`, and
  uncomment the token/email lines + login gate (each marked with an `EMAIL VERIFICATION TEMPORARILY
  DISABLED` banner). No logic has to be reconstructed from memory.
- **The commented lines are living documentation.** They show the *exact* wiring that must come back,
  so future-me (or a reviewer) sees precisely what "on" looks like.
- **Endpoints stay put.** `/auth/verify-email` and `/auth/resend-verification` are untouched — harmless
  while unused, and part of what re-activates. Google OAuth is unaffected (its users are pre-verified).

### Why Resend (HTTPS API) instead of raw SMTP
The email layer uses **Resend's async API** (`send_async`, backed by httpx), not hand-rolled SMTP. For a
transactional web app deployed to a managed host, that's the stronger choice:
- **Deliverability.** Sending SMTP from an unknown server IP lands in spam or is dropped. Resend sends
  from warmed, reputation-managed IPs and handles **SPF/DKIM/DMARC** for you — mail actually reaches the
  inbox once the domain is verified.
- **It's one HTTPS `POST`, not a stateful protocol.** SMTP is a chatty, multi-round-trip conversation
  (HELO → MAIL FROM → RCPT TO → DATA) with connection pooling, TLS and timeouts to manage. Resend is a
  single async call that drops cleanly into the existing `BackgroundTasks` pattern.
- **Ports.** Managed hosts (Render included) **block outbound port 25** and throttle 587/465 to curb
  spam. Resend rides **443 (HTTPS)**, which is never blocked — so it works in production without begging
  support to open ports.
- **Observability & retries.** SMTP gives a cryptic status and no history. Resend provides a dashboard +
  webhooks (delivered / bounced / complained) and automatic retries — the "observable failures" the
  engineering charter asks for.
- **Secrets.** SMTP needs long-lived user/password credentials in the app; Resend uses a **scoped,
  rotatable API key** (send-only), shrinking the blast radius if leaked.

### Decisions
- **Defer, don't half-ship.** A verification flow that can't deliver is worse than no gate at all — it
  locks real users out. Disabling it cleanly beats leaving a broken gate in the login path.
- **Provider behind a thin wrapper.** All sending lives in `email_service.py` (`send_verification_email`
  / `send_password_reset_email`), so swapping Resend for SES/Postmark later — or re-enabling — is a
  single-file change; the auth routes never touch the provider directly.
- **Dev override is intentional.** `EMAIL_OVERRIDE_TO` routes all mail to the Resend account owner in
  development (the only address deliverable without a verified domain); it's empty in production. This is
  exactly the constraint that motivated deferring verification.
- **Accept the trade-off.** Resend adds a vendor dependency and a free-tier cap, mitigated by the wrapper
  boundary above — a fair price for inbox deliverability you can actually prove.

### Files changed
- `backend/app/api/auth.py` — `register()` creates pre-verified accounts (token/email lines commented);
  the `login()` email-verification 403 gate commented out; each block flagged for easy restoration.
- `frontend/components/auth/SignupForm.tsx` — added `EMAIL_VERIFICATION_ENABLED` flag; successful signup
  redirects to `/login` while off. The check-email/resend UI is preserved intact.
- *(unchanged, kept for later)* `backend/app/services/email_service.py` (Resend async wrapper),
  `/auth/verify-email`, `/auth/resend-verification`.

### How to verify it works
1. Sign up with a new email → you are taken straight to `/login`, no "check your email" screen, and **no
   email is sent** to any inbox.
2. Log in with those credentials immediately → success (the verification gate no longer blocks you).
3. Google OAuth sign-in still works and is pre-verified as before.

### How to re-enable (once a domain is owned)
1. Verify the sending domain at `https://resend.com/domains` and set `EMAIL_FROM` to the verified address;
   clear `EMAIL_OVERRIDE_TO`.
2. `backend/app/api/auth.py` — uncomment the token/email lines in `register()`, set `email_verified` back
   to `False`, and uncomment the login gate.
3. `frontend/components/auth/SignupForm.tsx` — set `EMAIL_VERIFICATION_ENABLED = true`.

---

## Cross-Provider LLM Failover (beating free-tier rate limits)

### The problem
The app runs entirely on **free LLM tiers** to stay zero-cost, and free tiers rate-limit. OpenRouter
(our original provider) throttles at the **account** level across all models, and individual models
add their own caps on top. When a limit is hit the provider returns **HTTP 429** and the user sees an
error instead of an answer — the worst possible moment during a live portfolio demo. Relying on a
single provider makes that a matter of *when*, not *if*.

### The fix
An ordered **failover chain** of providers, tried until one answers. All three — Cerebras, Groq,
OpenRouter — expose an OpenAI-compatible API, so the same `AsyncOpenAI` client works for each; only the
base URL, key, and model change. A new module `app/core/llm_client.py` exposes two entry points —
`create_chat_stream` (streaming RAG answer) and `create_chat_completion` (everything non-streaming) —
that walk the chain for the requested tier, spilling over to the next provider on failure and raising
only when all are exhausted. The order is **Cerebras → Groq → OpenRouter**, and each tier keeps its own
chain of tier-appropriate models:

| Tier | Cerebras | Groq | OpenRouter | Used for |
|---|---|---|---|---|
| **FAST** | `gpt-oss-120b` | `llama-3.1-8b-instant` | `gpt-oss-20b:free` | greetings, listing, counts, intent classification, query rewriting, summarising |
| **STANDARD** | `gpt-oss-120b` | `openai/gpt-oss-120b` | `gpt-oss-120b:free` | semantic-search answers, the agent (all tool-capable) |

### Decisions
- **Build it, don't add LiteLLM.** Because every provider is already OpenAI-compatible, the whole thing
  is ~60 lines on the client we already use — lighter and clearer than adopting a framework to hide them
  (matches the charter's "simple, explicit code over clever abstractions").
- **Order = fastest and most generous first.** Cerebras and Groq run on custom inference hardware with
  generous free tiers. Crucially they are *separate accounts*, so their rate limits are independent
  buckets — free capacity **stacks** instead of sharing one ceiling. OpenRouter goes last as the broad
  backstop (widest model catalog).
- **Fail fast, don't sleep.** The old single-provider fallback retried the same model with 2s/4s/8s
  backoff. With independent providers that's wrong — if Cerebras just 429'd, another provider almost
  certainly has capacity *now* — so the chain fails over immediately with no per-provider backoff. More
  resilient *and* faster.
- **Fail over on any provider-side failure.** The chain retries the next endpoint on any
  `APIStatusError` (every non-2xx: 400 / 401 / 403 / 404 / 429 / 5xx), plus timeouts, connection errors,
  and an empty `choices` payload. This is deliberately broad: on free tiers a "bad request"/"model not
  found"/"tool_use_failed" from one provider is often just *that provider's* quirk, so trying the next one
  is usually the right move. The only cost is that a genuinely malformed request walks the whole chain
  before surfacing — acceptable for the resilience it buys.
- **Streaming fails over at connect time only.** 429s surface when the stream is opened, before any
  token — safe to switch there. A rare mid-stream drop just ends that reply; we never restart half an
  answer.
- **Agent stays on tool-capable models.** The agent uses tool calling, which not every free model
  supports. The STANDARD-tier 70B models (Cerebras/Groq `llama-3.3-70b`) do, so the agent runs on
  STANDARD — a requirement, not a coincidence.
- **Centralize, delete duplication.** Five call sites (RAG stream, agent, classifier, rewriter,
  summarizer) each built their own client and fallback logic. All now route through the one executor —
  one behaviour, one place (DRY).
- **Quirks live on the endpoint.** Ollama needs `extra_body={"think": False}`; cloud providers reject
  it. Each endpoint carries its own params so callers stay provider-agnostic, and local Ollama dev keeps
  working unchanged (its "chain" is a single endpoint).
- **Graceful degradation + safe keys.** Keys stay in env, are never logged, and only providers with a
  key set join the chain (enable one or all three). If every provider is exhausted the small helpers
  degrade — classifier → `SEMANTIC_SEARCH`, rewriter/summarizer → original text — so the user never sees
  a stack trace.

### Files changed
- `backend/app/core/llm_client.py` *(new)* — the failover executor: `LLMEndpoint`, `_resolve_chain`
  (per-tier chain), `create_chat_completion` (non-stream) and `create_chat_stream` (stream).
- `backend/app/core/config.py` — added `GROQ_API_KEY`, `CEREBRAS_API_KEY`, and the four
  `LLM_GROQ_MODEL_*` / `LLM_CEREBRAS_MODEL_*` settings (env-overridable).
- `backend/app/services/rag_service.py` — the streaming answer calls `create_chat_stream`; the old
  `_create_stream_with_fallback` helper was removed.
- `backend/app/services/agentic_ai/agent_service.py` — the agent routes through `create_chat_completion`
  on the STANDARD (tool-capable) tier; its per-call client and old retry helper were removed.
- `backend/app/services/intent_classifier.py`, `backend/app/ai/query_rewriter.py`,
  `backend/app/ai/history_summarizer.py` — each calls `create_chat_completion` on the FAST tier; the
  classifier also degrades to `SEMANTIC_SEARCH` if all providers fail.
- Configuration is env-only (loaded via `env_file` in docker-compose): set `LLM_PROVIDER=openrouter` to
  activate the chain, plus `CEREBRAS_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY`; set
  `LLM_PROVIDER=ollama` to bypass the chain for local dev.

### How to verify it works
1. With all three keys set, the STANDARD chain resolves to `[cerebras, groq, openrouter]` and FAST to
   the three small models; remove a key and that provider drops out of the chain automatically.
2. Simulate a 429 on Cerebras → the request is transparently served by Groq and a `trying next provider`
   line is logged (verified with a unit test that raises `RateLimitError` for Cerebras).
3. With `LLM_PROVIDER=ollama`, the chain is a single Ollama endpoint with `think=False` — no cloud
   calls, behaviour identical to before.
4. With no valid keys, the helper calls degrade (classifier → `SEMANTIC_SEARCH`, rewriter/summarizer →
   original text) instead of raising.
5. Note: free-tier providers occasionally rename/retire models — a 404 means the model name changed;
   update the relevant `LLM_*_MODEL_*` value in `config.py` (env-overridable, no code change needed).

---

## Agent Tool Calls Emitted as Text (cross-provider fix)

### The problem
After moving the agent onto the failover chain, asking it to create or update something dumped raw
markup into the chat instead of showing a proposal card — e.g.
`<function(propose_idea_creation)>{...}</function>`. The new STANDARD-tier models (Cerebras/Groq
`llama-3.3-70b`) express tool calls as **inline text** rather than the OpenAI structured `tool_calls`
field. The agent loop only recognised structured calls, so it fell through to "model answered with
text" and returned the markup verbatim.

### The fix
Make the agent **provider-agnostic** about how a tool call arrives. A new `_normalize_tool_calls()`
prefers the structured `tool_calls`, and when absent, recovers calls from the message text with
`_extract_text_tool_calls()` (a regex handling both `<function(name)>` and `<function=name>` forms, and
multiple calls). The loop now works off a normalised `(id, name, arguments)` list, so text-emitted and
structured calls flow through the *same* proposal-building path. `_strip_function_text()` scrubs the raw
markup from the visible reply so nothing leaks even in edge cases.

### Decisions
- **Parse text calls rather than restrict providers.** A text parser keeps the failover benefit and
  works no matter which provider serves the turn — a provider-agnostic fix beats pinning the agent to
  one model.
- **Detect by presence of calls, not `finish_reason`.** Text-mode models often return
  `finish_reason="stop"` even while emitting a tool call, so routing now keys off whether any call was
  found (structured or parsed), not the finish reason.
- **No re-summarise on the text path.** For text-mode proposals, asking the model for a closing summary
  risks it re-emitting raw markup, so the agent reuses its non-function prose (or a safe default) with no
  extra LLM call.
- **Reuse the existing proposal builder.** Parsed args feed the same `_build_proposal`, which picks known
  fields — so extra keys the model includes (like `reasoning`) are handled exactly as before.

### Files changed
- `backend/app/services/agentic_ai/agent_service.py` — added `_extract_text_tool_calls`,
  `_strip_function_text`, `_normalize_tool_calls` and a `_ToolCall` shape; rewrote the tool-handling loop
  to consume normalised calls from either source; removed the now-unused `_to_openai_tool_calls`.

### How to verify it works
1. Ask "create an idea about a RAG movie-recommendation project" → a proper **proposal card** appears
   (Accept/Reject), not raw `<function...>` text.
2. Unit check: the exact leaked payload parses into an `IdeaCreationProposal` (title/status/tags
   correct); the `<function=name>` and multi-call variants also parse; `_strip_function_text` removes all
   markup.
3. A plain question ("what are my ideas?") still returns normal text with no proposals.

---

## Production Error Tracking with Sentry (backend + frontend)

### The problem
In production the app failed with a bare **500** in the browser console — no traceback, no context,
no way to tell *what* broke. The server logs on the host are live-tail only: you have to catch the
error as it happens, there's no history, no grouping, and no alerts. Worse, several failures are
**silent** — the read pipeline catches an LLM/provider error and returns a graceful message, so the
user sees "something went wrong" while nothing anywhere records *why*. Without visibility, debugging
production is guesswork.

### Why we even need this
- **You can't fix what you can't see.** A stack trace + the failing request turns "unknown error" into
  a one-line diagnosis.
- **Silent degradations stay silent.** Graceful fallbacks are good UX but hide the underlying failure;
  something must still record it.
- **Operability is part of the job.** The engineering charter calls for observable failures and enough
  context to debug incidents quickly — error tracking is how that's met.

### The fix
**Sentry**, wired across **both** the FastAPI backend and the Next.js frontend, capturing unhandled
exceptions with full stack traces, the failing request's context, release/environment tags, grouping,
and email alerts. Everything is **gated behind a DSN env var**, so with no DSN set it is a complete
no-op — local dev and tests are unaffected.

Two backend enhancements make coverage complete:
1. **All 5xx are captured** — the SDK's default `failed_request_status_codes` is the full 500–599 range,
   so both unhandled crashes *and* deliberate `HTTPException(500)` are reported (verified in SDK source;
   no extra config needed).
2. **Silent failures are surfaced** — `sentry_sdk.capture_exception()` was added to the read pipeline's
   graceful `except Exception` blocks (classifier, route classifier, query rewriter, summariser, RAG
   stream creation, decompose/route), so a provider/LLM failure is reported **even though the user still
   gets a friendly fallback**.

On the frontend, `@sentry/nextjs` captures browser crashes, failed BFF route handlers, and uncaught
React render errors (via a `global-error` boundary), and — with tracing on — links a browser action to
the backend request it triggered into one **frontend → backend** timeline.

### Why Sentry over the alternatives
- **Purpose-built for "why did this 500?"** — stack trace + request context + grouping + alerts, which
  is exactly the pain here. Log-aggregation tools (Better Stack, Axiom, Grafana Loki) are great for
  *searching* logs but don't group/alert on exceptions out of the box.
- **First-class SDKs for our exact stack** — official FastAPI and Next.js integrations, ~a handful of
  lines each; auto-instruments requests.
- **Generous free tier** — enough for a solo portfolio project (no cost, matching the zero-spend goal).
- **Recruiter-recognised** — it's the industry-standard error tracker; wiring it full-stack signals
  production maturity most portfolio projects lack.
- **Not chosen: raw log tailing** (no history/alerts), **self-hosted stacks** (too much ops for a solo
  project), **log-only SaaS** (searches lines but won't turn a crash into a grouped, alertable issue).
  A log-aggregation tool can be added *later* via a Render Log Stream to complement Sentry.

### Decisions
- **DSN-gated, inert by default.** No DSN → `capture_exception()` is a verified no-op and `Sentry.init`
  disables the SDK. Local dev, CI, and the smoke tests behave exactly as before.
- **`send_default_pii=False` everywhere.** No cookies, request bodies, or user identifiers are shipped —
  matches the charter's "no secret/PII leakage".
- **Capture 5xx and silent failures; deliberately skip 429/4xx.** Rate limiting and 404/403 are normal
  control flow; reporting them would turn Sentry into noise. Real degradations (unexpected exceptions)
  are what get captured.
- **One public DSN drives client + server on the frontend.** A Sentry DSN can only submit events (not
  read), so `NEXT_PUBLIC_SENTRY_DSN` is safe to expose and keeps configuration to a single variable.
- **Skipped Session Replay and `tunnelRoute`.** Replay adds bundle weight for little diagnostic gain
  here; `tunnelRoute` would route events through a Next path the auth **middleware** could block. Both
  omitted to stay simple and avoid a subtle breakage — easy to add later.
- **Build stays green without a Sentry account.** `withSentryConfig` just skips source-map upload when
  `SENTRY_ORG/PROJECT/AUTH_TOKEN` are absent, so nothing breaks before the DSN exists.

### Files changed
Backend:
- `backend/app/core/config.py` — added `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`,
  `SENTRY_RELEASE` (all default empty/dev → inert).
- `backend/app/main.py` — initialises Sentry before the app is created (only if `SENTRY_DSN` is set);
  added a DEBUG-only `/api/debug/sentry-test` route to confirm wiring.
- `backend/requirements.txt` — added `sentry-sdk[fastapi]`.
- `backend/app/ai/chat_pipeline.py`, `backend/app/services/rag_service.py`,
  `backend/app/services/intent_classifier.py`, `backend/app/ai/query_rewriter.py`,
  `backend/app/ai/history_summarizer.py` — `sentry_sdk.capture_exception()` added to the graceful
  `except Exception` blocks so silent LLM/provider failures are still reported.

Frontend:
- `frontend/instrumentation-client.ts` — browser init + client navigation tracing.
- `frontend/sentry.server.config.ts`, `frontend/sentry.edge.config.ts` — Node/Edge runtime init.
- `frontend/instrumentation.ts` — `register()` + `onRequestError` (server component / route-handler errors).
- `frontend/app/global-error.tsx` — captures uncaught React render errors with a recovery UI.
- `frontend/next.config.ts` — wrapped with `withSentryConfig`.

### Configuration
- **Backend (Render):** `SENTRY_DSN=<FastAPI project DSN>`, `SENTRY_ENVIRONMENT=production`
  (optional: `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_RELEASE=<git sha>`).
- **Frontend host:** `NEXT_PUBLIC_SENTRY_DSN=<Next.js project DSN>`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`
  (optional for readable stack traces: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` so source maps upload at build).

### How to verify it works
1. Set the DSN(s) and redeploy → reproduce the production 500. It appears in Sentry's **Issues** tab
   within seconds with the full traceback, route, and environment.
2. Backend wiring check: with `DEBUG=True`, hit `/api/debug/sentry-test` → the intentional error shows
   up in Sentry. Remove/ignore afterwards.
3. Silent-failure check: force an LLM failure (e.g. bad model name) → the user gets the graceful
   fallback **and** a captured exception appears in Sentry.
4. Frontend check: trigger a client error → it appears with browser/session context; with tracing on,
   the browser event links to the backend request in one trace.
5. No-DSN check: locally (no DSN) everything runs unchanged and the classifier smoke test still passes —
   confirming the integration is fully inert until configured.

---

## LLM Observability with Langfuse (traces + user feedback)

### The problem
Sentry tells us when the app *crashes* — but nothing about whether the AI's answers are any *good*,
what they *cost*, how *slow* they are, or which provider actually served them. For an LLM product that
quality/cost axis is invisible: you can't improve or debug answers you can't see, and there's no channel
for a user to signal "this reply was wrong/right."

### Why a *separate* tool — Langfuse **and** Sentry, not one
They measure two different axes and neither replaces the other:
- **Sentry = application errors** (crashes, 5xx) across the *whole* app — auth, collections, Postgres,
  image upload, AI routes. It cannot show a prompt/response, token cost, per-provider analytics, or evals.
- **Langfuse = LLM quality & cost** — prompt, response, model, provider, tokens, latency — plus user
  feedback on generated answers. It cannot capture the non-AI 500s that actually happen elsewhere.

Forcing both jobs into one tool means a weak version of each (Sentry's LLM features are shallow; Langfuse
is not a general exception tracker). Running both, each for its own axis, is the standard, defensible split
used in real AI companies — and it signals an understanding of *application* vs *LLM* observability.

### Why Langfuse over the alternatives
- **vs Helicone (proxy-based):** Helicone routes every call through its proxy `base_url` — which fights our
  multi-provider failover (three different provider base URLs). Langfuse instruments at the *code* layer
  (an OpenAI drop-in), a clean fit for our already-centralised `llm_client.py`.
- **vs LangSmith:** tightly coupled to LangChain, which this project deliberately doesn't use.
- **vs Arize Phoenix / self-hosted stacks:** more ops than a solo project warrants.
- **Langfuse:** open-source, generous free cloud tier, one-line drop-in, and built-in scores/feedback +
  evals. Best fit for the stack and the budget.

### The fix
- **Tracing at the single chokepoint.** Because every LLM call was already centralised in `llm_client.py`
  (from the failover work), tracing is a *one-file* swap: when the keys are set, the OpenAI client is
  replaced with Langfuse's drop-in, so **every** call across the app (RAG answer, agent, classifier,
  rewriter, summariser) is traced automatically with input, output, model, provider, tier, tokens,
  latency, and cost.
- **One trace per turn + feedback.** Each chat turn gets a Langfuse trace id (`new_trace_id()`), surfaced
  to the client — an SSE `trace` event for the RAG stream, a `trace_id` field in the agent JSON. Thumbs
  up/down on a reply POSTs to `POST /api/ai/feedback`, which records a `user-feedback` score against that
  trace id.

### Decisions
- **Instrument once, cover everything.** Centralising all LLM calls earlier is what makes this cheap — one
  swap traces every call site instead of scattering instrumentation.
- **Pass only kwargs the drop-in strips (`name`, `metadata`, `trace_id`).** Verified in the SDK source
  that `session_id`/`user_id`/`trace_context` are **not** stripped — passing them would leak to the
  provider API and **400 every call**. So session/user ride *inside* `metadata`. (This is the kind of
  mistake that takes down all AI at once, so it was verified against source, not assumed.)
- **Both keys stay server-side.** Langfuse authenticates with the public+secret pair; neither is exposed to
  the browser — feedback is written by the *backend* on the user's behalf, so no Langfuse key ever ships to
  the client.
- **Feedback is best-effort, fire-and-forget.** A disabled/failed write returns `{"recorded": false}`; the
  thumbs never block or error the chat. One vote per reply, persisted with the message so it survives reload.
- **Inert by default.** No keys → the drop-in is never loaded and `new_trace_id()`/`record_feedback()`
  no-op; local dev, tests, and the classifier smoke test behave exactly as before.
- **Flush on shutdown** so buffered traces aren't lost when the process stops.

### Files changed
Backend:
- `backend/app/core/config.py` — `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` (inert unless both keys set).
- `backend/app/core/langfuse_client.py` *(new)* — enable flag, client singleton, `new_trace_id()`, `record_feedback()`.
- `backend/app/core/llm_client.py` — swaps in the Langfuse OpenAI drop-in when enabled; threads `trace_id`/`session_id`/`user_id` and emits only the safe stripped kwargs.
- `backend/app/services/rag_service.py`, `backend/app/ai/chat_pipeline.py` — RAG path generates the turn trace id, emits it as an SSE `trace` event, and threads it into the generation.
- `backend/app/services/agentic_ai/agent_service.py` — the agent threads the trace id into its completions.
- `backend/app/api/ai.py` — returns `trace_id` in the agent JSON and adds `POST /api/ai/feedback`.
- `backend/app/schemas/chat.py` — `FeedbackRequest` (`trace_id`, `value`, optional `comment`).
- `backend/app/main.py` — flushes Langfuse on shutdown. `backend/requirements.txt` — adds `langfuse`.

Frontend:
- `frontend/app/api/ai/feedback/route.ts` *(new)* — BFF proxy that forwards the rating with the access token.
- `frontend/components/chat/MessageBubble.tsx` — `traceId`/`feedback` on the message + a thumbs-up/down control on completed replies.
- `frontend/components/chat/UnifiedChatWindow.tsx` — captures the trace id from the SSE `trace` event and the agent JSON, and POSTs the rating.

### Configuration
- **Backend env:** `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` (defaults to `https://cloud.langfuse.com`). Both keys live server-side; nothing Langfuse-related is exposed to the browser.

### How to verify it works
1. Set the keys and chat → each reply's LLM call appears as a Langfuse trace with model, provider, tier,
   tokens, latency, and cost.
2. Click 👍/👎 on a reply → a `user-feedback` score appears on that reply's trace; the vote is one-shot and
   persists across reload.
3. Safety: the drop-in was verified to emit only `{name, metadata, trace_id}` — no leaked kwargs, so no
   provider 400s. Session/user appear inside trace metadata.
4. No-keys check: locally (no keys) tracing is fully inert, feedback returns `recorded: false`, and the
   classifier smoke test still passes.

---

## Production Fixes — Issues Surfaced After Deploy (Sentry + Langfuse)

Once the app was deployed to Render and wired to Sentry + Langfuse, real traffic exposed a cluster of
issues that never appeared in local dev. Each one below is a *real* production incident: what the
observability tools showed, the root cause, and the fix. They fall into three buckets — free-tier models
that quietly broke, an unhandled failure that reached the user, and observability/infra papercuts.

### At a glance

| # | Symptom in production | Root cause | Fix | Type |
|---|---|---|---|---|
| 1 | Cerebras `404 model llama-3.3-70b does not exist` (~70 events) | Cerebras retired Llama from the free/shared endpoint | Move both Cerebras tiers to `gpt-oss-120b` | Config |
| 2 | Groq `400 tool_use_failed` on the agent | `llama-3.3-70b-versatile` output fails Groq's tool validator | Groq STANDARD → `openai/gpt-oss-120b` | Config |
| 3 | Agent silently unreliable on OpenRouter | `gemma-4-31b` has no real tool-calling support | OpenRouter STANDARD → `openai/gpt-oss-120b:free` | Config |
| 4 | Agent write path returned `500 Unknown error` | All providers failed → unhandled exception | Graceful try/except + friendly message | Code |
| 5 | Sentry flooded with expected failover attempts | Sentry's OpenAI integration reported every retry | `disabled_integrations=[OpenAIIntegration()]` | Code |
| 6 | asyncpg `connection is closed` on `/auth/google/callback` | Hosted Postgres drops idle pooled connections | `pool_pre_ping=True`, `pool_recycle=300` | Code |
| 7 | Langfuse `401 Failed to export span batch` — no traces | `LANGFUSE_HOST` region mismatch (US project on EU host) | Point host at the correct region | Config (env) |

---

### Issue 1–3: The whole agent tier had to move to `gpt-oss` (tool-capable everywhere)

#### The problem
The failover chain was designed so the agent could survive any single provider dying. Production proved
that only works if **every** hop can actually do tool calling — and three of them couldn't:

- **Cerebras — `404 model llama-3.3-70b does not exist`** (~70 events in Sentry). Cerebras **retired the
  Llama models from its free/shared endpoint** and moved them to paid Dedicated Endpoints. Our
  STANDARD *and* FAST tiers both pointed at now-nonexistent Llama models, so Cerebras — the *first* hop —
  404'd on every request and the chain immediately fell through to Groq.
- **Groq — `400 tool_use_failed`** on the agent. `llama-3.3-70b-versatile` nominally "supports tools",
  but its emitted tool-call payload intermittently fails Groq's **strict server-side tool validator**,
  which rejects the whole request with a 400.
- **OpenRouter — silently wrong.** The backstop hop ran `gemma-4-31b`, and **Gemma has no real
  tool-calling support at all**. This was a latent bug: if the request ever reached OpenRouter for an
  agent turn, tool calling would simply not happen.

Net effect: an agent request could burn through all three providers and still fail — which is exactly
what produced the `500 Unknown error` (Issue 4).

#### The fix
Standardise the **entire STANDARD/agent tier on `gpt-oss-120b`** — a genuinely tool-reliable production
model — across all three providers, so every failover hop can complete an agent turn:

| Tier | Cerebras | Groq | OpenRouter | Tools needed? |
|---|---|---|---|---|
| **FAST** | `gpt-oss-120b` | `llama-3.1-8b-instant` | `gpt-oss-20b:free` | No |
| **STANDARD (agent)** | `gpt-oss-120b` | `openai/gpt-oss-120b` | `openai/gpt-oss-120b:free` | **Yes** |

The FAST tier (intent classification, query rewriting, summarising — no tools) keeps the small, quick
models. Only the STANDARD/agent tier was unified.

#### Decisions
- **One model family for the agent, not per-provider guesswork.** Picking a *different* tool-capable
  model per provider means three chances to pick wrong. `gpt-oss-120b` is offered as a first-class
  production model by all three, so the agent behaves identically no matter which hop serves it.
- **Verified against live provider docs, not assumed.** Cerebras docs confirmed the free public catalog
  is now `gpt-oss-120b` (production) with `gemma-4-31b`/`zai-glm-4.7` in preview; Groq docs confirmed
  `openai/gpt-oss-120b` is production and tool-reliable. The model names were changed on evidence, not a
  hunch.
- **Keep FAST small.** Classification and rewriting never call tools and run on the hot path, so paying
  120B latency there would be wasteful — FAST stays on the small models.
- **Env-overridable so the next retirement is a config change, not a redeploy.** Groq/Cerebras models
  are `LLM_*_MODEL_*` settings; when a free tier renames a model again, it's one env var. (OpenRouter's
  lives in the `_MODEL_TIER_MAP`, so that one still needs a deploy — noted below.)

#### Files changed
- `backend/app/core/config.py` — `LLM_CEREBRAS_MODEL_STANDARD` and `LLM_CEREBRAS_MODEL_FAST` → `gpt-oss-120b`;
  `LLM_GROQ_MODEL_STANDARD` → `openai/gpt-oss-120b` (`LLM_GROQ_MODEL_FAST` stays `llama-3.1-8b-instant`).
- `backend/app/core/llm_config.py` — OpenRouter STANDARD in `_MODEL_TIER_MAP` → `openai/gpt-oss-120b:free`
  (FAST stays `openai/gpt-oss-20b:free`).
- `Readme/steps_v5.md` — the failover tier table updated to reflect the uniform `gpt-oss` STANDARD tier.

#### How to verify it works
1. Resolve the tiers: STANDARD → `gpt-oss-120b` / `openai/gpt-oss-120b` / `openai/gpt-oss-120b:free`; FAST
   unchanged. (Confirmed via a one-off print of the resolved models.)
2. Ask the agent to create/update an idea → a proposal card appears, no `400 tool_use_failed`, no `404`.
3. Kill Cerebras/Groq keys one at a time → the agent still completes on the next hop because every hop is
   now tool-capable.

---

### Issue 4: Agent write path returned `500 Unknown error`

#### The problem
When *all three* providers failed a single agent turn (rate limits stacking, or the tool errors above),
the exception propagated out of `run_agent` unhandled. The user's create/update request died with a
raw `500 Unknown error` — the worst possible failure mode on a write, because it's ambiguous whether the
action happened.

#### The fix
Wrap the agent's completion call (and the closing-summary call) in `try/except`. On total failure the
agent logs it, records it **once** to Sentry, and returns a calm, honest message —
*"I'm having trouble reaching the AI service right now. Please try again in a moment."* — then breaks the
loop cleanly instead of throwing.

#### Decisions
- **Degrade, don't 500.** A user-facing outage message is far better than a stack trace; the request
  ends predictably and nothing half-writes.
- **Capture once, not per-attempt.** The `except` records a single Sentry event for the *whole* failed
  turn, so the outage stays visible without spamming (complements Issue 5).
- **Same treatment for the summary call.** The optional closing-summary completion is wrapped too, so a
  late failure can't undo a proposal that already succeeded.

#### Files changed
- `backend/app/services/agentic_ai/agent_service.py` — main completion wrapped in `try/except` →
  `sentry_sdk.capture_exception()` + friendly `final_message` + `break`; the summary completion wrapped
  the same way. (`import sentry_sdk` added.)

#### How to verify it works
1. Force all providers to fail (bad keys) and run an agent request → the chat shows the friendly message,
   the API returns **200**, and exactly **one** Sentry event is recorded — no `500`.
2. A normal agent request still produces a proposal card unchanged.

---

### Issue 5: Sentry flooded with *expected* failover attempts

#### The problem
Sentry's built-in OpenAI integration auto-captures every OpenAI-client call that raises. But the
failover chain *deliberately* provokes failures — a 429/404/400 on Cerebras is the signal to try Groq.
So every routine, healthy failover hop was landing in Sentry as its own issue, drowning the real bugs in
expected noise.

#### The fix
Disable just that integration at init: `disabled_integrations=[OpenAIIntegration()]`. FastAPI/Starlette
request tracking stays on; the LLM-call auto-capture that fights our failover design is turned off.
Langfuse already owns LLM observability, and genuine total-failure is still captured explicitly by the
Issue 4 handler.

#### Decisions
- **Division of labour.** Sentry watches *app* errors; Langfuse watches *LLM* calls. Letting Sentry
  also auto-watch LLM calls double-counts and conflicts with intentional failover.
- **Surgical, not blanket.** Only the OpenAI integration is disabled — everything else Sentry does is
  untouched.
- **We still see real LLM outages.** The explicit `capture_exception()` in the agent (Issue 4) and in
  the classifier/rewriter/summariser degradation paths keeps genuine "all providers down" visible.

#### Files changed
- `backend/app/main.py` — `disabled_integrations=[OpenAIIntegration()]` in `sentry_sdk.init`, gated behind
  `SENTRY_DSN`, with `send_default_pii=False`.

#### How to verify it works
1. Trigger a normal failover (429 on the first hop) → the request succeeds on the next provider and
   **no** Sentry issue is created for the expected retry.
2. Force a total outage → one Sentry event from the explicit handler still appears.

---

### Issue 6: asyncpg `connection is closed` on `/auth/google/callback`

#### The problem
Sentry showed intermittent `InterfaceError: connection is closed` (asyncpg), most visibly on
`/auth/google/callback`. Hosted Postgres (Render/Neon) closes idle connections **server-side**, but
SQLAlchemy's pool still handed out those now-dead connections. The first query on a revived-but-dead
connection blew up mid-request.

#### The fix
Enable connection health checks on the async engine: `pool_pre_ping=True` (test each pooled connection
with a lightweight ping before use, transparently replacing dead ones) and `pool_recycle=300` (proactively
retire connections older than 5 minutes, staying under the host's idle timeout).

#### Decisions
- **Pre-ping over hoping.** The ping cost is negligible next to an OAuth round-trip and eliminates the
  race entirely — the correct, standard fix for pooled connections behind a hosted DB.
- **Recycle as belt-and-braces.** 300s keeps connections comfortably younger than typical hosted idle
  timeouts so most are recycled before the server ever drops them.

#### Files changed
- `backend/app/db/postgres.py` — `create_async_engine(..., pool_pre_ping=True, pool_recycle=300)`.

#### How to verify it works
1. Leave the app idle past the DB's idle timeout, then hit `/auth/google/callback` (or any DB route) →
   it succeeds; the dead connection is silently replaced instead of raising `connection is closed`.
2. Normal traffic behaves identically (pre-ping is invisible on healthy connections).

---

### Issue 7: Langfuse `401 Failed to export span batch` — no traces appearing

#### The problem
Langfuse was configured and the app booted clean, but **no traces showed up** and Sentry/logs carried
`Failed to export span batch code: 401 Unauthorized`. Langfuse's OTel exporter authenticates against a
**region-specific host**: a project created in the **US** region rejects exports sent to the default
**EU** host (`https://cloud.langfuse.com`) with a 401, even when the keys are correct.

#### The fix
This is a **configuration** fix, not a code change — the code already reads `LANGFUSE_HOST` from env and
defaults sensibly. Set `LANGFUSE_HOST` to the region that matches the project (US →
`https://us.cloud.langfuse.com`, EU → `https://cloud.langfuse.com`) and confirm the public/secret keys
belong to that same project, then redeploy/restart so the exporter re-initialises.

#### Decisions
- **Config, not code.** The host is already an env var; hardcoding a region would just move the problem.
  The default stays EU (Langfuse's default) and US deployments override it.
- **Fail inert, never crash.** Tracing stays gated behind *both* keys, so a misconfigured host degrades
  to "no traces" rather than taking a request down — the 401 is an export-side warning, not a request
  error.

#### Files changed
- None (code already env-driven). Operational fix: set `LANGFUSE_HOST` (and verify keys) in the Render
  environment.

#### How to verify it works
1. With the correct region host + keys, send a chat → the reply's LLM call appears as a Langfuse trace
   and the `401 Failed to export span batch` warnings stop.
2. Thumbs 👍/👎 then reload → the `user-feedback` score persists on that trace.

---

### Deployment note (this round)

These fixes ship together and mostly land via **redeploy** so the updated `config.py` defaults and the
`_MODEL_TIER_MAP` change take effect. To patch the model issues *before* a full redeploy, the
env-overridable ones can be set directly in Render:

```
LLM_GROQ_MODEL_STANDARD=openai/gpt-oss-120b
LLM_CEREBRAS_MODEL_STANDARD=gpt-oss-120b
LLM_CEREBRAS_MODEL_FAST=gpt-oss-120b
LANGFUSE_HOST=https://us.cloud.langfuse.com   # only if the project is US-region
```

OpenRouter's STANDARD model lives in the code (`_MODEL_TIER_MAP`), not env, so that one requires the
redeploy. The graceful agent path (Issue 4), Sentry OpenAI-integration disable (Issue 5), and Postgres
pre-ping (Issue 6) are all code changes and take effect on deploy.

---

## Empty Search Wrongly Refused as "Out of Scope" (guardrail false positive)

### The problem
Asking *"do I have any dog ideas?"* worked — the assistant found and returned the matching idea. But
asking *"do I have any butterfly ideas?"* when no such idea existed replied with the off-topic refusal:
*"I can only help you with your saved ideas and tasks in Idea Vault."* That is wrong — the question is
perfectly in scope; the honest answer is simply "no, not yet." The only difference between the two
queries was whether retrieval found anything.

### Root cause
This was **not** a classifier bug — both queries route correctly to `SEMANTIC_SEARCH`. It surfaced at the
**generation** step. When retrieval returns zero ideas, the context block becomes *"The user has no
relevant ideas saved yet."* That empty context sits directly next to `STRICT_GUARDRAILS` in the system
prompt — and those guardrails contain the *exact* scope-refusal sentence plus the rule "you ONLY discuss
saved ideas; refuse if out of scope." The model reads an empty result as *out of scope* and copies the
refusal string verbatim. Because the trigger is an anchor **in the prompt** (not a model quirk), it
reproduced on both Llama and gpt-oss — which is why the issue predated the model swap.

### The fix
When retrieval returns **zero ideas** for a `LISTING`/`SEMANTIC_SEARCH` query, inject a short
"NO MATCHES FOUND" clause into the system prompt, placed **immediately after** `STRICT_GUARDRAILS` so it
wins on recency. It states explicitly that this is a valid, in-scope question, that the user simply has
nothing saved on the topic yet, that the model must **not** refuse or emit the scope-refusal string, and
that it should instead say so warmly and offer to help capture the idea. When ideas *are* found the clause
is absent and behaviour is unchanged.

### Decisions
- **Fix the false positive, don't weaken the guardrail.** The scope refusal is still exactly right for
  genuine off-topic questions (capital of France, "write me code"), which the classifier's `OUT_OF_SCOPE`
  short-circuit refuses *before* generation ever runs. Only the empty-result case needed disambiguating.
- **Override by recency, not by deletion.** Rather than stripping the refusal wording from the guardrails
  (which would regress real off-topic handling), the no-match clause is appended after them so the model
  sees the correct instruction last — the strongest, least invasive nudge.
- **Scope the clause to empty retrieval only.** It is emitted solely when `context["ideas"]` is empty for
  a listing/search intent, so populated answers, counts, and conversational turns are untouched.
- **Turn a dead end into a next step.** Instead of a flat "no," the assistant offers to help capture the
  idea — the empty result becomes a prompt to grow the vault, which is on-brand for the product.

### Files changed
- `backend/app/services/rag_service.py` — `_build_system_prompt` now builds a `no_results_note` when the
  retrieved `ideas` list is empty and injects it after `STRICT_GUARDRAILS` in the LISTING/SEMANTIC_SEARCH
  prompt.

### How to verify it works
1. Ask about a topic you have **no** idea for ("do I have any butterfly ideas?") → the assistant says you
   don't have one yet and offers to help add it — no scope refusal.
2. Ask about a topic you **do** have → the matching idea is returned as before (no behaviour change).
3. Ask a genuinely off-topic question ("what's the capital of France?") → still refused via the classifier's
   `OUT_OF_SCOPE` short-circuit, before generation.
4. Prompt check: `_build_system_prompt({"intent": "SEMANTIC_SEARCH", "ideas": []})` contains
   `NO MATCHES FOUND`; the same call with a non-empty `ideas` list does not.

