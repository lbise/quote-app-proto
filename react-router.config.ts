import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  // React Router rejects cross-origin forwarded actions before route actions
  // run. These are the only hosts that may submit UI actions.
  allowedActionOrigins: [
    "easy-quote.voidstation.ch",
    "localhost:5173",
    "127.0.0.1:5173",
  ],
} satisfies Config;
