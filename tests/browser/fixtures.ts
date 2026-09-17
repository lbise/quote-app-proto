import { test as base, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { makeJoineryQuote } from "../../app/components/quote-prototype/fixtures";
import pg from "pg";

type Artisan = {
  page: Page;
  api: APIRequestContext;
  baseURL: string;
  email: string;
};

type QuoteDetail = {
  id: string;
  version: number;
  draft: { reference: string };
};

type QuoteResponse = { ok: boolean; status: number; data: unknown };

// Browser tests exercise the assistant UI against fake /api/quotes responses.
// The server still uses a harmless test credential and no live model calls are made.

export async function setInterfaceLanguage(page: Page, locale: "en" | "fr") {
  const response = await page.evaluate(async (value) => {
    const result = await fetch("/language", {
      method: "POST",
      body: new URLSearchParams({ locale: value, returnTo: "/quotes" }),
    });
    return { ok: result.ok, status: result.status };
  }, locale);
  if (!response.ok) throw new Error(`Browser language change failed with ${response.status}.`);
  await page.reload();
  await expect(page.locator(".qp-app")).toHaveAttribute("lang", locale);
}

async function requestQuote(artisan: Artisan, body: Record<string, unknown>): Promise<QuoteResponse> {
  await artisan.page.goto("/quotes");
  return artisan.page.evaluate(async (requestBody) => {
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    return { ok: response.ok, status: response.status, data: await response.json() };
  }, body);
}

export async function createEmptyQuote(artisan: Artisan): Promise<QuoteDetail> {
  const created = await requestQuote(artisan, { action: "create", requestId: crypto.randomUUID() });
  if (!created.ok) throw new Error(`Browser Quote creation failed with ${created.status}: ${(created.data as { error?: string }).error ?? "unknown"}.`);
  return created.data as QuoteDetail;
}

export async function createLongQuote(artisan: Artisan): Promise<QuoteDetail> {
  const detail = await createEmptyQuote(artisan);
  const quote = { ...makeJoineryQuote(), customerContact: "" };
  const saved = await requestQuote(artisan, { action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote });
  if (!saved.ok) throw new Error(`Browser long Quote seed save failed with ${saved.status}.`);
  return saved.data as QuoteDetail;
}

export async function createSectionedQuote(artisan: Artisan): Promise<QuoteDetail> {
  const detail = await createEmptyQuote(artisan);
  const quote = {
    ...detail.draft,
    title: "Agencements fictifs",
    customerName: "Maison Exemple SA",
    customerAddress: "Rue Exemple 8\n1000 Lausanne",
    customerContact: "",
    businessName: "Atelier Exemple Sàrl",
    businessAddress: "Rue Exemple 1\n1000 Lausanne",
    businessContact: "bonjour@example.test",
    vatRegistered: true,
    vatId: "CHE-000.000.000 TVA",
    issueDate: "2026-09-01",
    siteAddress: "Rue Exemple 8\n1000 Lausanne",
    terms: "Prix en CHF.",
    sections: [
      { id: "section-living", title: "Séjour" },
      { id: "section-bedroom", title: "Chambre" },
      { id: "section-office", title: "Bureau" },
    ],
    lines: [
      { id: "line-living-1", sectionId: "section-living", description: "Habillage mural en chêne", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "100.00" },
      { id: "line-living-2", sectionId: "section-living", description: "Pose des panneaux", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00" },
      { id: "line-bedroom-1", sectionId: "section-bedroom", description: "Tablette murale", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "75.00" },
    ],
  };
  const saved = await requestQuote(artisan, { action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote });
  if (!saved.ok) throw new Error(`Browser sectioned Quote seed save failed with ${saved.status}.`);
  return saved.data as QuoteDetail;
}

export async function createConversationQuote(artisan: Artisan): Promise<QuoteDetail> {
  const detail = await createEmptyQuote(artisan);
  const quote = {
    ...detail.draft,
    title: "Agencement intérieur",
    customerName: "Maison Exemple SA",
    customerAddress: "Rue Exemple 8\n1000 Lausanne",
    customerContact: "",
    businessName: "Atelier Exemple Sàrl",
    businessAddress: "Rue Exemple 1\n1000 Lausanne",
    businessContact: "bonjour@example.test",
    vatRegistered: false,
    vatId: "",
    issueDate: "2026-09-01",
    siteAddress: "Rue Exemple 8\n1000 Lausanne",
    terms: "Prix en CHF.",
    discountMode: "none" as const,
    discount: "0",
    sections: [
      { id: "section-living", title: "Séjour" },
      { id: "section-bedroom", title: "Chambre" },
    ],
    lines: [
      { id: "living-cladding", sectionId: "section-living", description: "Habillage mural en chêne", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
      { id: "bedroom-cladding", sectionId: "section-bedroom", description: "Habillage mural en chêne", mode: "quantity" as const, quantity: "8", unit: "m²", unitPrice: "40.00", amount: "" },
      { id: "bedroom-shelf", sectionId: "section-bedroom", description: "Pose de la tablette, fixations comprises", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "150.00" },
    ],
  };
  const saved = await requestQuote(artisan, { action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote });
  if (!saved.ok) throw new Error(`Browser conversation Quote seed save failed with ${saved.status}.`);
  return saved.data as QuoteDetail;
}

export async function createCompleteQuote(artisan: Artisan, amount = "100.00"): Promise<QuoteDetail> {
  const detail = await createEmptyQuote(artisan);
  const quote = {
    ...detail.draft,
    title: "Bibliothèque sur mesure",
    customerName: "Maison des Tilleuls SA",
    customerAddress: "Rue des Tilleuls 8\n1000 Lausanne",
    customerContact: "",
    businessName: "Atelier du Bois Sàrl",
    businessAddress: "Route de la Menuiserie 6\n1009 Pully",
    businessContact: "bonjour@atelier-bois.example",
    vatRegistered: true,
    vatId: "CHE-000.000.000 TVA",
    issueDate: "2026-09-01",
    validUntil: "",
    siteAddress: "Rue des Tilleuls 8\n1000 Lausanne",
    terms: "Prix en CHF, TVA comprise.",
    discountMode: "none",
    discount: "0",
    sections: [],
    lines: [{
      id: "library-line",
      sectionId: "",
      description: "Bibliothèque en chêne avec fixations invisibles.",
      mode: "fixed",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount,
    }],
  };
  const saved = await requestQuote(artisan, { action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote });
  if (!saved.ok) throw new Error(`Browser Quote seed save failed with ${saved.status}.`);
  return saved.data as QuoteDetail;
}

type BrowserAuth = {
  api: APIRequestContext;
  email: string;
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>;
};

export const test = base.extend<{ artisan: Artisan }, { browserAuth: BrowserAuth }>({
  browserAuth: [async ({}, use, workerInfo) => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5180";
    const databaseUrl = process.env.BROWSER_TEST_DATABASE_URL;
    if (!databaseUrl) throw new Error("BROWSER_TEST_DATABASE_URL is required.");

    const email = `browser-${workerInfo.workerIndex}-${crypto.randomUUID()}@example.com`;
    const password = "browser-test-password";
    const api = await request.newContext({ baseURL, extraHTTPHeaders: { "accept-language": "en-US" } });
    const database = new pg.Client({ connectionString: databaseUrl });

    try {
      const signUp = await api.post("/api/auth/sign-up/email", {
        data: { name: "Browser Artisan", email, password, callbackURL: "/verify" },
      });
      const registration = await signUp.json() as { user?: { id?: string } };
      if (!signUp.ok() || !registration.user?.id) {
        throw new Error(`Browser auth registration failed with ${signUp.status()}.`);
      }

      // This only verifies the fixture identity. The app still signs in through
      // Better Auth and enforces requireApprovedArtisan on Quote routes.
      await database.connect();
      await database.query('update "user" set email_verified = true where id = $1', [registration.user.id]);
      const signIn = await api.post("/api/auth/sign-in/email", {
        data: { email, password, callbackURL: "/" },
      });
      if (!signIn.ok()) throw new Error(`Browser auth sign-in failed with ${signIn.status()}.`);

      await use({ api, email, storageState: await api.storageState() });
    } finally {
      await database.end().catch(() => undefined);
      await api.dispose();
    }
  }, { scope: "worker" }],
  artisan: async ({ browser, browserAuth }, use) => {
    const context = await browser.newContext({ locale: "en-US", storageState: browserAuth.storageState });
    const page = await context.newPage();
    try {
      // The shared fixture user may have changed language in a preceding test.
      // Reset it through the application's own language action, not the database.
      await page.goto("/quotes");
      await setInterfaceLanguage(page, "en");
      await use({ page, api: browserAuth.api, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5180", email: browserAuth.email });
    } finally {
      await context.close();
    }
  },
});

export { expect };
