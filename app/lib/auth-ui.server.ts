import { redirect } from "react-router";

import { getAuth } from "./auth.server";

export async function callAuthEndpoint(
  request: Request,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return getAuth().handler(new Request(new URL(`/api/auth${path}`, request.url), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
}

export async function actionError(response: Response, fallback: string) {
  if (response.ok) return undefined;
  // Better Auth's details are intentionally not exposed to the browser. They
  // can disclose account state or implementation details.
  return fallback;
}

export function redirectWithAuthCookies(response: Response, location: string): Response {
  return redirect(location, { headers: response.headers });
}

