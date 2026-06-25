/**
 * /dashboard/ai — Full-page Vault AI.
 *
 * A single conversation surface that handles both question answering (RAG
 * streaming) and idea improvement (agent proposals). The user never selects a
 * mode — the backend decides per message and UnifiedChatWindow renders the
 * right UI automatically.
 *
 * Rendered inside DashboardLayout (so the Navbar is present). UnifiedChatWindow
 * reads history from sessionStorage keyed by userId, isolated per account.
 */

import { cookies } from "next/headers";
import { Sparkles } from "lucide-react";

import UnifiedChatWindow from "@/components/chat/UnifiedChatWindow";

export const metadata = { title: "Vault AI — Idea Vault" };

const API =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000/api";

async function getUserId(): Promise<string> {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) return "";
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { id: string };
    return data.id;
  } catch {
    return "";
  }
}

export default async function VaultAiPage() {
  const userId = await getUserId();
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
        <Sparkles size={22} className="text-[#3d7a8c] dark:text-[#b980f0]" />
        <h1 className="logo-text" style={{ fontSize: "1.5rem", margin: 0 }}>
          Vault AI
        </h1>
        <span style={{ fontSize: "0.8rem", marginTop: 2 }} className="text-[#6b8fa0]">
          — ask about your ideas, or ask me to improve them
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
        <UnifiedChatWindow userId={userId} />
      </div>
    </div>
  );
}
