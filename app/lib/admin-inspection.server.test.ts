import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { listArtisanBusinesses, readArtisanBusiness, readQuoteForAdministrator } from "./admin-inspection.server";
import { AdministrationRefusal, applyAdministratorAction } from "./administration.server";
import { artisanBusiness, quote as quoteTable, turnTrace } from "./db/schema";
import type { PdfRenderer } from "./pdf-renderer.server";
import { createAdministratorQuotePdfHandler } from "./quote-pdf.server";
import { completeQuote, quoteHttpHarness, quoteSteps, type ArtisanFixture } from "./quote-http.test-support";
import { response, scriptedModel } from "./turn-trace.test-support";

// #53: Administrators inspect Artisan Businesses, their Quotes and conversations, read-only.

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("inspecting businesses in the admin area", () => {
  const harness = quoteHttpHarness("admin-inspection");
  const database = harness.connection.db;
  const originalAdminEmails = process.env.ADMIN_EMAILS;
  let administrator: ArtisanFixture;

  beforeAll(async () => {
    harness.setUp();
    administrator = await harness.artisan("Inspecting Administrator");
    process.env.ADMIN_EMAILS = administrator.email;
  });
  afterEach(() => { process.env.ADMIN_EMAILS = administrator.email; });
  afterAll(async () => {
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
    await harness.tearDown();
  });

  async function businessOf(artisan: ArtisanFixture) {
    const [business] = await database.select({ id: artisanBusiness.id }).from(artisanBusiness).where(eq(artisanBusiness.ownerUserId, artisan.userId));
    return business.id;
  }

  async function draft(artisan: ArtisanFixture, title = "Bibliothèque sur mesure") {
    const steps = quoteSteps(artisan.request);
    const created = await steps.create();
    return steps.save(created, completeQuote(created.draft!.reference, { title }));
  }

  function send(artisan: ArtisanFixture, detail: { id: string; version: number }, text: string, reply: string) {
    return artisan.withDependencies({ modelBoundary: scriptedModel([response(reply)]) })({
      action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text, locale: "fr",
    });
  }

  it("lists every Artisan Business with its owner, User status, Quote counts and last activity", async () => {
    const artisan = await harness.artisan("Overview Artisan");
    expect((await artisan.request({ action: "defaults-save", defaults: { businessName: "Atelier Vue" } })).status).toBe(200);
    const kept = await draft(artisan);
    const archived = await draft(artisan, "Ancien projet");
    expect((await artisan.request({ action: "archive", id: archived.id, requestId: crypto.randomUUID() })).status).toBe(200);
    expect((await send(artisan, kept, "Ajoute la pose.", "Quelle pièce ?")).status).toBe(200);
    const businessId = await businessOf(artisan);
    await database.update(quoteTable).set({ updatedAt: new Date("2026-09-01T08:00:00Z") }).where(eq(quoteTable.businessId, businessId));
    await database.update(turnTrace).set({ createdAt: new Date("2026-09-02T08:00:00Z") }).where(eq(turnTrace.businessId, businessId));
    const idle = await harness.artisan("Idle Artisan");
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: idle.userId, action: "block" });

    const businesses = await listArtisanBusinesses(database, administrator.userId);
    expect(businesses.find((entry) => entry.id === businessId)).toEqual({
      id: businessId, name: "Atelier Vue",
      owner: { id: artisan.userId, name: "Overview Artisan", email: artisan.email, status: "active" },
      activeQuotes: 1, archivedQuotes: 1,
      lastActivityAt: new Date("2026-09-02T08:00:00Z"),
    });
    expect(businesses.find((entry) => entry.owner.id === idle.userId)).toMatchObject({
      name: "", owner: { status: "blocked" }, activeQuotes: 0, archivedQuotes: 0, lastActivityAt: null,
    });
  });

  it("opens a business with all its Quotes, including Archived Quotes", async () => {
    const artisan = await harness.artisan("Quotes Artisan");
    const first = await draft(artisan, "Cuisine");
    const second = await draft(artisan, "Salle de bain");
    const published = await quoteSteps(artisan.request).publish(second);
    expect((await artisan.request({ action: "archive", id: first.id, requestId: crypto.randomUUID() })).status).toBe(200);

    const opened = await readArtisanBusiness(database, administrator.userId, await businessOf(artisan));
    expect(opened?.business).toMatchObject({ owner: { id: artisan.userId }, activeQuotes: 1, archivedQuotes: 1 });
    expect(opened?.quotes).toEqual(expect.arrayContaining([
      { id: first.id, reference: first.draft!.reference, title: "Cuisine", customerName: "Maison Exemple SA", archived: true, hasDraft: true, revision: 0, updatedAt: expect.any(Date) },
      { id: second.id, reference: published.revisions[0].quote.reference, title: "Salle de bain", customerName: "Maison Exemple SA", archived: false, hasDraft: false, revision: 1, updatedAt: expect.any(Date) },
    ]));
    expect(opened?.quotes).toHaveLength(2);
    expect(await readArtisanBusiness(database, administrator.userId, crypto.randomUUID())).toBeNull();
  });

  it("opens a Quote read-only with its conversation, each Assistant Turn linked to its Turn Trace", async () => {
    const artisan = await harness.artisan("Conversation Artisan");
    const detail = await draft(artisan);
    expect((await send(artisan, detail, "Ajoute la pose.", "Quelle pièce ?")).status).toBe(200);
    expect((await send(artisan, detail, "Le salon.", "Noté pour le salon.")).status).toBe(200);
    const traces = await database.select({ id: turnTrace.id, createdAt: turnTrace.createdAt }).from(turnTrace).where(eq(turnTrace.quoteId, detail.id)).orderBy(turnTrace.createdAt);
    // The first turn's Turn Trace has expired.
    await database.update(turnTrace).set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) }).where(eq(turnTrace.id, traces[0].id));

    const opened = await readQuoteForAdministrator(database, administrator.userId, detail.id);
    expect(opened).toMatchObject({
      id: detail.id, reference: detail.draft!.reference, title: "Bibliothèque sur mesure", archived: false,
      business: { id: await businessOf(artisan), owner: { id: artisan.userId, email: artisan.email } },
      draft: { title: "Bibliothèque sur mesure" }, revisions: [],
    });
    expect(opened!.conversation.map((entry) => [entry.role, entry.fr, entry.traces?.map((trace) => trace.id)])).toEqual([
      ["artisan", "Ajoute la pose.", []],
      ["assistant", expect.stringContaining("Quelle pièce ?"), undefined],
      ["artisan", "Le salon.", [traces[1].id]],
      ["assistant", expect.stringContaining("Noté pour le salon."), undefined],
    ]);
    expect(opened!.conversation[2].traces).toEqual([{ id: traces[1].id, outcomeKind: "unchanged", createdAt: traces[1].createdAt }]);
    expect(await readQuoteForAdministrator(database, administrator.userId, crypto.randomUUID())).toBeNull();
  });

  it("opens an Archived Quote with its Published Revisions", async () => {
    const artisan = await harness.artisan("Archive Artisan");
    const published = await quoteSteps(artisan.request).publish(await draft(artisan));
    expect((await artisan.request({ action: "archive", id: published.id, requestId: crypto.randomUUID() })).status).toBe(200);
    const opened = await readQuoteForAdministrator(database, administrator.userId, published.id);
    expect(opened).toMatchObject({ archived: true, draft: null, revisions: [{ number: 1, publishedAt: expect.any(Date) }] });
  });

  it("refuses anyone but an Administrator", async () => {
    const artisan = await harness.artisan("Curious Artisan");
    const detail = await draft(artisan);
    await expect(listArtisanBusinesses(database, artisan.userId)).rejects.toBeInstanceOf(AdministrationRefusal);
    await expect(readArtisanBusiness(database, artisan.userId, await businessOf(artisan))).rejects.toBeInstanceOf(AdministrationRefusal);
    await expect(readQuoteForAdministrator(database, artisan.userId, detail.id)).rejects.toBeInstanceOf(AdministrationRefusal);
  });

  describe("PDF downloads", () => {
    const renderer: PdfRenderer = { render: async (page) => new TextEncoder().encode(page.html), close: async () => {} };
    const pdfs = createAdministratorQuotePdfHandler({ database, auth: harness.auth, renderer });
    const download = (cookie: string, path: string) => pdfs(new Request(`http://localhost:5173${path}`, { headers: { cookie } }));

    it("lets an Administrator download any business's Quote Documents and Draft Previews", async () => {
      const artisan = await harness.artisan("Downloads Artisan");
      const published = await quoteSteps(artisan.request).publish(await draft(artisan, "Escalier"));
      const next = await quoteSteps(artisan.request).newDraft(published);

      const document = await download(administrator.cookie, `/admin/quotes/${next.id}/revisions/1/document`);
      expect(document.status).toBe(200);
      expect(document.headers.get("content-type")).toBe("application/pdf");
      expect(document.headers.get("content-disposition")).toContain(`Devis-${published.revisions[0].quote.reference}-r1.pdf`);
      expect(await document.text()).toContain("Escalier");

      const preview = await download(administrator.cookie, `/admin/quotes/${next.id}/draft-preview`);
      expect(preview.status).toBe(200);
      expect(await preview.text()).toContain("BROUILLON");

      expect((await download(administrator.cookie, `/admin/quotes/${next.id}/revisions/2/document`)).status).toBe(404);
      expect((await download(administrator.cookie, `/admin/quotes/${crypto.randomUUID()}/draft-preview`)).status).toBe(404);
    });

    it("is not found for anyone but an Administrator", async () => {
      const artisan = await harness.artisan("Own Downloads Artisan");
      const detail = await draft(artisan);
      expect((await download(artisan.cookie, `/admin/quotes/${detail.id}/draft-preview`)).status).toBe(404);
      expect((await download("", `/admin/quotes/${detail.id}/draft-preview`)).status).toBe(404);
    });
  });
});
