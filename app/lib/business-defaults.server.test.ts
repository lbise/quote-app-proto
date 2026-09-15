import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createAuthForDatabase } from "./auth.server";
import { connectDatabase } from "./db.server";
import { user } from "./db/schema";
import { createQuoteHandler } from "./quotes.server";

const origin = "http://localhost:5173";
const fixtureSubnet = 1 + Math.floor(Math.random() * 250);
let fixtureNumber = 0;

type ArtisanFixture = {
  request(body?: Record<string, unknown>, quoteId?: string): Promise<Response>;
};

const registeredDefaults = {
  businessName: "Atelier des Arches Sàrl",
  businessAddress: "Rue du Pont 8\n1000 Lausanne",
  businessContact: "Camille Martin\nbonjour@arches.example",
  terms: "Paiement à 30 jours. Garantie selon le devis.",
  vatRegistered: true,
  vatId: "CHE-123.456.789 TVA",
};

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("business defaults through the authenticated Quote HTTP boundary", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const auth = createAuthForDatabase(connection.db);
  const handler = createQuoteHandler({ database: connection.db, auth });
  const originalAllowlist = process.env.AUTH_ALLOWED_EMAILS;
  const originalDelivery = process.env.EMAIL_DELIVERY;

  beforeAll(() => {
    process.env.AUTH_ALLOWED_EMAILS = "*";
    process.env.EMAIL_DELIVERY = "fake";
  });

  async function artisan(label: string): Promise<ArtisanFixture> {
    const email = `defaults-${crypto.randomUUID()}@example.test`;
    const clientIp = `127.0.${fixtureSubnet}.${++fixtureNumber}`;
    const signedUp = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify({ name: label, email, password: "password123" }),
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
    return {
      request: (body, quoteId) => handler(new Request(`${origin}/api/quotes${quoteId ? `?id=${quoteId}` : ""}`, {
        method: body ? "POST" : "GET",
        headers: { cookie, ...(body ? { origin, "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })),
    };
  }

  afterAll(async () => {
    if (originalAllowlist === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalAllowlist;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = originalDelivery;
    await connection.pool.end();
  });

  it("rejects a registered default without a VAT identifier without replacing saved defaults", async () => {
    const fixture = await artisan("VAT validation");
    expect((await fixture.request({ action: "defaults-save", defaults: registeredDefaults })).status).toBe(200);

    for (const defaults of [{ vatRegistered: true }, { vatRegistered: true, vatId: "   " }]) {
      const response = await fixture.request({ action: "defaults-save", defaults });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "invalid_defaults",
        details: { errors: [{ path: "vatId", code: "required" }] },
      });
      expect((await (await fixture.request()).json()).defaults).toEqual(registeredDefaults);
    }
  });

  it("saves blank business information and preserves null and false VAT settings on reopen", async () => {
    const fixture = await artisan("Blank defaults");
    const blank = { businessName: "", businessAddress: "", businessContact: "", terms: "", vatRegistered: null, vatId: "" };
    const saved = await fixture.request({ action: "defaults-save", defaults: blank });
    expect(saved.status).toBe(200);
    expect((await saved.json()).defaults).toEqual(blank);

    const reopened = await fixture.request();
    expect((await reopened.json()).defaults).toEqual(blank);

    const unregistered = { ...blank, vatRegistered: false };
    const disabled = await fixture.request({ action: "defaults-save", defaults: unregistered });
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).defaults).toEqual(unregistered);
    const reopenedUnregistered = await fixture.request();
    expect((await reopenedUnregistered.json()).defaults).toEqual(unregistered);
  });

  it("copies every saved business, contact, terms, and VAT default into a new Working Draft", async () => {
    const fixture = await artisan("Copied defaults");
    expect((await fixture.request({ action: "defaults-save", defaults: registeredDefaults })).status).toBe(200);

    const created = await fixture.request({ action: "create", requestId: crypto.randomUUID() });
    expect(created.status).toBe(200);
    expect((await created.json()).draft).toMatchObject(registeredDefaults);
  });

  it("keeps defaults unchanged when Quote-local details and tax settings are saved and undone", async () => {
    const fixture = await artisan("Quote-local defaults");
    await fixture.request({ action: "defaults-save", defaults: registeredDefaults });
    const created = await fixture.request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const localDraft = {
      ...detail.draft,
      businessAddress: "Adresse propre au Quote",
      businessContact: "Contact propre au Quote",
      terms: "Conditions propres au Quote",
      vatRegistered: false,
      vatId: "",
    };

    const saved = await fixture.request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: localDraft });
    expect(saved.status).toBe(200);
    detail = await saved.json();
    expect(detail.draft).toMatchObject(localDraft);

    const reopenedBeforeUndo = await fixture.request(undefined, detail.id);
    expect((await reopenedBeforeUndo.json()).draft).toMatchObject(localDraft);
    expect((await (await fixture.request()).json()).defaults).toEqual(registeredDefaults);

    const undone = await fixture.request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(undone.status).toBe(200);
    expect((await undone.json()).draft).toMatchObject(registeredDefaults);

    expect((await (await fixture.request()).json()).defaults).toEqual(registeredDefaults);
  });

  it("does not refresh complete or initially incomplete snapshots after a valid defaults edit", async () => {
    const fixture = await artisan("Snapshot defaults");
    await fixture.request({ action: "defaults-save", defaults: registeredDefaults });
    const completeCreated = await fixture.request({ action: "create", requestId: crypto.randomUUID() });
    const completeQuote = await completeCreated.json();

    const incompleteDefaults = {
      businessName: "Atelier initial",
      businessAddress: "",
      businessContact: "",
      terms: "",
      vatRegistered: null,
      vatId: "",
    };
    await fixture.request({ action: "defaults-save", defaults: incompleteDefaults });
    const incompleteCreated = await fixture.request({ action: "create", requestId: crypto.randomUUID() });
    let incompleteQuote = await incompleteCreated.json();
    const incompleteDraft = { ...incompleteQuote.draft, vatRegistered: true, vatId: "" };

    const saved = await fixture.request({ action: "save", id: incompleteQuote.id, expectedVersion: incompleteQuote.version, requestId: crypto.randomUUID(), quote: incompleteDraft });
    expect(saved.status).toBe(200);
    incompleteQuote = await saved.json();

    const laterDefaults = { ...registeredDefaults, businessName: "Atelier mis à jour", terms: "Conditions mises à jour" };
    expect((await fixture.request({ action: "defaults-save", defaults: laterDefaults })).status).toBe(200);
    const reopenedComplete = await fixture.request(undefined, completeQuote.id);
    expect((await reopenedComplete.json()).draft).toMatchObject(registeredDefaults);
    const reopenedIncomplete = await fixture.request(undefined, incompleteQuote.id);
    expect((await reopenedIncomplete.json()).draft).toMatchObject({ ...incompleteDefaults, vatRegistered: true, vatId: "" });

    const laterQuote = await fixture.request({ action: "create", requestId: crypto.randomUUID() });
    expect((await laterQuote.json()).draft).toMatchObject(laterDefaults);
  });

  it("rejects unauthenticated and no-longer-allowlisted defaults access", async () => {
    const unauthenticated = await handler(new Request(`${origin}/api/quotes`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ action: "defaults-save", defaults: registeredDefaults }),
    }));
    expect(unauthenticated.status).toBe(401);
    expect((await handler(new Request(`${origin}/api/quotes`))).status).toBe(401);

    const fixture = await artisan("Removed from allowlist");
    process.env.AUTH_ALLOWED_EMAILS = "nobody@example.test";
    try {
      const denied = await fixture.request({ action: "defaults-save", defaults: registeredDefaults });
      expect(denied.status).toBe(403);
      expect((await fixture.request()).status).toBe(403);
    } finally {
      process.env.AUTH_ALLOWED_EMAILS = "*";
    }
  });

  it("derives every read and write from the authenticated Artisan Business", async () => {
    const owner = await artisan("Owner");
    const other = await artisan("Other");
    await owner.request({ action: "defaults-save", defaults: registeredDefaults });
    const created = await owner.request({ action: "create", requestId: crypto.randomUUID() });
    const ownQuote = await created.json();

    const crossBusinessRead = await other.request(undefined, ownQuote.id);
    expect(crossBusinessRead.status).toBe(404);
    const crossBusinessWrite = await other.request({
      action: "save",
      id: ownQuote.id,
      expectedVersion: ownQuote.version,
      requestId: crypto.randomUUID(),
      quote: { ...ownQuote.draft, businessName: "Tentative d'écriture" },
    });
    expect(crossBusinessWrite.status).toBe(404);

    const otherDefaults = { ...registeredDefaults, businessName: "Atelier de l'autre Artisan" };
    const spoofedDefaultWrite = await other.request({
      action: "defaults-save",
      businessId: "submitted-business-id-must-be-ignored",
      defaults: otherDefaults,
    });
    expect(spoofedDefaultWrite.status).toBe(200);
    expect((await spoofedDefaultWrite.json()).defaults).toEqual(otherDefaults);

    const ownerList = await owner.request();
    expect((await ownerList.json()).defaults).toEqual(registeredDefaults);
    const ownerDetail = await owner.request(undefined, ownQuote.id);
    expect((await ownerDetail.json()).draft).toMatchObject(registeredDefaults);
    const otherList = await other.request();
    expect((await otherList.json()).quotes).toEqual([]);
  });
});
