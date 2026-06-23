import { NextRequest, NextResponse } from "next/server";
import { apiFetch, applyNewToken } from "@/lib/server-api";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { response, newAccessToken } = await apiFetch(`/ideas/${id}/image`, {
    method: "DELETE",
  });

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
