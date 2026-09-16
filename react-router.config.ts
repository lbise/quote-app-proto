import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  // React Router rejects cross-origin forwarded actions before route actions
  // run. Local development may be opened on localhost, a LAN address or a
  // different port, so the application-level origin checks remain the source
  // of truth there. Keep an explicit production allowlist.
  allowedActionOrigins: process.env.NODE_ENV === "production" ? [
    "easy-quote.voidstation.ch",
  ] : ["**"],
} satisfies Config;
