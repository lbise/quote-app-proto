import { config as loadDotenv } from "dotenv";

if (process.env.NODE_ENV !== "production") loadDotenv();

export type InterfaceLanguage = "en" | "fr";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function allowedEmails(value = process.env.AUTH_ALLOWED_EMAILS): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,;]+/)
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: string, value?: string): boolean {
  const configured = allowedEmails(value);
  return configured.has("*") || configured.has(normalizeEmail(email));
}

/** Bootstrap Administrators: emails whose Users are always Administrators. `*` is not accepted here. */
export function administratorEmails(value = process.env.ADMIN_EMAILS): Set<string> {
  const configured = allowedEmails(value ?? "");
  configured.delete("*");
  return configured;
}

export function isBootstrapAdministrator(email: string, value?: string): boolean {
  return administratorEmails(value).has(normalizeEmail(email));
}

/** The signed-in User fields that decide access. */
export type SessionIdentity = { email: string; emailVerified: boolean; status?: string | null; administrator?: boolean | null };

/**
 * Whether a User may sign in, ignoring email verification. Only active Users
 * may, except Bootstrap Administrators: ADMIN_EMAILS is always a way back in.
 */
export function canSignIn(identity: { email: string; status?: string | null }, adminEmails?: string): boolean {
  return identity.status === "active" || isBootstrapAdministrator(identity.email, adminEmails);
}

/**
 * Whether a signed-in User may use Easy Quote. AUTH_ALLOWED_EMAILS only
 * controls sign-up; once signed up, access depends on the User's status.
 */
export function hasApprovedAccess(identity: SessionIdentity, adminEmails?: string): boolean {
  return identity.emailVerified && canSignIn(identity, adminEmails);
}

/** Whether an approved User is an Administrator, by role or through ADMIN_EMAILS. */
export function isAdministrator(identity: SessionIdentity, adminEmails?: string): boolean {
  return hasApprovedAccess(identity, adminEmails) &&
    (identity.administrator === true || isBootstrapAdministrator(identity.email, adminEmails));
}

export function authBaseUrl(): string {
  return process.env.BETTER_AUTH_URL ?? process.env.AUTH_URL ??
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173");
}

export function trustedOrigins(): string[] {
  const configured = (process.env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(/[\s,;]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Always trust the canonical application URL, even when additional origins
  // are configured. This keeps Better Auth aligned with BETTER_AUTH_URL.
  return [...new Set([authBaseUrl(), ...configured])];
}

export function assertAuthConfiguration(): void {
  if (process.env.NODE_ENV === "production") {
    for (const [name, value] of [
      ["BETTER_AUTH_SECRET", process.env.BETTER_AUTH_SECRET],
      ["BETTER_AUTH_URL", authBaseUrl()],
      ["AUTH_ALLOWED_EMAILS", process.env.AUTH_ALLOWED_EMAILS],
      ["EMAIL_DELIVERY", process.env.EMAIL_DELIVERY === "smtp" ? "smtp" : ""],
      ["SMTP_HOST", process.env.SMTP_HOST],
      ["SMTP_USER", process.env.SMTP_USER],
      ["SMTP_PASSWORD", process.env.SMTP_PASSWORD],
      ["SMTP_FROM", process.env.SMTP_FROM],
    ]) {
      if (!value) throw new Error(`${name} is required in production.`);
    }
    if ((process.env.BETTER_AUTH_SECRET ?? "").length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters in production.");
    }
    if (process.env.SMTP_PORT && !/^\d+$/.test(process.env.SMTP_PORT)) {
      throw new Error("SMTP_PORT must be a number in production.");
    }
    if (normalizeEmail(process.env.SMTP_FROM ?? "") !== normalizeEmail(process.env.SMTP_USER ?? "")) {
      throw new Error("SMTP_FROM must match SMTP_USER in production.");
    }
  }
}

export function interfaceLanguage(value: string | null | undefined): InterfaceLanguage {
  return value === "en" ? "en" : "fr";
}

export function browserLanguage(acceptLanguage: string | null): InterfaceLanguage {
  const preferences = (acceptLanguage ?? "")
    .toLowerCase()
    .split(",")
    .map((part) => {
      const [language, quality] = part.trim().split(";q=");
      return { language, quality: quality ? Number(quality) : 1 };
    })
    .filter(({ quality }) => quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { language } of preferences) {
    if (language === "en" || language.startsWith("en-")) return "en";
    if (language === "fr" || language.startsWith("fr-")) return "fr";
  }
  return "fr";
}

export function parseLocaleCookie(cookie: string | null): InterfaceLanguage | undefined {
  const match = cookie?.match(/(?:^|;\s*)easy_quote_locale=(en|fr)(?:;|$)/);
  return match?.[1] as InterfaceLanguage | undefined;
}

export function localeCookie(locale: InterfaceLanguage): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `easy_quote_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
