"use client";

interface StatusIndicatorProps {
  message: string | null;
}

/**
 * Perplexity-style status indicator shown while the backend is classifying,
 * retrieving, or waiting for the first LLM token.
 * Renders nothing once the message is cleared (first text token arrives).
 */
export function StatusIndicator({ message }: StatusIndicatorProps) {
  if (!message) return null;

  return (
    <div className="flex items-center gap-2 px-1 py-1 text-sm text-muted-foreground">
      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-400 animate-bounce" />
      <span className="animate-pulse">{message}</span>
    </div>
  );
}
