import { eq } from "drizzle-orm";
import { expect } from "vitest";

import { createAuthForDatabase } from "./auth.server";
import { connectDatabase } from "./db.server";
import { user } from "./db/schema";
import { emptyQuote, type QuoteData } from "./quote";
import { createQuoteHandler, type QuoteHandlerDependencies } from "./quotes.server";

const origin = "http://localhost:5173";
const fixtureSubnet = 1 + Math.floor(Math.random() * 250);
let fixtureNumber = 0;

export type QuoteRequest = (body?: Record<string, unknown>, quoteId?: string) => Promise<Response>;

export type ArtisanFixture = {
  request: QuoteRequest;
  /** Build a request function that uses different handler dependencies (for example, a scripted model). */
  withDependencies(dependencies: Omit<QuoteHandlerDependencies, "database" | "auth">): QuoteRequest;
};

/**
 * Authenticated access to the real Quote HTTP boundary backed by TEST_DATABASE_URL.
 * Each Artisan is a separate signed-in account, therefore a separate Artisan Business.
 */
export function quoteHttpHarness(label: string) {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const auth = createAuthForDatabase(connection.db);
  const originalAllowlist = process.env.AUTH_ALLOWED_EMAILS;
  const originalDelivery = process.env.EMAIL_DELIVERY;

  function setUp() {
    process.env.AUTH_ALLOWED_EMAILS = "*";
    process.env.EMAIL_DELIVERY = "fake";
  }

  async function tearDown() {
    if (originalAllowlist === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalAllowlist;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = originalDelivery;
    await connection.pool.end();
  }

  async function artisan(name = "Quote Artisan"): Promise<ArtisanFixture> {
    const email = `${label}-${crypto.randomUUID()}@example.test`;
    const clientIp = `127.0.${fixtureSubnet}.${++fixtureNumber}`;
    const signedUp = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify({ name, email, password: "password123" }),
    }));
    expect(signedUp.status).toBe(200);
    const account = await signedUp.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, account.user.id));
    const signedIn = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify({ email, password: "password123" }),
    }));
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
    const requestWith = (handler: ReturnType<typeof createQuoteHandler>): QuoteRequest => (body, quoteId) => handler(new Request(`${origin}/api/quotes${quoteId ? `?id=${quoteId}` : ""}`, {
      method: body ? "POST" : "GET",
      headers: { cookie, ...(body ? { origin, "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    return {
      request: requestWith(createQuoteHandler({ database: connection.db, auth })),
      withDependencies: (dependencies) => requestWith(createQuoteHandler({ ...dependencies, database: connection.db, auth })),
    };
  }

  return { connection, setUp, tearDown, artisan };
}

/** A publishable Working Draft with one fixed-price line. */
export function completeQuote(reference: string, patch: Partial<QuoteData> = {}): QuoteData {
  return {
    ...emptyQuote(reference),
    title: "Bibliothèque sur mesure",
    customerName: "Maison Exemple SA",
    customerAddress: "Rue Exemple 8\n1000 Exemple",
    businessName: "Atelier Exemple Sàrl",
    businessAddress: "Rue Exemple 1\n1000 Exemple",
    businessContact: "bonjour@example.test",
    vatRegistered: true,
    vatId: "CHE-000.000.000 TVA",
    issueDate: "2026-09-01",
    lines: [{ id: "line-1", sectionId: "", description: "Forfait pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "100.00" }],
    ...patch,
  };
}

type Detail = { id: string; version: number; draft: QuoteData | null; revisions: { number: number; quote: QuoteData; calculation: Record<string, unknown> }[] };

/** Small wrappers that assert each lifecycle step succeeded. */
export function quoteSteps(request: QuoteRequest) {
  async function ok(response: Promise<Response>): Promise<Detail> {
    const resolved = await response;
    const body = await resolved.json();
    expect(resolved.status, JSON.stringify(body)).toBe(200);
    return body;
  }
  return {
    create: () => ok(request({ action: "create", requestId: crypto.randomUUID() })),
    save: (detail: Detail, quote: QuoteData) => ok(request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote })),
    publish: (detail: Detail) => ok(request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() })),
    newDraft: (detail: Detail) => ok(request({ action: "new-draft", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() })),
    undo: (detail: Detail) => ok(request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() })),
    read: (id: string) => ok(request(undefined, id)),
    list: () => ok(request()) as unknown as Promise<{ quotes: { id: string; reference: string; hasDraft: boolean; revision: number }[]; defaults: Partial<QuoteData> }>,
  };
}

export type QuoteDetailBody = Detail;
