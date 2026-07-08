"use client";

import { ThumbsUp, ThumbsDown } from "lucide-react";

import StreamingText from "./StreamingText";

// ── Types (exported so ChatWindow can import them) ────────────────────────

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** True while the SSE stream for this message is still open. */
  isStreaming?: boolean;
  /** True when the user stopped generation mid-stream (partial reply). */
  interrupted?: boolean;
  /** Langfuse trace id for this reply — enables thumbs feedback. */
  traceId?: string;
  /** The user's rating on this reply, once given. */
  feedback?: "up" | "down";
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

export default function MessageBubble({
  message,
  isDark,
  onFeedback,
}: {
  message: Message;
  isDark: boolean;
  /** Called when the user rates a completed assistant reply. */
  onFeedback?: (value: "up" | "down") => void;
}) {
  // ── User bubble ────────────────────────────────────────────────────────────
  if (message.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <div
          style={{
            maxWidth: "78%",
            padding: "0.65rem 1.1rem",
            borderRadius: "18px 18px 4px 18px",
            fontSize: "0.88rem",
            lineHeight: 1.55,
            wordBreak: "break-word",
            color: "#ffffff",
            background: "linear-gradient(135deg,#0ea5e9,#0284c7)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  // ── Assistant bubble ───────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
      <div style={{ maxWidth: "87%", display: "flex", flexDirection: "column", gap: 6 }}>

        {/* Reply bubble — rendered even while empty so the cursor appears immediately */}
        {(message.content || message.isStreaming) && (
          <div
            style={{
              padding: "0.65rem 1.1rem",
              borderRadius: "18px 18px 18px 4px",
              fontSize: "0.88rem",
              lineHeight: 1.55,
              wordBreak: "break-word",
              background: isDark ? "rgba(26,35,50,0.95)" : "rgba(255,255,255,0.88)",
              border: isDark
                ? "1px solid rgba(56,189,248,0.2)"
                : "1px solid rgba(125,211,252,0.4)",
              backdropFilter: "blur(8px)",
              boxShadow: isDark
                ? "0 4px 12px rgba(56,189,248,0.06)"
                : "0 4px 12px rgba(0,0,0,0.06)",
              color: isDark ? "#f8f9ff" : "#0f2f47",
            }}
          >
            <StreamingText text={message.content} isStreaming={!!message.isStreaming} />
          </div>
        )}

        {/* Subtle indicator when the user stopped this reply mid-generation. */}
        {message.interrupted && (
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: isDark ? "#f0b048" : "#b45309",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              paddingLeft: "0.2rem",
            }}
          >
            ⚠ Stopped
          </span>
        )}

        {/* Thumbs feedback — only once the reply is complete and traceable. */}
        {message.traceId && !message.isStreaming && onFeedback && (
          <div style={{ display: "flex", gap: 4, paddingLeft: "0.15rem", marginTop: 1 }}>
            {(() => {
              const rated = !!message.feedback;
              const base: React.CSSProperties = {
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                borderRadius: 7,
                border: "none",
                background: "transparent",
                cursor: rated ? "default" : "pointer",
                color: isDark ? "#7a8faa" : "#8aa0b2",
                transition: "color 0.15s ease, background 0.15s ease",
              };
              const up = message.feedback === "up";
              const down = message.feedback === "down";
              return (
                <>
                  <button
                    type="button"
                    aria-label="Helpful"
                    title="Helpful"
                    disabled={rated}
                    onClick={() => onFeedback("up")}
                    style={{ ...base, color: up ? "#22c55e" : base.color, opacity: rated && !up ? 0.4 : 1 }}
                  >
                    <ThumbsUp size={13} fill={up ? "#22c55e" : "none"} />
                  </button>
                  <button
                    type="button"
                    aria-label="Not helpful"
                    title="Not helpful"
                    disabled={rated}
                    onClick={() => onFeedback("down")}
                    style={{ ...base, color: down ? "#ef4444" : base.color, opacity: rated && !down ? 0.4 : 1 }}
                  >
                    <ThumbsDown size={13} fill={down ? "#ef4444" : "none"} />
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
