// Sentry — browser (client) init. Runs in the user's browser.
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set, so local dev and previews send
// nothing. The DSN is public by design (it can only submit events, not read).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
  // Performance tracing — links a browser action to the backend request it triggers.
  tracesSampleRate: 0.1,
  // Never attach cookies / request bodies / user identifiers.
  sendDefaultPii: false,
});

// Instruments App Router client-side navigations for tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
