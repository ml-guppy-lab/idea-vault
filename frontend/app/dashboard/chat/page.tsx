/**
 * /dashboard/chat — Full-page Vault AI chat.
 *
 * Rendered inside the existing DashboardLayout so the Navbar is present.
 * ChatWindow reads history from sessionStorage, so any conversation started
 * in the floating widget continues seamlessly here.
 */

import ChatWindow from "@/components/chat/ChatWindow";
import { Sparkles } from "lucide-react";

export const metadata = { title: "Vault AI — Idea Vault" };

export default function ChatPage() {
  return (
    <div
      style={{
        // Fill the remaining viewport height below the Navbar
        height: "calc(100vh - 64px)",
        display: "flex",
        flexDirection: "column",
        padding: "1.2rem",
      }}
      className="bg-[rgba(240,248,255,0.6)] dark:bg-[rgba(8,12,22,0.8)]"
    >
      {/* Page heading */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          marginBottom: "1rem",
          flexShrink: 0,
        }}
      >
        <Sparkles
          size={22}
          className="text-[#3d7a8c] dark:text-[#b980f0]"
        />
        <h1
          className="logo-text"
          style={{ fontSize: "1.5rem", margin: 0 }}
        >
          Vault AI
        </h1>
        <span
          style={{ fontSize: "0.8rem", marginTop: 2 }}
          className="text-[#6b8fa0]"
        >
          — your idea brainstorming assistant
        </span>
      </div>

      {/* Chat card — fills all remaining height */}
      <div
        style={{
          flex: 1,
          borderRadius: 24,
          overflow: "hidden",
          border: "1px solid rgba(170,200,215,0.5)",
          boxShadow: "0 12px 32px rgba(80,120,140,0.12)",
          display: "flex",
          flexDirection: "column",
        }}
        className="
          [background:rgba(255,255,255,0.8)] [backdrop-filter:blur(16px)]
          dark:[background:rgba(16,22,38,0.9)] dark:[border-color:rgba(180,160,240,0.25)]
        "
      >
        {/* fullPage ChatWindow — no compact controls */}
        <ChatWindow />
      </div>
    </div>
  );
}
