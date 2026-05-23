import { cookies } from "next/headers";
import DashboardClient from "@/components/DashboardClient";

type RawStatus = "raw" | "exploring" | "validated" | "building" | "shipped" | "abandoned";
type RawPriority = "low" | "medium" | "high";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1) as "Raw" | "Exploring" | "Validated" | "Building" | "Shipped" | "Abandoned";
}
function capPriority(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1) as "Low" | "Medium" | "High";
}

const API = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

async function fetchIdeas(token: string) {
  try {
    const res = await fetch(
      `${API}/ideas/list?limit=100`,

      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json() as { items: Array<{ _id: string; title: string; description?: string; tags: string[]; status: RawStatus; priority: RawPriority; createdAt: string }> };
    return data.items.map((idea, i) => ({
      id: idea._id,
      title: idea.title,
      description: idea.description ?? "",
      tags: idea.tags,
      status: capitalize(idea.status),
      priority: capPriority(idea.priority),
      createdAt: idea.createdAt,
      gradientIndex: i,
    }));
  } catch {
    return [];
  }
}

async function getUser(token: string) {
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (!res.ok) return { name: "there", userId: "" };
    const data = await res.json() as { id: string; email: string };
    const username = data.email.split("@")[0];
    const name = username.split(/[._-]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    return { name, userId: data.id };
  } catch {
    return { name: "there", userId: "" };
  }
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value ?? "";

  const [ideas, user] = await Promise.all([fetchIdeas(token), getUser(token)]);

  return <DashboardClient ideas={ideas} userName={user.name} userId={user.userId} />;
}

