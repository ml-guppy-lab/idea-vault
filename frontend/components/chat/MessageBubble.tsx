"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import StreamingText from "./StreamingText";

// ── Types (exported so ChatWindow can import them) ─────────────────────────────

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** Reasoning tokens from the model — shown in a collapsible "Thinking" block. */
  thinking?: string;
  /** True while the SSE stream for this message is still open. */
  isStreaming?: boolean;
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

export default function MessageBubble({
  message,
  isDark,
}: {
  message: Message;
  isDark: boolean;
}) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

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
            color: "#fff",
          }}
          // Matches the project's primary gradient in light/dark
          className="[background:linear-gradient(135deg,#3d7a8c,#1e4d5c)] dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a]"
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

        {/* Collapsible "Thinking" block — only shown when model has reasoning tokens */}
        {message.thinking && (
          <div
            style={{
              borderRadius: 12,
              overflow: "hidden",
              background: isDark ? "rgba(180,160,240,0.07)" : "rgba(143,211,244,0.08)",
              border: isDark
                ? "1px solid rgba(180,160,240,0.2)"
                : "1px solid rgba(143,211,244,0.3)",
            }}
          >
            <button
              onClick={() => setThinkingOpen((o) => !o)}
              aria-expanded={thinkingOpen}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                width: "100%",
                padding: "0.42rem 0.75rem",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "0.76rem",
                fontWeight: 600,
                color: isDark ? "#a0b0c8" : "#5a7d90",
                textAlign: "left",
              }}
            >
              <Brain size={12} />
              Thinking
              {thinkingOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>

            {thinkingOpen && (
              <div
                style={{
                  padding: "0.45rem 0.75rem 0.55rem",
                  fontSize: "0.79rem",
                  lineHeight: 1.55,
                  color: isDark ? "#8fafc8" : "#5a7d90",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  borderTop: isDark
                    ? "1px solid rgba(180,160,240,0.15)"
                    : "1px solid rgba(143,211,244,0.2)",
                }}
              >
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {/* Reply bubble — rendered even while empty so the cursor appears immediately */}
        {(message.content || message.isStreaming) && (
          <div
            style={{
              padding: "0.65rem 1.1rem",
              borderRadius: "18px 18px 18px 4px",
              fontSize: "0.88rem",
              lineHeight: 1.55,
              wordBreak: "break-word",
              background: isDark ? "rgba(20,28,45,0.85)" : "rgba(255,255,255,0.88)",
              border: isDark
                ? "1px solid rgba(180,160,240,0.2)"
                : "1px solid rgba(170,200,215,0.4)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
            }}
            className="text-[#1a3a44] dark:text-[#e8eef8]"
          >
            <StreamingText text={message.content} isStreaming={!!message.isStreaming} />
          </div>
        )}
      </div>
    </div>
  );
}
