"use client";

/**
 * UnifiedChatWindow — the single Vault AI chat surface.
 *
 * One conversation thread that transparently handles BOTH backend pipelines
 * behind `POST /api/ai/chat`:
 *
 *   - READ  (RAG): backend replies with an SSE stream (Content-Type:
 *     text/event-stream). Parsed token-by-token and rendered live, exactly
 *     like the old streaming chat.
 *   - WRITE (agent): backend replies with JSON `{ mode: "agent", message,
 *     proposals }`. The message is shown as a normal assistant bubble and the
 *     proposals are rendered as ProposalCards directly below it.
 *
 * The user never picks a mode. We detect which response arrived by inspecting
 * the response Content-Type, so the correct UI fires automatically.
 *
 * State persistence:
 *   The thread (and which proposals were already accepted/rejected) is saved to
 *   sessionStorage under "vault_ai_unified_{userId}". History is isolated per
 *   account and survives navigation between the floating widget and the full
 *   page. Persisting the resolved-proposal map means a restored proposal cannot
 *   be accepted a second time (which would otherwise duplicate ideas/tasks).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Sparkles, Maximize2, X, Trash2 } from "lucide-react";

import MessageBubble, { Message } from "./MessageBubble";
import ChatInput from "./ChatInput";
import { StatusIndicator } from "./StatusIndicator";
import { ProposalCard, type Proposal } from "@/components/agent/ProposalCard";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A chat message that may additionally carry agent proposals. */
interface UnifiedMessage extends Message {
  proposals?: Proposal[];
}

/** Decision applied to a proposal, keyed by proposal_id. Persisted with history. */
type ResolvedMap = Record<string, "accepted" | "rejected">;

interface PersistedState {
  messages: UnifiedMessage[];
  resolved: ResolvedMap;
  /** Backend conversation id. null until the first reply assigns one. */
  sessionId: string | null;
}

// ── Storage helpers — scoped per user so accounts never share history ─────────

function sessionKey(userId: string) {
  return `vault_ai_unified_${userId}`;
}

const WELCOME: UnifiedMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I'm Vault AI. Ask me anything about your saved ideas, or ask me to improve, " +
    "create, or organise them — when I suggest a change, you'll always review and approve it first.",
};

function loadState(userId: string): PersistedState {
  if (typeof window === "undefined") return { messages: [WELCOME], resolved: {}, sessionId: null };
  try {
    const raw = sessionStorage.getItem(sessionKey(userId));
    if (!raw) return { messages: [WELCOME], resolved: {}, sessionId: null };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const messages = Array.isArray(parsed.messages) && parsed.messages.length
      ? parsed.messages
      : [WELCOME];
    const resolved = parsed.resolved && typeof parsed.resolved === "object" ? parsed.resolved : {};
    const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : null;
    return { messages, resolved, sessionId };
  } catch {
    return { messages: [WELCOME], resolved: {}, sessionId: null };
  }
}

function saveState(userId: string, state: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(sessionKey(userId), JSON.stringify(state));
  } catch {
    // sessionStorage quota exceeded or unavailable — fail silently
  }
}

// ── UnifiedChatWindow ─────────────────────────────────────────────────────────

interface UnifiedChatWindowProps {
  /** The authenticated user's ID — used to scope sessionStorage per account. */
  userId: string;
  /** Widget mode: constrained height, expand/close buttons visible. */
  compact?: boolean;
  /** Called when the user clicks the X button in compact mode. */
  onClose?: () => void;
}

export default function UnifiedChatWindow({
  userId,
  compact = false,
  onClose,
}: UnifiedChatWindowProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const initial = loadState(userId);
  const [messages, setMessages] = useState<UnifiedMessage[]>(initial.messages);
  const [resolved, setResolved] = useState<ResolvedMap>(initial.resolved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  // Transient status ("Searching your ideas...", "Thinking…"). Never persisted.
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Backend conversation id. Kept in a ref so sendMessage always reads the
  // latest value (avoids a stale closure) and updates take effect immediately.
  const sessionIdRef = useRef<string | null>(initial.sessionId);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Persist completed exchanges (messages + resolved map + session id) once idle.
  useEffect(() => {
    if (!busy) saveState(userId, { messages, resolved, sessionId: sessionIdRef.current });
  }, [messages, resolved, busy, userId]);

  // Auto-scroll to the latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusMessage, error]);

  // ── Parse an SSE stream into the in-progress assistant bubble ───────────────
  const consumeStream = useCallback(async (res: Response, assistantId: string) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line ("\n\n").
      const parts = buffer.split("\n\n");
      // The last element may be an incomplete event — keep it buffered.
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        try {
          const event = JSON.parse(trimmed.slice(6)) as {
            type: "mode" | "session" | "status" | "thinking" | "text" | "done" | "error";
            content: string;
          };

          // "session" carries the backend conversation id for follow-ups.
          if (event.type === "session") {
            if (event.content) sessionIdRef.current = event.content;
            continue;
          }

          // "mode" (leading routing hint) and "thinking" tokens are not rendered.
          if (event.type === "mode" || event.type === "thinking") continue;

          if (event.type === "status") {
            setStatusMessage(event.content);
            continue;
          }

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m;
              if (event.type === "text") {
                setStatusMessage(null);
                return { ...m, content: m.content + event.content };
              }
              if (event.type === "done") {
                setStatusMessage(null);
                return { ...m, isStreaming: false };
              }
              if (event.type === "error") {
                setStatusMessage(null);
                return {
                  ...m,
                  content: event.content || "An error occurred. Please try again.",
                  isStreaming: false,
                };
              }
              return m;
            }),
          );
        } catch {
          // Malformed JSON chunk — skip and continue.
        }
      }
    }
  }, []);

  // ── Send message — detect read (SSE) vs write (JSON) and route accordingly ──
  const sendMessage = useCallback(
    async (userText: string) => {
      setError("");

      const userMsg: UnifiedMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: userText,
      };

      // Placeholder assistant bubble so a cursor appears immediately.
      const assistantId = crypto.randomUUID();
      const assistantMsg: UnifiedMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setBusy(true);
      // Optimistic indicator until the backend tells us what it's doing
      // (SSE status events) or the agent JSON arrives.
      setStatusMessage("Thinking…");

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userText,
            // null on the first message — the backend starts a session and
            // returns its id, which we reuse on every subsequent message.
            session_id: sessionIdRef.current,
          }),
        });

        if (!res.ok) {
          if (res.status === 401) {
            // Session fully gone — drop the placeholder and show the banner.
            setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            setSessionExpired(true);
            setStatusMessage(null);
            setBusy(false);
            return;
          }
          const err = await res
            .json()
            .catch(() => ({ detail: "Something went wrong" }));
          throw new Error(err.detail ?? "Request failed");
        }

        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.includes("text/event-stream")) {
          // ── READ path: stream tokens live ──────────────────────────────────
          await consumeStream(res, assistantId);
        } else {
          // ── WRITE path: agent JSON with proposals ──────────────────────────
          const data = (await res.json().catch(() => ({}))) as {
            mode?: string;
            message?: string;
            proposals?: Proposal[];
            session_id?: string;
          };
          if (data.session_id) sessionIdRef.current = data.session_id;
          setStatusMessage(null);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      typeof data.message === "string" && data.message.trim()
                        ? data.message
                        : "I reviewed your request.",
                    proposals: Array.isArray(data.proposals) ? data.proposals : [],
                    isStreaming: false,
                  }
                : m,
            ),
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
        // Remove the incomplete assistant bubble on a hard failure.
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setStatusMessage(null);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)),
        );
        setBusy(false);
      }
    },
    [consumeStream],
  );

  // ── Proposal accept / reject ────────────────────────────────────────────────
  const handleAcceptProposal = useCallback(
    async (proposal: Proposal) => {
      const response = await fetch("/api/agent/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposal.proposal_id,
          decision: "accept",
          proposal,
        }),
      });

      if (!response.ok) {
        // Let ProposalCard catch this and keep the card actionable.
        const payload = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(payload.detail ?? "Could not apply the change.");
      }

      // Applied data changed on the server — revalidate server components
      // (dashboard grid, idea detail) so they reflect the new state.
      router.refresh();
    },
    [router],
  );

  const handleRejectProposal = useCallback(() => {
    // Rejection is UI-only — the backend is never touched.
  }, []);

  const handleProposalResolved = useCallback(
    (proposalId: string, decision: "accepted" | "rejected") => {
      setResolved((prev) => ({ ...prev, [proposalId]: decision }));
    },
    [],
  );

  // ── Clear chat ──────────────────────────────────────────────────────────────
  function clearChat() {
    const fresh: PersistedState = { messages: [WELCOME], resolved: {}, sessionId: null };
    // Drop the backend conversation so the next message starts fresh.
    sessionIdRef.current = null;
    setMessages(fresh.messages);
    setResolved(fresh.resolved);
    saveState(userId, fresh);
    setError("");
    setSessionExpired(false);
  }

  // ── Shared colours ────────────────────────────────────────────────────────
  const headerBg = isDark ? "rgba(16,22,38,0.95)" : "rgba(255,255,255,0.88)";
  const headerBdr = isDark ? "rgba(180,160,240,0.2)" : "rgba(170,200,215,0.4)";
  const bodyBg = isDark ? "rgba(10,16,28,0.5)" : "rgba(248,252,255,0.6)";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: compact ? "0.6rem 0.9rem" : "0.9rem 1.4rem",
          background: headerBg,
          borderBottom: `1px solid ${headerBdr}`,
          backdropFilter: "blur(12px)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <Sparkles
            size={compact ? 16 : 20}
            style={{ color: isDark ? "#b980f0" : "#3d7a8c", flexShrink: 0 }}
          />
          <span
            className="logo-text"
            style={{ fontSize: compact ? "0.95rem" : "1.2rem", margin: 0 }}
          >
            Vault AI
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <IconBtn
            icon={<Trash2 size={14} />}
            title="Clear chat"
            onClick={clearChat}
            isDark={isDark}
          />

          {compact && (
            <>
              <IconBtn
                icon={<Maximize2 size={14} />}
                title="Open full Vault AI"
                onClick={() => router.push("/dashboard/ai")}
                isDark={isDark}
              />
              <IconBtn
                icon={<X size={14} />}
                title="Close"
                onClick={onClose}
                isDark={isDark}
              />
            </>
          )}
        </div>
      </div>

      {/* Expand button — compact mode only */}
      {compact && (
        <button
          onClick={() => router.push("/dashboard/ai")}
          style={{
            margin: "0.5rem 0.9rem 0",
            padding: "0.4rem 0.9rem",
            borderRadius: 50,
            border: isDark
              ? "1px solid rgba(180,160,240,0.3)"
              : "1px solid rgba(143,211,244,0.5)",
            background: isDark
              ? "rgba(180,160,240,0.1)"
              : "rgba(143,211,244,0.12)",
            fontSize: "0.76rem",
            fontWeight: 600,
            cursor: "pointer",
            color: isDark ? "#c0a0f0" : "#3d7a8c",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            alignSelf: "flex-start",
            transition: "all 0.2s ease",
            flexShrink: 0,
          }}
        >
          <Maximize2 size={12} />
          Open full Vault AI
        </button>
      )}

      {/* ── Message list ───────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: compact ? "0.7rem 0.9rem" : "1.2rem 1.4rem",
          background: bodyBg,
          scrollbarWidth: "thin",
          scrollbarColor: isDark
            ? "rgba(180,160,240,0.2) transparent"
            : "rgba(170,200,215,0.4) transparent",
        }}
      >
        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble message={msg} isDark={isDark} />

            {/* Agent proposals render directly below the assistant bubble. */}
            {msg.role === "assistant" && msg.proposals && msg.proposals.length > 0 && (
              <div style={{ marginLeft: compact ? 0 : "0.25rem", marginBottom: "0.75rem" }}>
                {msg.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.proposal_id}
                    proposal={proposal}
                    initialStatus={resolved[proposal.proposal_id]}
                    onAccept={handleAcceptProposal}
                    onReject={handleRejectProposal}
                    onResolved={handleProposalResolved}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Status indicator — between the user message and the first response. */}
        <StatusIndicator message={statusMessage} />

        {/* Session-expired banner */}
        {sessionExpired && (
          <div
            style={{
              margin: "0.5rem 0",
              padding: "0.7rem 1rem",
              borderRadius: 12,
              fontSize: "0.82rem",
              background: "rgba(255,107,107,0.1)",
              border: "1px solid rgba(255,107,107,0.3)",
              color: "#FF6B6B",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <span>Your session has expired. Please log in again to continue.</span>
            <a
              href="/login"
              style={{
                flexShrink: 0,
                padding: "0.3rem 0.8rem",
                borderRadius: 8,
                background: "rgba(255,107,107,0.2)",
                color: "#FF6B6B",
                fontWeight: 600,
                textDecoration: "none",
                fontSize: "0.8rem",
                border: "1px solid rgba(255,107,107,0.35)",
              }}
            >
              Log in
            </a>
          </div>
        )}

        {/* Generic error banner */}
        {error && (
          <div
            style={{
              margin: "0.5rem 0",
              padding: "0.55rem 0.9rem",
              borderRadius: 12,
              fontSize: "0.8rem",
              background: "rgba(255,107,107,0.12)",
              border: "1px solid rgba(255,107,107,0.3)",
              color: "#FF6B6B",
            }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: compact ? "0.6rem 0.9rem" : "0.9rem 1.4rem",
          borderTop: `1px solid ${headerBdr}`,
          background: headerBg,
          backdropFilter: "blur(12px)",
          flexShrink: 0,
        }}
      >
        <ChatInput
          onSend={sendMessage}
          disabled={busy}
          placeholder="Ask about your ideas, or ask me to improve them…"
        />
      </div>
    </div>
  );
}

// ── Small icon button helper ──────────────────────────────────────────────────

function IconBtn({
  icon,
  title,
  onClick,
  isDark,
}: {
  icon: React.ReactNode;
  title: string;
  onClick?: () => void;
  isDark: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        border: "none",
        background: hovered
          ? isDark
            ? "rgba(180,160,240,0.15)"
            : "rgba(143,211,244,0.2)"
          : "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: isDark ? "#a0b0c8" : "#5a7d90",
        transition: "all 0.15s ease",
      }}
    >
      {icon}
    </button>
  );
}
