"use client";

import { useState, useRef, KeyboardEvent, ChangeEvent } from "react";
import { Send, Loader2 } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  /** Disabled while the stream is open — prevents sending multiple requests. */
  disabled: boolean;
  placeholder?: string;
}

export default function ChatInput({
  onSend,
  disabled,
  placeholder = "Ask about your ideas…",
}: ChatInputProps) {
  const [value, setValue]     = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset auto-expanded height
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts a newline (natural behaviour)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    // Auto-grow textarea up to ~5 lines, then scroll
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "0.5rem",
        padding: "0.55rem 0.7rem",
        borderRadius: 18,
        border: `2px solid ${focused ? "#8FD3F4" : "rgba(170,200,215,0.5)"}`,
        boxShadow: focused
          ? "0 0 0 4px rgba(143,211,244,0.15), 0 4px 12px rgba(80,120,140,0.08)"
          : "0 4px 12px rgba(80,120,140,0.08)",
        transition: "all 0.2s ease",
        background: "rgba(255,255,255,0.6)",
        backdropFilter: "blur(8px)",
      }}
      className="dark:bg-[rgba(20,28,45,0.6)] dark:border-[rgba(100,120,170,0.35)]"
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        maxLength={500}
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: "0.88rem",
          resize: "none",
          fontFamily: "inherit",
          lineHeight: 1.5,
          padding: "0.15rem 0",
          overflowY: "hidden",
        }}
        className="text-[#1a3a44] dark:text-[#e8eef8] placeholder:text-[#6b8fa0] disabled:opacity-50"
      />

      <button
        onClick={submit}
        disabled={!canSend}
        aria-label="Send message"
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: 10,
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: canSend ? "pointer" : "not-allowed",
          opacity: canSend ? 1 : 0.45,
          transition: "all 0.2s ease",
        }}
        className="[background:linear-gradient(135deg,#3d7a8c,#1e4d5c)] dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)]"
      >
        {disabled ? (
          <Loader2 size={15} color="#fff" className="animate-spin" />
        ) : (
          <Send size={14} color="#fff" />
        )}
      </button>
    </div>
  );
}
