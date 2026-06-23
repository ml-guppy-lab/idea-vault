import { cookies } from "next/headers";
import Navbar from "@/components/Navbar";
import { Plus_Jakarta_Sans } from "next/font/google";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

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
    const data = await res.json() as { id: string; email: string; display_name?: string | null; avatar_url?: string | null };
    // Use display_name if set, otherwise derive from email
    const name = data.display_name?.trim() ||
      data.email.split("@")[0]
        .split(/[._-]/)
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    return { name, email: data.email, avatarUrl: data.avatar_url ?? undefined };
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
    <div className={`${jakarta.className} min-h-screen flex flex-col bg-[radial-gradient(circle_at_10%_10%,rgba(186,230,253,0.28),transparent_42%),radial-gradient(circle_at_90%_0%,rgba(125,211,252,0.22),transparent_35%),linear-gradient(180deg,#f7fcff_0%,#f3f9ff_100%)] dark:bg-[radial-gradient(circle_at_10%_10%,rgba(30,58,88,0.35),transparent_42%),radial-gradient(circle_at_90%_0%,rgba(14,116,144,0.28),transparent_35%),linear-gradient(180deg,#0a1422_0%,#0f1b2e_100%)]`}>
      <Navbar user={user} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
