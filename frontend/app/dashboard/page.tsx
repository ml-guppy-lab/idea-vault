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

async function fetchIdeas(token: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/ideas/list?limit=100`,
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
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (!res.ok) return "there";
    const data = await res.json() as { email: string };
    const username = data.email.split("@")[0];
    return username.split(/[._-]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  } catch {
    return "there";
  }
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value ?? "";

  const [ideas, userName] = await Promise.all([fetchIdeas(token), getUser(token)]);

  return <DashboardClient ideas={ideas} userName={userName} />;
}

