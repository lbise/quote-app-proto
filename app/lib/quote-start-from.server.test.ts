import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { quote, quoteMessage } from "./db/schema";
import { emptyQuote, type QuoteData } from "./quote";
import { completeQuote, quoteHttpHarness, quoteSteps, type ArtisanFixture, type QuoteDetailBody } from "./quote-http.test-support";

// #48: start a new Quote from one chosen version of an existing Quote.

type Detail = QuoteDetailBody & { archived: boolean; canUndo: boolean; pending: boolean; messages: unknown[]; updatedAt: string };

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("starting a Quote from another Quote through the authenticated Quote HTTP boundary", () => {
  const harness = quoteHttpHarness("start-from");
  let artisan: ArtisanFixture;
  let other: ArtisanFixture;
  let steps: ReturnType<typeof quoteSteps>;

  beforeAll(async () => {
    harness.setUp();
    artisan = await harness.artisan("Starting Artisan");
    other = await harness.artisan("Other Artisan");
    steps = quoteSteps(artisan.request);
  });
  afterAll(() => harness.tearDown());

  const startFrom = (id: string, from: unknown, extra: Record<string, unknown> = {}, request = artisan.request) =>
    request({ action: "create-from", id, from, requestId: crypto.randomUUID(), ...extra });

  async function ok<T = Detail>(response: Promise<Response>): Promise<T> {
    const resolved = await response;
    const body = await resolved.json();
    expect(resolved.status, JSON.stringify(body)).toBe(200);
    return body;
  }

  async function refused(response: Promise<Response>, status: number, error: string) {
    const resolved = await response;
    expect(resolved.status).toBe(status);
    expect(await resolved.json()).toMatchObject({ error });
  }

  /** Everything about a Quote that starting another Quote from it must leave alone. */
  async function snapshot(id: string) {
    const [row] = await harness.connection.db.select().from(quote).where(eq(quote.id, id));
    const detail = await steps.read(id);
    return { row: { ...row, updatedAt: row.updatedAt.toISOString() }, detail };
  }

  const work: Pick<QuoteData, "sections" | "lines"> = {
    sections: [{ id: "section-kitchen", title: "Cuisine" }, { id: "section-fitting", title: "Pose" }],
    lines: [
      { id: "line-survey", sectionId: "", description: "Relevé sur place", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" },
      { id: "line-fronts", sectionId: "section-kitchen", description: "Façades chêne", mode: "quantity", quantity: "6", unit: "pce", unitPrice: "180.00", amount: "" },
      { id: "line-fitting", sectionId: "section-fitting", description: "Montage", mode: "quantity", quantity: "8", unit: "h", unitPrice: "95.00", amount: "" },
    ],
  };

  /** A published Quote with a Customer, site address and discount, then a different Working Draft on top. */
  async function publishedWithDraft() {
    const created = await steps.create();
    const saved = await steps.save(created, completeQuote(created.draft!.reference, {
      ...work, title: "Cuisine Dupont", siteAddress: "Chemin des Vignes 4", discountMode: "percent", discount: "5",
      validUntil: "2026-10-31", terms: "Anciennes conditions",
    }));
    const published = await steps.publish(saved);
    const draft = await steps.newDraft(published);
    return steps.save(draft, { ...draft.draft!, title: "Cuisine Dupont, façades noyer", lines: draft.draft!.lines.slice(0, 2) });
  }

  it("starts a Quote from a Published Revision with only its work, and current business defaults", async () => {
    const source = await publishedWithDraft();
    await ok(artisan.request({ action: "defaults-save", requestId: crypto.randomUUID(), defaults: {
      businessName: "Atelier Nouveau", businessAddress: "Rue Neuve 2", businessContact: "neuf@example.test", vatRegistered: false, vatId: "", terms: "Nouvelles conditions",
    } }));
    const before = await snapshot(source.id);
    const fresh = await steps.create();

    const started = await ok(startFrom(source.id, 1));
    expect(started.id).not.toBe(source.id);
    expect(started.draft!.reference).not.toBe(source.draft!.reference);
    expect(started.draft!.reference).toMatch(/^Q-\d+$/);
    expect(started).toMatchObject({ version: 0, revisions: [], messages: [], archived: false, canUndo: false, pending: false });
    expect(started.draft).toEqual({
      ...fresh.draft!,
      reference: started.draft!.reference,
      title: "Cuisine Dupont",
      sections: [{ id: expect.any(String), title: "Cuisine" }, { id: expect.any(String), title: "Pose" }],
      lines: work.lines.map((line) => ({ ...line, id: expect.any(String), sectionId: expect.any(String) })),
    });
    expect(started.draft).toMatchObject({ customerName: "", customerAddress: "", customerContact: "", siteAddress: "", discountMode: "none", businessName: "Atelier Nouveau", terms: "Nouvelles conditions", vatRegistered: false });

    const [section, secondSection] = started.draft!.sections;
    expect([section.id, secondSection.id]).not.toContain("section-kitchen");
    expect(started.draft!.lines.map((line) => line.sectionId)).toEqual(["", section.id, secondSection.id]);
    expect(started.draft!.lines.map((line) => line.id).some((id) => work.lines.some((line) => line.id === id))).toBe(false);

    const [row] = await harness.connection.db.select().from(quote).where(eq(quote.id, started.id));
    expect(row).toMatchObject({ capturedLineIds: [], undoDraft: null, undoCapturedLineIds: null, title: "Cuisine Dupont" });
    expect(await snapshot(source.id)).toEqual(before);
    expect((await steps.list()).quotes).toContainEqual(expect.objectContaining({ id: started.id, reference: started.draft!.reference, hasDraft: true, revision: 0 }));
  });

  it("starts a Quote from the Working Draft as it is stored, even on top of a revision", async () => {
    const source = await publishedWithDraft();
    const started = await ok(startFrom(source.id, "draft"));
    expect(started.draft).toMatchObject({ title: "Cuisine Dupont, façades noyer", customerName: "" });
    expect(started.draft!.lines.map((line) => line.description)).toEqual(["Relevé sur place", "Façades chêne"]);

    // The new Quote is independent: editing it leaves the source unchanged.
    await steps.save(started, { ...started.draft!, title: "Autre cuisine" });
    expect((await steps.read(source.id)).draft!.title).toBe("Cuisine Dupont, façades noyer");
  });

  it("uses the stored Working Draft while an assistant change is still pending, and leaves it pending", async () => {
    const created = await steps.create();
    const source = await steps.save(created, { ...created.draft!, ...work, title: "En cours" });
    await harness.connection.db.update(quote).set({ pending: true, pendingVersion: source.version, pendingRequestId: "pending-turn", pendingExpiresAt: new Date(Date.now() + 60_000) }).where(eq(quote.id, source.id));
    const started = await ok(startFrom(source.id, "draft"));
    expect(started.draft!.title).toBe("En cours");
    expect(await steps.read(source.id)).toMatchObject({ pending: true, version: source.version });
  });

  it("does not carry assistant provenance or conversation into the new Quote", async () => {
    const created = await steps.create();
    const source = await steps.save(created, { ...created.draft!, ...work });
    await harness.connection.db.update(quote).set({ capturedLineIds: work.lines.map((line) => line.id) }).where(eq(quote.id, source.id));
    await harness.connection.db.insert(quoteMessage).values({ id: crypto.randomUUID(), quoteId: source.id, role: "artisan", fr: "Ajoute la pose.", en: "Ajoute la pose." });
    const started = await ok(startFrom(source.id, "draft"));
    const [row] = await harness.connection.db.select().from(quote).where(eq(quote.id, started.id));
    expect(row.capturedLineIds).toEqual([]);
    expect(started.messages).toEqual([]);
  });

  it("starts from Archived and never-published Quotes, and from empty versions", async () => {
    const empty = await steps.create();
    const archived = await ok(artisan.request({ action: "archive", id: empty.id, requestId: crypto.randomUUID() }));
    const before = await snapshot(empty.id);
    const started = await ok(startFrom(empty.id, "draft"));
    expect(started.draft).toMatchObject({ title: "", sections: [], lines: [] });
    expect(started.archived).toBe(false);
    expect(await snapshot(empty.id)).toEqual(before);
    expect(archived).toMatchObject({ archived: true });

    const created = await steps.create();
    const published = await steps.publish(await steps.save(created, completeQuote(created.draft!.reference)));
    await ok(artisan.request({ action: "archive", id: published.id, requestId: crypto.randomUUID() }));
    expect((await ok(startFrom(published.id, 1))).draft!.lines).toHaveLength(1);
  });

  it("returns the same new Quote when a request is retried", async () => {
    const source = await publishedWithDraft();
    const requestId = crypto.randomUUID();
    const first = await ok(artisan.request({ action: "create-from", id: source.id, from: 1, requestId }));
    const retried = await ok(artisan.request({ action: "create-from", id: source.id, from: 1, requestId }));
    expect(retried.id).toBe(first.id);
    await refused(artisan.request({ action: "create-from", id: source.id, from: "draft", requestId }), 409, "request_key_reused");
  });

  it("copies the Working Draft on screen only while it is still the stored version", async () => {
    const source = await publishedWithDraft();
    await refused(startFrom(source.id, "draft", { expectedVersion: source.version - 1 }), 409, "stale_version");
    expect((await ok(startFrom(source.id, "draft", { expectedVersion: source.version }))).draft!.title).toBe("Cuisine Dupont, façades noyer");
  });

  it("refuses a version that does not exist", async () => {
    const source = await publishedWithDraft();
    await refused(startFrom(source.id, 2), 404, "revision_not_found");
    const published = await steps.publish(source);
    await refused(startFrom(published.id, "draft"), 409, "working_draft_required");
    for (const from of [undefined, "latest", 0, "1"]) await refused(startFrom(source.id, from), 400, "invalid_source");
    await refused(startFrom("missing-quote", "draft"), 404, "quote_not_found");
  });

  it("limits sources to the Artisan's own business", async () => {
    const source = await publishedWithDraft();
    await refused(startFrom(source.id, 1, {}, other.request), 404, "quote_not_found");
    const list = await ok<{ quotes: unknown[] }>(other.request());
    expect(list.quotes).toEqual([]);
  });

  it("uses the same defaults as a new Quote when business defaults were never saved", async () => {
    const fresh = await harness.artisan("Fresh Artisan");
    const freshSteps = quoteSteps(fresh.request);
    const created = await freshSteps.create();
    const source = await freshSteps.save(created, { ...created.draft!, ...work, customerName: "Client" });
    const started = await ok(startFrom(source.id, "draft", {}, fresh.request));
    expect(started.draft).toEqual({ ...emptyQuote("Q-2"), title: "", sections: started.draft!.sections, lines: started.draft!.lines });
  });
});
