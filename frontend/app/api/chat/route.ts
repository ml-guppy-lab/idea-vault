/**
 * POST /api/chat
 *
 * Next.js proxy that:
 *   1. Reads the httpOnly access_token cookie (JS cannot access it directly)
 *   2. Forwards the request to the FastAPI backend with the Bearer token
 *   3. Pipes the SSE stream straight back to the browser without buffering
 *
 * The Node.js runtime is required because the Edge runtime does not support
 * piping fetch body streams from an upstream URL.
 */

import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

export const runtime = "nodejs";
// Allow up to 5 minutes — needed for slow local LLM inference on CPU.
export const maxDuration = 300;

const API_BASE = () =>
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000/api";

export async function POST(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return new Response(JSON.stringify({ detail: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Forward to backend via Node.js http (no body timeout) ─────────────────
  // fetch() via undici has a body timeout that kills slow SSE streams.
  // Node.js http.request has no such timeout by default — safe for streaming.
  const body = await req.text();
  const targetUrl = new URL(`${API_BASE()}/chat`);

  const backendRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const lib = targetUrl.protocol === "https:" ? https : http;
    const nodeReq = lib.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(body),
        },
        // No timeout — the SSE stream stays open until the LLM finishes.
      },
      resolve,
    );
    nodeReq.on("error", reject);
    nodeReq.write(body);
    nodeReq.end();
  });

  // Non-2xx — read body and return JSON error
  if (backendRes.statusCode && backendRes.statusCode >= 400) {
    const chunks: Buffer[] = [];
    for await (const chunk of backendRes) chunks.push(chunk as Buffer);
    const errText = Buffer.concat(chunks).toString();
    let err: unknown;
    try { err = JSON.parse(errText); } catch { err = { detail: "Unknown error" }; }
    return new Response(JSON.stringify(err), {
      status: backendRes.statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Pipe the SSE stream straight to the browser ────────────────────────────
  const stream = new ReadableStream({
    start(controller) {
      backendRes.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      backendRes.on("end", () => controller.close());
      backendRes.on("error", (err) => controller.error(err));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      // Prevents Nginx / reverse proxies from buffering the stream.
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
