import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import BackgroundTasks
from motor.motor_asyncio import AsyncIOMotorDatabase
from openai import AsyncOpenAI, RateLimitError

from app.core.llm_config import llm_config
from app.db.mongodb import get_mongo_db
from app.schemas.agent import (
	AgentResponse,
	IdeaCreationProposal,
	IdeaUpdateProposal,
	Proposal,
	ProposalStatus,
	TaskCreationProposal,
)
from app.ai.handlers import handle_semantic_search
from app.schemas.task import TaskInDB
from app.services.agentic_ai.agent_tools import AGENT_TOOLS, PROPOSAL_TOOLS, READ_ONLY_TOOLS
from app.services.embedding_service import generate_idea_embedding
from app.services.intent_classifier import STRICT_GUARDRAILS

logger = logging.getLogger(__name__)


# System prompt is the behavioral policy for this agent.
# It teaches the model when to search, when to propose, and when to just chat.
AGENT_SYSTEM_PROMPT = """You are Vault AI - an intelligent assistant for Idea Vault.
You have access to tools that let you search ideas and propose changes.

IMPORTANT RULES:
1. Always search for an idea BEFORE proposing changes to it. You need the current content.
2. When proposing changes, always include current_title and current_description so the user can see the diff.
3. You can propose multiple changes in a single response - the user will review each one.
4. Never make up idea IDs - always get them from search results.
5. Be specific in your reasoning - tell the user exactly why you are proposing each change.
6. If the user just wants to chat or ask questions (not make changes), respond with text only - do not use tools.
7. When proposing title or description changes that significantly alter the meaning of an idea, also propose a new_summary that captures the updated concept in 2-3 sentences (max 190 words). The summary feeds semantic search, so it must reflect the idea's current meaning. If the changes are minor (fixing typos, small wording tweaks), leave the summary unchanged and omit new_summary.

The user's ideas will be provided to you via the search_ideas tool.

""" + STRICT_GUARDRAILS


def _to_openai_tool_calls(tool_calls: Any) -> list[dict[str, Any]]:
	"""Convert OpenAI tool call objects into plain dicts for message history."""
	# The SDK returns rich objects, but the next LLM call expects JSON-like dicts.
	serialised: list[dict[str, Any]] = []
	for tc in tool_calls:
		serialised.append(
			{
				"id": tc.id,
				"type": "function",
				"function": {
					"name": tc.function.name,
					"arguments": tc.function.arguments,
				},
			}
		)
	return serialised


def _safe_json_loads(raw: str) -> dict[str, Any]:
	# Tool arguments arrive as JSON strings from the LLM.
	# We parse defensively so one bad tool call does not crash the full turn.
	try:
		parsed = json.loads(raw)
		if isinstance(parsed, dict):
			return parsed
		return {"_raw": parsed}
	except json.JSONDecodeError:
		logger.warning("Tool arguments were not valid JSON: %s", raw)
		return {"_invalid_json": raw}


def _summary_from_description(description: str, max_words: int = 190) -> str:
	# Idea summaries are intentionally short because they feed embeddings/search.
	words = description.split()
	if not words:
		return ""
	return " ".join(words[:max_words])


def _serialize_for_json(obj: Any) -> Any:
	"""
	Recursively convert non-JSON-serializable objects (like datetime) to strings.
	Handles dicts, lists, and datetime objects that come from MongoDB.
	"""
	if isinstance(obj, datetime):
		return obj.isoformat()
	if isinstance(obj, dict):
		return {k: _serialize_for_json(v) for k, v in obj.items()}
	if isinstance(obj, list):
		return [_serialize_for_json(item) for item in obj]
	return obj


async def _create_completion_with_fallback(
	client: AsyncOpenAI,
	*,
	messages: list[dict[str, Any]],
	tools: list[dict[str, Any]] | None = None,
	tool_choice: str | None = None,
	max_tokens: int,
) -> Any:
	"""Retry transient 429s, then switch to the configured fallback model."""
	request_kwargs: dict[str, Any] = {
		"messages": messages,
		"max_tokens": max_tokens,
	}
	if tools is not None:
		request_kwargs["tools"] = tools
	if tool_choice is not None:
		request_kwargs["tool_choice"] = tool_choice

	last_exc: RateLimitError | None = None
	for attempt in range(1, 4):
		try:
			return await client.chat.completions.create(
				model=llm_config.model,
				**request_kwargs,
			)
		except RateLimitError as exc:
			last_exc = exc
			if attempt < 3:
				await asyncio.sleep(2 ** attempt)

	fallback = llm_config.fallback_model
	if fallback:
		logger.warning("Primary agent model rate-limited; retrying with fallback model %s", fallback)
		return await client.chat.completions.create(
			model=fallback,
			**request_kwargs,
		)

	raise last_exc  # type: ignore[misc]


async def run_agent(
	user_message: str, user_id: str, history: list[dict] | None = None
) -> AgentResponse:
	"""
	Run one human-in-the-loop agent turn.

	Behavior:
	- Sends the user message to the LLM with all tools.
	- Executes read-only tools immediately.
	- Converts write tools into proposals (never writes DB here).
	- Returns assistant text + pending proposals.
	"""
	client = AsyncOpenAI(
		base_url=llm_config.base_url,
		api_key=llm_config.api_key,
		default_headers=llm_config.extra_headers,
	)

	# Conversation state sent back to the model on each iteration. Prior turns
	# (already windowed by the caller) give the agent context for follow-ups like
	# "now improve it" — inserted between the system prompt and the new message. A
	# leading "system" turn may carry the rolling summary (ours, not user input).
	messages: list[dict[str, Any]] = [{"role": "system", "content": AGENT_SYSTEM_PROMPT}]
	for turn in history or []:
		role = turn.get("role")
		content = turn.get("content")
		if role in ("user", "assistant", "system") and content:
			messages.append({"role": role, "content": content[:500]})
	messages.append({"role": "user", "content": user_message.strip()[:500]})

	# Proposals are pending write-intents. They are NOT executed here.
	proposals: list[Proposal] = []
	final_message = ""
	db = get_mongo_db()

	# Max 3 turns: tool discovery -> tool results -> final explanation.
	for _ in range(3):
		# 1) Ask model what to do (plain answer vs. tool calls).
		response = await _create_completion_with_fallback(
			client,
			messages=messages,
			tools=AGENT_TOOLS,
			tool_choice="auto",
			max_tokens=1200,
		)
		choices = getattr(response, "choices", None)
		if not choices:
			logger.error(
				"Agent completion returned no choices (model=%s, user_id=%s).",
				llm_config.model,
				user_id,
			)
			final_message = (
				"I hit a temporary AI provider issue while processing that request. "
				"Please try again."
			)
			break

		choice = choices[0]

		if choice.finish_reason == "stop":
			# Model answered directly with text. End the loop.
			final_message = choice.message.content or ""
			break

		if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
			# 2) Save assistant tool-call step into history before executing tools.
			messages.append(
				{
					"role": "assistant",
					"content": choice.message.content or "",
					"tool_calls": _to_openai_tool_calls(choice.message.tool_calls),
				}
			)

			tool_results: list[dict[str, Any]] = []
			for tool_call in choice.message.tool_calls:
				tool_name = tool_call.function.name
				args = _safe_json_loads(tool_call.function.arguments)

				if tool_name in READ_ONLY_TOOLS:
					# Read tool path: execute immediately and return data to model.
					result = await _execute_read_tool(tool_name, args, user_id, db)
					tool_results.append(
						{
							"tool_call_id": tool_call.id,
							"role": "tool",
							"content": json.dumps(result),
						}
					)
					continue

				if tool_name in PROPOSAL_TOOLS:
					try:
						# Write tool path: create proposal object only (no DB writes).
						proposal = _build_proposal(tool_name, args)
						proposals.append(proposal)
						tool_results.append(
							{
								"tool_call_id": tool_call.id,
								"role": "tool",
								"content": json.dumps(
									{
										"status": "proposal_created",
										"proposal_id": proposal.proposal_id,
									}
								),
							}
						)
					except Exception as exc:
						logger.exception("Failed building proposal for tool %s", tool_name)
						tool_results.append(
							{
								"tool_call_id": tool_call.id,
								"role": "tool",
								"content": json.dumps(
									{
										"status": "error",
										"error": f"invalid_proposal_args: {exc}",
									}
								),
							}
						)
					continue

				# Unknown tool name: return explicit error so the model can self-correct.
				tool_results.append(
					{
						"tool_call_id": tool_call.id,
						"role": "tool",
						"content": json.dumps({"status": "error", "error": "unknown_tool"}),
					}
				)

			# 3) Feed tool outputs back to the model for next reasoning step.
			messages.extend(tool_results)

			only_proposals = all(tc.function.name in PROPOSAL_TOOLS for tc in choice.message.tool_calls)
			if only_proposals:
				# If no read-tools were needed, ask model for a concise user-facing summary.
				summary = await _create_completion_with_fallback(
					client,
					messages=messages
					+ [
						{
							"role": "user",
							"content": "Briefly summarise what changes you are proposing and why. Keep it concise.",
						}
					],
					max_tokens=220,
				)
				summary_choices = getattr(summary, "choices", None)
				if summary_choices:
					final_message = summary_choices[0].message.content or ""
				else:
					logger.warning(
						"Agent summary completion returned no choices (model=%s, user_id=%s).",
						llm_config.model,
						user_id,
					)
					final_message = "I reviewed your request and prepared suggestions."
				break

	if not final_message:
		# Safety fallback so API contract always returns a non-empty message.
		final_message = "I reviewed your request and prepared suggestions."

	return AgentResponse(message=final_message, proposals=proposals)


async def _execute_read_tool(
	tool_name: str,
	args: dict[str, Any],
	user_id: str,
	db: AsyncIOMotorDatabase,
) -> dict[str, Any]:
	"""Execute read-only tools with user scoping enforced."""
	if tool_name == "search_ideas":
		# Read-only tools are safe to run immediately because they do not mutate state.
		query = str(args.get("query", "")).strip()
		if not query:
			return {"ideas": [], "error": "query is required"}

		# Reuse the app's existing semantic-search fallback behavior:
		# if vector search finds nothing, return recent ideas instead.
		search_context = await handle_semantic_search(
			query=query,
			user_id=user_id,
			db=db,
		)
		# MongoDB returns datetime objects; convert to ISO strings so json.dumps works.
		return {"ideas": _serialize_for_json(search_context["ideas"])}

	return {"error": f"Unknown tool: {tool_name}"}


def _build_proposal(tool_name: str, args: dict[str, Any]) -> Proposal:
	"""Convert tool arguments into a typed pending proposal (no DB writes)."""
	# Each proposal gets a server-side UUID so frontend can approve/reject it later.
	proposal_id = str(uuid.uuid4())

	if tool_name == "propose_idea_update":
		return IdeaUpdateProposal(
			proposal_id=proposal_id,
			status=ProposalStatus.pending,
			idea_id=args["idea_id"],
			current_title=args["current_title"],
			new_title=args["new_title"],
			current_description=args.get("current_description"),
			new_description=args.get("new_description"),
			current_summary=args.get("current_summary"),
			new_summary=args.get("new_summary"),
			new_status=args.get("new_status"),
			new_priority=args.get("new_priority"),
			reasoning=args["reasoning"],
		)

	if tool_name == "propose_idea_creation":
		return IdeaCreationProposal(
			proposal_id=proposal_id,
			status=ProposalStatus.pending,
			title=args["title"],
			description=args["description"],
			proposed_status=args.get("status", "raw"),
			proposed_priority=args.get("priority", "low"),
			tags=args.get("tags", []),
			reasoning=args["reasoning"],
		)

	if tool_name == "propose_task_creation":
		return TaskCreationProposal(
			proposal_id=proposal_id,
			status=ProposalStatus.pending,
			idea_id=args["idea_id"],
			idea_title=args["idea_title"],
			task_title=args["task_title"],
			task_description=args.get("task_description"),
			reasoning=args["reasoning"],
		)

	raise ValueError(f"Unknown proposal tool: {tool_name}")


async def execute_proposal(
	proposal: Proposal,
	user_id: str,
	background_tasks: BackgroundTasks,
) -> dict[str, Any]:
	"""
	Apply an accepted proposal to MongoDB.

	This is the only write path in this service and must be called only after
	explicit user approval. `background_tasks` lets us re-embed updated ideas
	after the response is sent, keeping the accept call fast.
	"""
	db = get_mongo_db()

	if proposal.proposal_type == "idea_update":
		try:
			# Convert user-supplied string id into Mongo ObjectId safely.
			idea_oid = ObjectId(proposal.idea_id)
		except Exception:
			return {"success": False, "error": "Invalid idea ID"}

		# Ownership check: never update data outside this authenticated user scope.
		idea = await db.ideas.find_one({"_id": idea_oid, "userId": user_id})
		if not idea:
			return {"success": False, "error": "Idea not found or access denied"}

		updates: dict[str, Any] = {"updatedAt": datetime.now(timezone.utc)}
		if proposal.new_title:
			updates["title"] = proposal.new_title
		if proposal.new_description is not None:
			updates["description"] = proposal.new_description
		# Summary feeds the embedding/vector index. The agent only proposes a
		# new_summary when the idea's meaning genuinely changed, so when present
		# we persist it and re-embed below to keep semantic search accurate.
		if proposal.new_summary is not None:
			updates["summary"] = proposal.new_summary
		if proposal.new_status is not None:
			updates["status"] = proposal.new_status
		if proposal.new_priority is not None:
			updates["priority"] = proposal.new_priority

		# Apply the approved patch.
		await db.ideas.update_one({"_id": idea_oid, "userId": user_id}, {"$set": updates})

		# Re-embed in the background when an embedded field (title or summary)
		# actually changed. Embedding input = title + summary; description/status/
		# priority are not embedded. Running it as a background task keeps the
		# accept response fast — the CPU-bound encode happens after we respond.
		title_changed = "title" in updates and updates["title"] != idea.get("title")
		summary_changed = "summary" in updates and updates["summary"] != idea.get("summary")
		if title_changed or summary_changed:
			# Local import avoids a circular dependency (api.ideas imports services).
			from app.api.ideas import _embed_and_store

			final_title = updates.get("title", idea.get("title", ""))
			final_summary = (
				updates.get("summary")
				or idea.get("summary")
				or _summary_from_description(idea.get("description") or final_title)
			)
			background_tasks.add_task(_embed_and_store, db, idea_oid, final_title, final_summary)

		return {
			"success": True,
			"message": f"Updated idea: {proposal.new_title}",
			"proposal_id": proposal.proposal_id,
		}

	if proposal.proposal_type == "idea_creation":
		now = datetime.now(timezone.utc)
		# The proposal has description; we derive a compact summary for embedding/search.
		summary = _summary_from_description(proposal.description)
		if not summary:
			summary = proposal.title

		doc: dict[str, Any] = {
			"userId": user_id,
			"title": proposal.title,
			"summary": summary,
			"description": proposal.description,
			"tags": proposal.tags,
			"status": proposal.proposed_status,
			"priority": proposal.proposed_priority,
			"createdAt": now,
			"updatedAt": now,
			"tasks": [],
		}

		try:
			# Embedding generation may fail due to provider/network issues.
			# We log and continue so approved writes are not blocked.
			doc["embedding"] = await asyncio.to_thread(generate_idea_embedding, proposal.title, summary)
		except Exception:
			logger.exception("Failed to generate embedding for proposed idea creation")

		result = await db.ideas.insert_one(doc)
		return {
			"success": True,
			"message": f"Created idea: {proposal.title}",
			"idea_id": str(result.inserted_id),
			"proposal_id": proposal.proposal_id,
		}

	if proposal.proposal_type == "task_creation":
		try:
			idea_oid = ObjectId(proposal.idea_id)
		except Exception:
			return {"success": False, "error": "Invalid idea ID"}

		# Parent ownership check before embedding task under the idea.
		parent_idea = await db.ideas.find_one({"_id": idea_oid, "userId": user_id})
		if not parent_idea:
			return {"success": False, "error": "Parent idea not found or access denied"}

		# Tasks are embedded in ideas in this codebase; map task_description to notes.
		task_doc = TaskInDB(
			title=proposal.task_title,
			notes=proposal.task_description,
		).model_dump()

		await db.ideas.update_one(
			{"_id": idea_oid, "userId": user_id},
			{
				"$push": {"tasks": task_doc},
				"$set": {"updatedAt": datetime.now(timezone.utc)},
			},
		)

		return {
			"success": True,
			"message": f"Created task: {proposal.task_title}",
			"task_id": task_doc["id"],
			"proposal_id": proposal.proposal_id,
		}

	return {"success": False, "error": "Unknown proposal type"}
