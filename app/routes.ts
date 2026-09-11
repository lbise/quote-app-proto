import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  ...(process.env.NODE_ENV !== "production" ? [route("quote-layout-prototype", "routes/quote-layout-prototype.tsx")] : []),
  route("sign-in", "routes/sign-in.tsx"),
  route("sign-up", "routes/sign-up.tsx"),
  route("verify", "routes/verify.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("language", "routes/language.ts"),
  route("api/auth/*", "routes/auth.$.ts"),
  route("health/live", "routes/health.live.ts"),
  route("health/ready", "routes/health.ready.ts"),
] satisfies RouteConfig;
