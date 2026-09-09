import { redirect } from "react-router";
import type { Route } from "./+types/language";

import { setInterfaceLanguage } from "../lib/artisan.server";
import {
  hasApprovedAccess,
  interfaceLanguage,
  localeCookie,
  type InterfaceLanguage,
} from "../lib/auth-config.server";
import { getSession } from "../lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const locale = interfaceLanguage(String(form.get("locale")));
  const returnTo = safeReturnPath(String(form.get("returnTo") ?? "/"));
  const current = await getSession(request);
  if (current && hasApprovedAccess(current.user)) {
    await setInterfaceLanguage(current.user.id, locale);
  }

  return redirect(returnTo, { headers: { "Set-Cookie": localeCookie(locale) } });
}

function safeReturnPath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
