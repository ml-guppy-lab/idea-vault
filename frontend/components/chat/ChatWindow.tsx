"use client";

/**
 * ChatWindow — the core chat UI component.
 *
 * Responsibilities:
 *   - Manages the full message list (persisted to sessionStorage so history
 *     survives navigation between the floating widget and the full page).
 *   - Calls the Next.js SSE proxy (/api/chat) and parses the stream token
 *     by token, updating the in-progress assistant bubble in real time.
 *   - Supports two render modes:
 *       compact  → floating widget on the dashboard (fixed height, expand btn)
 *       full     → full-page layout at /dashboard/chat
 *
 * State persistence:
 *   Messages are saved to sessionStorage under "vault_ai_chat" whenever a
 *   stream completes. Both the widget and the full page read the same key, so
 *   history is never lost when the user clicks "Brainstorm with Vault AI".
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Sparkles, Maximize2, X, Trash2 } from "lucide-react";
import MessageBubble, { Message } from "./MessageBubble";
import ChatInput from "./ChatInput";

// ── Constants ──────────────────────────────────────────────────────────────────

const SESSION_KEY = "vault_ai_chat";

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I'm Vault AI, your idea brainstorming assistant. Ask me anything about your saved ideas, or let's brainstorm something new!",
};

// ── sessionStorage helpers ────────────────────────────────────────────────────

function loadMessages(): Message[] {
  if (typeof window === "undefined") return [WELCOME];
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [WELCOME];
    const parsed = JSON.parse(raw) as Message[];
    return parsed.length ? parsed : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

function saveMessages(msgs: Message[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(msgs));
  } catch {
    // sessionStorage quota exceeded or unavailable — fail silently
  }
}

// ── ChatWindow ────────────────────────────────────────────────────────────────

interface ChatWindowProps {
  /** Widget mode: constrained height, expand/close buttons visible. */
  compact?: boolean;
  /** Called when the user clicks the X button in compact mode. */
  onClose?: () => void;
}

export default function ChatWindow({ compact = false, onClose }: ChatWindowProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Load history from sessionStorage on first render
  const [messages, setMessages] = useState<Message[]>(() => loadMessages());
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  // Persist completed messages to sessionStorage after each exchange
  useEffect(() => {
    if (!streaming) saveMessages(messages);
  }, [messages, streaming]);

  // Auto-scroll to the latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send message & consume SSE stream ──────────────────────────────────────
  const sendMessage = useCallback(async (userText: string) => {
    setError("");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
    };

    // Placeholder assistant bubble so the cursor appears immediately
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      thinking: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });

      // Non-2xx → backend returned a JSON error (e.g. 429 rate limit)
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ detail: "Something went wrong" }));
        throw new Error(err.detail ?? "Request failed");
      }

      // ── Parse the SSE stream ─────────────────────────────────────────────
      // SSE events end with "\n\n". We buffer incomplete chunks and process
      // complete events as they arrive so the UI updates token by token.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on the SSE event boundary
        const parts = buffer.split("\n\n");
        // The last element may be an incomplete chunk — keep it in the buffer
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const event = JSON.parse(trimmed.slice(6)) as {
              type: "thinking" | "text" | "done" | "error";
              content: string;
            };

            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;

                if (event.type === "thinking") {
                  // Accumulate reasoning tokens into the collapsible Thinking block
                  return { ...m, thinking: (m.thinking ?? "") + event.content };
                }
                if (event.type === "text") {
                  // Accumulate reply tokens into the visible bubble
                  return { ...m, content: m.content + event.content };
                }
                if (event.type === "done") {
                  // Stream finished cleanly
                  return { ...m, isStreaming: false };
                }
                if (event.type === "error") {
                  // Backend signalled an error inside the stream
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
            // Malformed JSON chunk — skip and continue
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      // Remove the incomplete assistant bubble on a hard network error
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      // Guarantee isStreaming is cleared even if the `done` event was missed
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m,
        ),
      );
      setStreaming(false);
    }
  }, []);

  // ── Clear chat ─────────────────────────────────────────────────────────────
  function clearChat() {
    const fresh = [WELCOME];
    setMessages(fresh);
    saveMessages(fresh);
    setError("");
  }

  // ── Shared colours ─────────────────────────────────────────────────────────
  const headerBg  = isDark ? "rgba(16,22,38,0.95)"      : "rgba(255,255,255,0.88)";
  const headerBdr = isDark ? "rgba(180,160,240,0.2)"    : "rgba(170,200,215,0.4)";
  const bodyBg    = isDark ? "rgba(10,16,28,0.5)"       : "rgba(248,252,255,0.6)";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Header ───────────────────────────────────────────────────────────── */}
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
        {/* Vault AI branding */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <Sparkles
            size={compact ? 16 : 20}
            style={{
              color: isDark ? "#b980f0" : "#3d7a8c",
              flexShrink: 0,
            }}
          />
          <span
            className="logo-text"
            style={{ fontSize: compact ? "0.95rem" : "1.2rem", margin: 0 }}
          >
            Vault AI
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          {/* Clear history */}
          <IconBtn
            icon={<Trash2 size={14} />}
            title="Clear chat"
            onClick={clearChat}
            isDark={isDark}
          />

          {compact && (
            <>
              {/* Expand to full page (history is preserved via sessionStorage) */}
              <IconBtn
                icon={<Maximize2 size={14} />}
                title="Brainstorm with Vault AI"
                onClick={() => router.push("/dashboard/chat")}
                isDark={isDark}
              />
              {/* Close widget */}
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

      {/* "Brainstorm with Vault AI" button — compact mode only, below header */}
      {compact && (
        <button
          onClick={() => router.push("/dashboard/chat")}
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
          Brainstorm with Vault AI
        </button>
      )}

      {/* ── Message list ─────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: compact ? "0.7rem 0.9rem" : "1.2rem 1.4rem",
          background: bodyBg,
          // Smooth scrollbar in webkit
          scrollbarWidth: "thin",
          scrollbarColor: isDark
            ? "rgba(180,160,240,0.2) transparent"
            : "rgba(170,200,215,0.4) transparent",
        }}
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} isDark={isDark} />
        ))}

        {/* Error banner */}
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

        {/* Invisible anchor for auto-scroll */}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: compact ? "0.6rem 0.9rem" : "0.9rem 1.4rem",
          borderTop: `1px solid ${headerBdr}`,
          background: headerBg,
          backdropFilter: "blur(12px)",
          flexShrink: 0,
        }}
      >
        <ChatInput onSend={sendMessage} disabled={streaming} />
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
