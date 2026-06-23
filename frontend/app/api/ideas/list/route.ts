import { NextRequest, NextResponse } from "next/server";
import { apiFetch, applyNewToken } from "@/lib/server-api";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.toString();
  const path = query ? `/ideas?${query}` : "/ideas";

  const { response, newAccessToken } = await apiFetch(path, {
    cache: "no-store",
  } as RequestInit);

  const data = await response.json();
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}
