import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const apiBase = process.env.INTERNAL_API_URL
    || process.env.NEXT_PUBLIC_API_URL
    || "http://localhost:8000/api";
  const body = await req.text();

  const backendRes = await fetch(`${apiBase}/ideas/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  const data = await backendRes.json();
  return NextResponse.json(data, { status: backendRes.status });
}
