import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API = () =>
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000/api";

export async function POST(req: NextRequest) {
  const store = await cookies();
  const token = store.get("access_token")?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const body = await req.text();
  const res = await fetch(`${API()}/profile/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
