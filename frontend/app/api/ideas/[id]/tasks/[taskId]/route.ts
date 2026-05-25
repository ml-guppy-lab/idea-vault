import { NextRequest, NextResponse } from "next/server";
import { apiFetch, applyNewToken } from "@/lib/server-api";

type Params = { params: Promise<{ id: string; taskId: string }> };

/** PATCH /api/ideas/[id]/tasks/[taskId] — update a task (title, status, dueDate, notes) */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, taskId } = await params;
  const body = await req.text();

  const { response, newAccessToken } = await apiFetch(
    `/ideas/${id}/tasks/${taskId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}

/** DELETE /api/ideas/[id]/tasks/[taskId] — delete a task */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, taskId } = await params;

  const { response, newAccessToken } = await apiFetch(
    `/ideas/${id}/tasks/${taskId}`,
    { method: "DELETE" }
  );

  // 204 No Content — no body to parse
  if (response.status === 204) {
    const res = new NextResponse(null, { status: 204 });
    applyNewToken(res, newAccessToken);
    return res;
  }

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}
