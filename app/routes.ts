import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("health/live", "routes/health.live.ts"),
  route("health/ready", "routes/health.ready.ts"),
] satisfies RouteConfig;
