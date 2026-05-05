import { cookies } from "next/headers";
import Navbar from "@/components/Navbar";

async function getUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) return null;

  const api = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

  try {
    const res = await fetch(
      `${api}/auth/me`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { id: string; email: string };
    // Derive a display name from the email (e.g. "sonal.kumari@example.com" → "Sonal Kumari")
    const username = data.email.split("@")[0];
    const name = username
      .split(/[._-]/)
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return { name, email: data.email };
  } catch {
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar user={user} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
