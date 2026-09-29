import { describe, expect, it } from "vitest";

import {
  browserLanguage,
  hasApprovedAccess,
  isAdministrator,
  trustedOrigins,
  isEmailAllowed,
  normalizeEmail,
  parseLocaleCookie,
} from "./auth-config.server";

describe("auth configuration", () => {
  it("normalizes and matches the selected tester allowlist", () => {
    expect(normalizeEmail("  Test@Example.COM ")).toBe("test@example.com");
    expect(isEmailAllowed("Test@Example.com", "other@example.com test@example.com")).toBe(true);
    expect(isEmailAllowed("nope@example.com", "test@example.com")).toBe(false);
  });

  it("approves only verified, active Users", () => {
    const person = { email: "person@example.com", emailVerified: true };
    expect(hasApprovedAccess({ ...person, status: "active" }, "")).toBe(true);
    expect(hasApprovedAccess({ ...person, emailVerified: false, status: "active" }, "")).toBe(false);
    expect(hasApprovedAccess({ ...person, status: "blocked" }, "")).toBe(false);
    expect(hasApprovedAccess({ ...person, status: "invited" }, "")).toBe(false);
  });

  it("always lets Bootstrap Administrators in, even when blocked", () => {
    expect(hasApprovedAccess({ email: "admin@example.com", emailVerified: true, status: "blocked" }, "admin@example.com")).toBe(true);
  });

  it("makes approved Users Administrators by granted role or ADMIN_EMAILS, never by '*'", () => {
    const person = { email: "Admin@Example.com", emailVerified: true, status: "active", administrator: false };
    expect(isAdministrator(person, "other@example.com admin@example.com")).toBe(true);
    expect(isAdministrator(person, "*")).toBe(false);
    expect(isAdministrator({ ...person, administrator: true }, "")).toBe(true);
    expect(isAdministrator({ ...person, administrator: true, status: "blocked" }, "other@example.com")).toBe(false);
  });

  it("selects the highest-priority supported browser language and falls back to French", () => {
    expect(browserLanguage("de-DE,de;q=0.9,en-US;q=0.8")).toBe("en");
    expect(browserLanguage("en-US;q=0.2,fr-FR;q=0.9")).toBe("fr");
    expect(browserLanguage("de-DE,de;q=0.9")).toBe("fr");
  });

  it("accepts only the application locale cookie", () => {
    expect(parseLocaleCookie("other=value; easy_quote_locale=en; Path=/")).toBe("en");
    expect(parseLocaleCookie("easy_quote_locale=de")).toBeUndefined();
  });

  it("keeps the canonical Better Auth URL trusted alongside configured origins", () => {
    const previousUrl = process.env.BETTER_AUTH_URL;
    const previousOrigins = process.env.AUTH_TRUSTED_ORIGINS;
    process.env.BETTER_AUTH_URL = "https://dev.voidstation.ch";
    process.env.AUTH_TRUSTED_ORIGINS = "https://easy-quote.voidstation.ch";
    try {
      expect(trustedOrigins()).toEqual([
        "https://dev.voidstation.ch",
        "https://easy-quote.voidstation.ch",
      ]);
    } finally {
      if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = previousUrl;
      if (previousOrigins === undefined) delete process.env.AUTH_TRUSTED_ORIGINS;
      else process.env.AUTH_TRUSTED_ORIGINS = previousOrigins;
    }
  });
});
