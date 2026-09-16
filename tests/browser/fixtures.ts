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

// Browser tests exercise the enabled assistant UI against fake /api/quotes
// responses. This replaces only the root-loader disclosure in the browser's
// authenticated HTML document; the server remains QUOTE_AI_ENABLED=false.
// React Router streams loader data as a devalue table rather than ordinary
// JSON. Decode its streamed table rather than depending on its generated index
// names, then replace only the browser's public processing disclosure.
function fictionalDisclosureDocument(body: string): string {
  const match = body.match(/streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/);
  if (!match) throw new Error("Browser root loader did not contain streamed data.");

  const table = JSON.parse(JSON.parse(match[1])) as unknown[];
  const quoteAI = table.indexOf("quoteAI");
  const disclosure = table[quoteAI + 1];
  if (quoteAI < 0 || !disclosure || typeof disclosure !== "object" || Array.isArray(disclosure)) {
    throw new Error("Browser root loader did not contain Quote AI disclosure data.");
  }

  let enabled = false;
  let mode = false;
  for (const [reference, value] of Object.entries(disclosure)) {
    if (!reference.startsWith("_") || typeof value !== "number") continue;
    const key = table[Number(reference.slice(1))];
    if (key === "enabled" || key === "mode" || key === "providerName") {
      // Primitive entries can be shared by unrelated loader fields. Point this
      // disclosure field at a fresh entry instead of changing the shared value.
      table.push(key === "enabled" ? true : key === "mode" ? "fictional-test" : "Google Gemini Developer API");
      (disclosure as Record<string, unknown>)[reference] = table.length - 1;
      if (key === "enabled") enabled = true;
      if (key === "mode") mode = true;
    }
  }
  if (!enabled || !mode) throw new Error("Browser root loader Quote AI disclosure was malformed.");

  const next = JSON.stringify(JSON.stringify(table) + "\n");
  return body.replace(match[1], next);
}

async function installFictionalAssistantDisclosure(context: import("@playwright/test").BrowserContext) {
  await context.route("**/quotes**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET" || request.resourceType() !== "document") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: fictionalDisclosureDocument(body) });
  });
}

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

export const test = base.extend<{ artisan: Artisan; fictionalAssistantDisclosure: boolean }, { browserAuth: BrowserAuth }>({
  fictionalAssistantDisclosure: [false, { option: true }],
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
  artisan: async ({ browser, browserAuth, fictionalAssistantDisclosure }, use) => {
    const context = await browser.newContext({ locale: "en-US", storageState: browserAuth.storageState });
    if (fictionalAssistantDisclosure) await installFictionalAssistantDisclosure(context);
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
