/**
 * POST /api/ai/feedback
 *
 * Proxies a thumbs-up/down rating for a generated AI reply to the FastAPI
 * backend, which records it as a Langfuse score. Best-effort: the UI does not
 * block on the result. Auth (access token) is attached server-side via
 * apiFetch so the httpOnly cookie never reaches browser JS.
 */

import { NextRequest, NextResponse } from "next/server";

import { apiFetch, applyNewToken } from "@/lib/server-api";

export async function POST(req: NextRequest) {
  const body = await req.text();

  const { response, newAccessToken } = await apiFetch("/ai/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: text };
  }

  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}
