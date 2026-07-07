// Next.js instrumentation hook. `register` runs once per runtime at startup and
// loads the matching Sentry server/edge init. `onRequestError` forwards errors
// thrown in server components and route handlers to Sentry with request context.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
