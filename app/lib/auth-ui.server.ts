import { redirect } from "react-router";

import { getAuth, USER_NOT_ACTIVE } from "./auth.server";

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

/** Whether Better Auth refused a sign-in because the User is blocked. */
export async function isBlockedResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  const body = await response.clone().json().catch(() => undefined) as { code?: unknown } | undefined;
  return body?.code === USER_NOT_ACTIVE;
}

export function redirectWithAuthCookies(response: Response, location: string): Response {
  return redirect(location, { headers: response.headers });
}

