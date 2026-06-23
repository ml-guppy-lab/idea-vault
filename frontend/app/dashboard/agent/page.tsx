import { Sparkles } from "lucide-react";

import { AgentChatWindow } from "@/components/agent/AgentChatWindow";

export const metadata = { title: "Vault AI Agent - Idea Vault" };

export default function AgentPage() {
  return (
    <div
      style={{
        height: "calc(100vh - 64px)",
        display: "flex",
        flexDirection: "column",
        padding: "1.2rem",
      }}
      className="bg-[rgba(240,248,255,0.6)] dark:[background:rgba(15,23,42,0.7)]"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          marginBottom: "1rem",
          flexShrink: 0,
        }}
      >
        <Sparkles size={22} className="text-[#0ea5e9] dark:text-[#38bdf8]" />
        <h1 style={{ fontSize: "1.5rem", margin: 0, color: "#0f2f47" }} className="logo-text dark:text-[#f8f9ff]">
          Vault AI Agent
        </h1>
        <span style={{ fontSize: "0.8rem", marginTop: 2 }} className="text-[#4f7891] dark:text-[#96b5cb]">
          Propose changes to your ideas - you always decide what gets applied.
        </span>
      </div>

      <div
        style={{
          flex: 1,
          borderRadius: 24,
          overflow: "hidden",
          border: "1px solid rgba(125,211,252,0.4)",
          boxShadow: "0 12px 32px rgba(14,165,233,0.12)",
          display: "flex",
          flexDirection: "column",
        }}
        className="[background:rgba(255,255,255,0.8)] [backdrop-filter:blur(16px)] dark:[background:var(--card)] dark:[border-color:rgba(56,189,248,0.25)]"
      >
        <AgentChatWindow />
      </div>
    </div>
  );
}
