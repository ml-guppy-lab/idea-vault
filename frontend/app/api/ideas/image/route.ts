import { NextRequest, NextResponse } from "next/server";
import { apiFetch, applyNewToken } from "@/lib/server-api";

/**
 * POST /api/ideas/image
 *
 * BFF proxy for image uploads — sits between the browser and FastAPI:
 *   1. apiFetch reads the httpOnly access_token cookie and attaches it as Bearer.
 *   2. Forwards the multipart/form-data body to FastAPI POST /ideas/image.
 *   3. Returns { url: string } — the Cloudinary HTTPS URL.
 *   4. If the access token had expired, apiFetch silently refreshes it and
 *      applyNewToken sets the new cookie on the response.
 *
 * Note: Content-Type is NOT set manually — fetch sets it automatically with
 * the correct multipart boundary when body is a FormData object.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();

  // apiFetch injects the Authorization header from the httpOnly cookie.
  // Content-Type is intentionally omitted — fetch sets it automatically
  // to multipart/form-data with the correct boundary when body is FormData.
  const { response, newAccessToken } = await apiFetch("/ideas/image", {
    method: "POST",
    body: formData,
  });

  const data = await response.json().catch(() => ({ detail: "Upload failed" }));
  const res = NextResponse.json(data, { status: response.status });
  applyNewToken(res, newAccessToken);
  return res;
}
