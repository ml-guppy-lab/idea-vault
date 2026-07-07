import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
};

// Wrap with Sentry. Without SENTRY_ORG/PROJECT/AUTH_TOKEN this is a no-op at
// build time (it just skips source-map upload), so the build stays green until
// those are configured. Source maps upload only in CI/prod when the token exists.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
});
