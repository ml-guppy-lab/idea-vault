import { NextRequest, NextResponse } from "next/server";
import { apiFetch, applyNewToken } from "@/lib/server-api";

export async function GET() {
  const { response, newAccessToken } = await apiFetch("/collections", {
    cache: "no-store",
  } as RequestInit);

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  const { response, newAccessToken } = await apiFetch("/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}
