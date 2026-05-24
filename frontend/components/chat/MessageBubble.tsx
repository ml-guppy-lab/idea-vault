"use client";

import StreamingText from "./StreamingText";

// ── Types (exported so ChatWindow can import them) ─────────────────────────────

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
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
