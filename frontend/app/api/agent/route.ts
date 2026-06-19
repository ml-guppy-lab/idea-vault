import { NextRequest, NextResponse } from "next/server";

import { apiFetch, applyNewToken } from "@/lib/server-api";

async function parseProxyBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { detail: text };
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  const { response, newAccessToken } = await apiFetch("/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await parseProxyBody(response);
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}
