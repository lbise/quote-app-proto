import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { calculateQuote, type QuoteData } from "./quote";
import { completeQuote, quoteHttpHarness, quoteSteps, type ArtisanFixture } from "./quote-http.test-support";

// #18: Publishing a complete Working Draft as Published Revision 1.

function everyCommercialField(reference: string): QuoteData {
  return completeQuote(reference, {
    title: "Agencement du séjour",
    customerName: "Maison des Tilleuls SA",
    customerAddress: "Rue des Tilleuls 8\n1000 Lausanne",
    customerContact: "Camille Exemple",
    businessName: "Atelier du Bois Sàrl",
    businessAddress: "Route de la Menuiserie 6\n1009 Pully",
    businessContact: "bonjour@atelier-bois.example",
    vatRegistered: true,
    vatId: "CHE-123.456.789 TVA",
    issueDate: "2026-09-01",
    validUntil: "2026-10-01",
    siteAddress: "Chemin du Chantier 3\n1000 Lausanne",
    terms: "Acompte de 30 % à la commande.",
    discountMode: "percent",
    discount: "5",
    sections: [{ id: "living", title: "Séjour" }, { id: "bedroom", title: "Chambre" }],
    // Supplied out of document order: the snapshot keeps the normalized order.
    lines: [
      { id: "bedroom-1", sectionId: "bedroom", description: "Tablette murale", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "75.00" },
      { id: "living-1", sectionId: "living", description: "Habillage mural en chêne", mode: "quantity", quantity: "12.5", unit: "m²", unitPrice: "40.00", amount: "" },
      { id: "flat-1", sectionId: "", description: "Déplacement", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "60.00" },
    ],
  });
}

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("Publication through the authenticated Quote HTTP boundary", () => {
  const harness = quoteHttpHarness("publication");
  let artisan: ArtisanFixture;
  let other: ArtisanFixture;
  let steps: ReturnType<typeof quoteSteps>;

  beforeAll(async () => {
    harness.setUp();
    artisan = await harness.artisan("Publishing Artisan");
    other = await harness.artisan("Other Artisan");
    steps = quoteSteps(artisan.request);
  });
  afterAll(() => harness.tearDown());

  async function settledDraft(quote?: (reference: string) => QuoteData) {
    const created = await steps.create();
    return steps.save(created, (quote ?? completeQuote)(created.draft!.reference));
  }

  it("freezes every commercial field and calculated amount together in read-only Published Revision 1", async () => {
    const created = await steps.create();
    const quote = { ...everyCommercialField(created.draft!.reference), reference: `ATL-${crypto.randomUUID().slice(0, 8)}` };
    const saved = await steps.save(created, quote);
    const published = await steps.publish(saved);

    const expected = calculateQuote(quote);
    expect(published).toMatchObject({ draft: null, canUndo: false, pending: false });
    expect(published.revisions).toHaveLength(1);
    const [revision] = published.revisions;
    expect(Object.keys(revision).sort()).toEqual(["calculation", "number", "publishedAt", "quote"]);
    expect(revision.number).toBe(1);
    expect(revision.quote).toEqual(expected.quote);
    expect(revision.quote.lines.map((line) => line.id)).toEqual(["flat-1", "living-1", "bedroom-1"]);
    expect(revision.calculation).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(revision.calculation).toMatchObject({
      complete: true, subtotal: 63_500, discount: 3_175, net: 60_325, vat: 4_886, total: 65_211,
      sections: [{ id: "living", subtotal: 50_000 }, { id: "bedroom", subtotal: 7_500 }],
    });

    // The reference is listed separately from the revision number, and the list records nothing about sending or acceptance.
    const listed = (await steps.list()).quotes.find((entry) => entry.id === published.id)!;
    expect(listed).toMatchObject({ reference: quote.reference, revision: 1, hasDraft: false });
    expect(Object.keys(listed).sort()).toEqual(["customerName", "hasDraft", "id", "reference", "revision", "title", "updatedAt"]);

    // Publication cannot be undone, overwritten or repeated without a new Working Draft.
    for (const body of [
      { action: "undo" },
      { action: "save", quote: { ...quote, title: "Réécrit" } },
      { action: "publish" },
    ]) {
      const response = await artisan.request({ ...body, id: published.id, expectedVersion: published.version, requestId: crypto.randomUUID() });
      expect(response.status, body.action).toBe(409);
      expect((await response.json()).error, body.action).toBe(body.action === "undo" ? "nothing_to_undo" : "working_draft_required");
    }
    const reopened = await steps.read(published.id);
    expect(reopened).toMatchObject({ draft: null, version: published.version });
    expect(reopened.revisions).toEqual(published.revisions);
  });

  it("fixes the reference after first Publication", async () => {
    const published = await steps.publish(await settledDraft());
    const later = await steps.newDraft(published);
    const renamed = await artisan.request({ action: "save", id: later.id, expectedVersion: later.version, requestId: crypto.randomUUID(), quote: { ...later.draft, reference: `RENAMED-${crypto.randomUUID()}` } });
    expect(renamed.status).toBe(422);
    expect((await renamed.json()).error).toBe("reference_fixed");
    expect((await steps.read(later.id)).draft!.reference).toBe(published.revisions[0].quote.reference);
  });

  it("blocks incomplete and stale Publication with explicit reasons and without creating a revision", async () => {
    const incomplete = await settledDraft((reference) => completeQuote(reference, {
      customerAddress: "", vatRegistered: null,
      lines: [{ id: "line-1", sectionId: "", description: "Pose", mode: "quantity", quantity: "2", unit: "h", unitPrice: "", amount: "" }],
    }));
    const blocked = await artisan.request({ action: "publish", id: incomplete.id, expectedVersion: incomplete.version, requestId: crypto.randomUUID() });
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).details.missing).toEqual(expect.arrayContaining([
      { path: "customerAddress", code: "required" },
      { path: "vatRegistered", code: "required" },
      { path: "lines[0].unitPrice", code: "required" },
    ]));

    const ready = await settledDraft();
    const stale = await artisan.request({ action: "publish", id: ready.id, expectedVersion: ready.version - 1, requestId: crypto.randomUUID() });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("stale_version");

    for (const id of [incomplete.id, ready.id]) {
      const reopened = await steps.read(id);
      expect(reopened.revisions).toEqual([]);
      expect(reopened.draft).not.toBeNull();
    }
  });

  it("publishes exactly one revision when competing requests use different keys", async () => {
    const ready = await settledDraft();
    const responses = await Promise.all([0, 1, 2].map(() => artisan.request({ action: "publish", id: ready.id, expectedVersion: ready.version, requestId: crypto.randomUUID() })));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    for (const response of responses.filter((candidate) => candidate.status === 409)) {
      expect((await response.json()).error).toBe("stale_version");
    }
    const reopened = await steps.read(ready.id);
    expect(reopened.revisions.map((revision) => revision.number)).toEqual([1]);
    expect(reopened.revisions[0].quote).toEqual(ready.draft);
  });

  it("rejects Publication and reads of another Artisan Business's Quote", async () => {
    const ready = await settledDraft();
    const publish = await other.request({ action: "publish", id: ready.id, expectedVersion: ready.version, requestId: crypto.randomUUID() });
    expect(publish.status).toBe(404);
    expect((await publish.json()).error).toBe("quote_not_found");
    expect((await other.request(undefined, ready.id)).status).toBe(404);
    const reopened = await steps.read(ready.id);
    expect(reopened).toMatchObject({ version: ready.version, revisions: [] });

    const published = await steps.publish(ready);
    expect((await other.request(undefined, published.id)).status).toBe(404);
    const otherList = await quoteSteps(other.request).list();
    expect(otherList.quotes.map((entry) => entry.id)).not.toContain(published.id);
  });
});
