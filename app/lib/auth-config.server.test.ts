import { describe, expect, it } from "vitest";

import {
  browserLanguage,
  hasApprovedAccess,
  isEmailAllowed,
  normalizeEmail,
  parseLocaleCookie,
} from "./auth-config.server";

describe("auth configuration", () => {
  it("normalizes and matches the selected tester allowlist", () => {
    expect(normalizeEmail("  Test@Example.COM ")).toBe("test@example.com");
    expect(isEmailAllowed("Test@Example.com", "other@example.com test@example.com")).toBe(true);
    expect(isEmailAllowed("nope@example.com", "test@example.com")).toBe(false);
    expect(hasApprovedAccess({ email: "test@example.com", emailVerified: false }, "test@example.com")).toBe(false);
    expect(hasApprovedAccess({ email: "test@example.com", emailVerified: true }, "removed@example.com")).toBe(false);
    expect(hasApprovedAccess({ email: "test@example.com", emailVerified: true }, "test@example.com")).toBe(true);
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
});
