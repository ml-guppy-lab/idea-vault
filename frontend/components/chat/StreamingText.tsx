"use client";

/**
 * StreamingText — renders accumulated text with an animated blinking cursor
 * while tokens are still arriving. The cursor disappears when streaming ends.
 *
 * The `.vault-ai-cursor` animation is defined in globals.css.
 */
export default function StreamingText({
  text,
  isStreaming,
}: {
  text: string;
  /** True while the SSE stream is still open and tokens may still arrive. */
  isStreaming: boolean;
}) {
  return (
    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {text}
      {isStreaming && (
        <span
          aria-hidden
          className="vault-ai-cursor"
          style={{
            display: "inline-block",
            width: 2,
            height: "1em",
            background: "currentColor",
            marginLeft: 2,
            verticalAlign: "text-bottom",
          }}
        />
      )}
    </span>
  );
}
