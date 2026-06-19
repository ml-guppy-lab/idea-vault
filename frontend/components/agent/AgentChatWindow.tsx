"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useTheme } from "next-themes";

import ChatInput from "@/components/chat/ChatInput";
import MessageBubble, { Message } from "@/components/chat/MessageBubble";

import { ProposalCard, type Proposal } from "./ProposalCard";

interface AgentMessage extends Message {
  proposals?: Proposal[];
}

interface AgentResponse {
  message: string;
  proposals?: Proposal[];
}

const SUGGESTED_ACTIONS = [
  "Improve my most recent idea",
  "Break down my highest priority idea into tasks",
  "Create a new idea for a mobile app",
  "Update my building-status ideas with better descriptions",
] as const;

function extractErrorMessage(payload: unknown): string {
  if (typeof payload === "string" && payload.trim()) return payload;

  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
    if (typeof data.error === "string" && data.error.trim()) return data.error;
  }

  return "Something went wrong. Please try again.";
}

export function AgentChatWindow() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, error]);

  const sendMessage = async (userMessage: string) => {
    if (isLoading) return;

    const trimmed = userMessage.trim();
    if (!trimmed) return;

    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      },
    ]);

    setIsLoading(true);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      const payload = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        if (response.status === 401) {
          setError("Session expired. Please sign in again.");
          return;
        }
        throw new Error(extractErrorMessage(payload));
      }

      const data = payload as AgentResponse;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            typeof data.message === "string" && data.message.trim()
              ? data.message
              : "I reviewed your request.",
          proposals: Array.isArray(data.proposals) ? data.proposals : [],
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcceptProposal = async (proposal: Proposal) => {
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
      const payload = (await response.json().catch(() => ({}))) as unknown;
      throw new Error(extractErrorMessage(payload));
    }
  };

  const handleRejectProposal = () => {
    // Rejection is a UI-only action in this first version.
    // The backend remains unchanged when a proposal is rejected.
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <div>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold">Vault AI Agent</h2>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Ask me to improve, create, or organize your ideas. I will always show what I want to
                change before anything is applied.
              </p>
            </div>

            <div className="grid w-full max-w-md grid-cols-1 gap-2">
              {SUGGESTED_ACTIONS.map((action) => (
                <button
                  key={action}
                  onClick={() => {
                    void sendMessage(action);
                  }}
                  disabled={isLoading}
                  className="rounded-xl border border-border px-4 py-3 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble message={msg} isDark={isDark} />

            {msg.role === "assistant" && msg.proposals && msg.proposals.length > 0 ? (
              <div className="mb-4 ml-10 space-y-2">
                {msg.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.proposal_id}
                    proposal={proposal}
                    onAccept={handleAcceptProposal}
                    onReject={handleRejectProposal}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {isLoading ? (
          <div className="mb-4 ml-10 flex items-center gap-3">
            <div className="flex gap-1">
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: "300ms" }}
              />
            </div>
            <span className="text-sm text-muted-foreground">Vault AI is thinking...</span>
          </div>
        ) : null}

        {error ? (
          <div className="mx-4 mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <ChatInput
        onSend={(message) => {
          void sendMessage(message);
        }}
        disabled={isLoading}
        placeholder="Ask Vault AI to improve or create ideas..."
      />
    </div>
  );
}
