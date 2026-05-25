import { NextRequest, NextResponse } from "next/server";
import { apiFetch, applyNewToken } from "@/lib/server-api";

export async function GET() {
  const { response, newAccessToken } = await apiFetch("/profile/me", {
    cache: "no-store",
  } as RequestInit);

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}

export async function PATCH(req: NextRequest) {
  const body = await req.text();

  const { response, newAccessToken } = await apiFetch("/profile/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}
