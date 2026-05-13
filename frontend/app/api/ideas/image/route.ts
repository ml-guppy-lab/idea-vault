import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/ideas/image
 *
 * BFF proxy for image uploads — sits between the browser and FastAPI:
 *   1. Reads the access_token from the httpOnly cookie (JS can't touch it).
 *   2. Forwards the multipart/form-data body to FastAPI POST /ideas/image.
 *   3. Returns { url: string } — the Cloudinary HTTPS URL.
 *
 * Why a proxy?  The access_token is httpOnly so browser JS cannot read it.
 * This server route can read it and inject it as an Authorization header
 * before forwarding to FastAPI.
 *
 * Note: Do NOT set Content-Type manually — fetch sets it automatically with
 * the correct multipart boundary when body is a FormData object.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const apiBase =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000/api";

  // Parse and re-forward the multipart form data.
  // fetch() with a FormData body automatically sets Content-Type: multipart/form-data
  // with the correct boundary — setting it manually would break the boundary.
  const formData = await req.formData();

  const backendRes = await fetch(`${apiBase}/ideas/image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await backendRes.json().catch(() => ({ detail: "Upload failed" }));
  return NextResponse.json(data, { status: backendRes.status });
}
