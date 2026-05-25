import { NextRequest, NextResponse } from "next/server";
import { apiFetch, applyNewToken } from "@/lib/server-api";

type Params = { params: Promise<{ id: string }> };

/** GET /api/ideas/[id]/tasks — list all tasks for an idea */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const { response, newAccessToken } = await apiFetch(`/ideas/${id}/tasks`);

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}

/** POST /api/ideas/[id]/tasks — create a task under an idea */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.text();

  const { response, newAccessToken } = await apiFetch(`/ideas/${id}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}
