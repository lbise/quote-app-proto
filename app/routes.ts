import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("quotes", "routes/quotes.tsx"),
  route("api/quotes", "routes/api.quotes.ts"),
  route("api/quotes/:id/revisions/:number/document", "routes/api.quote-pdf.ts", { id: "quote-document-pdf" }),
  route("api/quotes/:id/draft-preview", "routes/api.quote-pdf.ts", { id: "quote-draft-preview-pdf" }),
  route("api/business-logo", "routes/api.business-logo.ts", { id: "business-logo-upload" }),
  route("api/business-logo/:logoId", "routes/api.business-logo.ts", { id: "business-logo" }),
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
