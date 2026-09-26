import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { completeQuote, quoteHttpHarness, quoteSteps, type ArtisanFixture, type QuoteDetailBody } from "./quote-http.test-support";

// #19: later Working Drafts copied from the latest Published Revision, and revision history.

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("later revisions through the authenticated Quote HTTP boundary", () => {
  const harness = quoteHttpHarness("revisions");
  let artisan: ArtisanFixture;
  let other: ArtisanFixture;
  let steps: ReturnType<typeof quoteSteps>;

  beforeAll(async () => {
    harness.setUp();
    artisan = await harness.artisan("Revising Artisan");
    other = await harness.artisan("Other Artisan");
    steps = quoteSteps(artisan.request);
  });
  afterAll(() => harness.tearDown());

  async function publishedQuote(): Promise<QuoteDetailBody> {
    const created = await steps.create();
    const saved = await steps.save(created, completeQuote(created.draft!.reference, {
      discountMode: "fixed", discount: "10.00", validUntil: "2026-10-15", terms: "Conditions publiées.",
      sections: [{ id: "area", title: "Zone" }],
      lines: [
        { id: "flat", sectionId: "", description: "Forfait", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "100.00" },
        { id: "grouped", sectionId: "area", description: "Pose", mode: "quantity", quantity: "3", unit: "h", unitPrice: "85.00", amount: "" },
      ],
    }));
    return steps.publish(saved);
  }

  it("copies the latest published snapshots exactly without refreshing reusable records or defaults", async () => {
    const savedCustomer = await artisan.request({ action: "customer-save", requestId: crypto.randomUUID(), customer: { name: "Maison Révision SA", address: "Rue Initiale 1\n1000 Exemple", contact: "Camille" } });
    const customerId = (await savedCustomer.json()).savedCustomer.id as string;
    expect((await artisan.request({ action: "defaults-save", defaults: { businessName: "Atelier Initial", businessAddress: "Rue Atelier 1", businessContact: "initial@example.test", vatRegistered: true, vatId: "CHE-111.111.111 TVA", terms: "Conditions initiales." } })).status).toBe(200);

    let detail = await steps.create();
    const applied = await artisan.request({ action: "customer-apply", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), customerId });
    detail = await applied.json();
    detail = await steps.save(detail, completeQuote(detail.draft!.reference, {
      ...detail.draft!, title: "Agencement", issueDate: "2026-08-20", validUntil: "2026-09-20", siteAddress: "Chantier 4",
      discountMode: "percent", discount: "3.5",
      lines: [{ id: "line", sectionId: "", description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "400.00" }],
    }));
    const published = await steps.publish(detail);
    const snapshot = published.revisions[0].quote;
    expect(snapshot).toMatchObject({ customerAddress: "Rue Initiale 1\n1000 Exemple", businessName: "Atelier Initial", terms: "Conditions initiales.", vatRegistered: true });

    // Reusable records and defaults change after Publication.
    await artisan.request({ action: "customer-save", requestId: crypto.randomUUID(), customer: { id: customerId, name: "Maison Révision SA", address: "Rue Nouvelle 99", contact: "Autre contact" } });
    await artisan.request({ action: "defaults-save", defaults: { businessName: "Atelier Renommé", businessAddress: "Rue Neuve 2", businessContact: "neuf@example.test", vatRegistered: false, vatId: "", terms: "Nouvelles conditions." } });

    const later = await steps.newDraft(published);
    expect(later.draft).toEqual(snapshot);
    expect(later.draft!.issueDate).toBe("2026-08-20");
    expect(later).toMatchObject({ canUndo: false, revisions: [{ number: 1 }] });
    expect((await steps.read(later.id)).draft).toEqual(snapshot);
  });

  it("allows only one later Working Draft, including under competing requests", async () => {
    const published = await publishedQuote();
    const responses = await Promise.all([0, 1, 2].map(() => artisan.request({ action: "new-draft", id: published.id, expectedVersion: published.version, requestId: crypto.randomUUID() })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409]);
    const current = await steps.read(published.id);
    expect(current.draft).toEqual(published.revisions[0].quote);

    const again = await artisan.request({ action: "new-draft", id: current.id, expectedVersion: current.version, requestId: crypto.randomUUID() });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("working_draft_exists");
    const unpublished = await steps.create();
    const fromDraft = await artisan.request({ action: "new-draft", id: unpublished.id, expectedVersion: unpublished.version, requestId: crypto.randomUUID() });
    expect(fromDraft.status).toBe(409);
    expect((await fromDraft.json()).error).toBe("working_draft_exists");
  });

  it("numbers revisions only on Publication, keeps revision 1 unchanged, and copies only the latest revision", async () => {
    const published = await publishedQuote();
    const revisionOne = published.revisions[0];
    const reference = revisionOne.quote.reference;

    let detail = await steps.newDraft(published);
    for (const amount of ["120.00", "130.00", "140.00"]) {
      detail = await steps.save(detail, { ...detail.draft!, lines: detail.draft!.lines.map((line) => line.id === "flat" ? { ...line, amount } : line) });
    }
    detail = await steps.undo(detail);
    expect(detail.revisions).toEqual([revisionOne]);
    expect((await steps.read(detail.id)).revisions).toEqual([revisionOne]);

    detail = await steps.publish(detail);
    expect(detail.revisions.map((revision) => revision.number)).toEqual([1, 2]);
    expect(detail.revisions[0]).toEqual(revisionOne);
    expect(detail.revisions[1].quote).toMatchObject({ reference, lines: expect.arrayContaining([expect.objectContaining({ id: "flat", amount: "130.00" })]) });
    expect(detail.revisions[1].calculation).toMatchObject({ subtotal: 38_500, discount: 1_000, net: 37_500, vat: 3_038, total: 40_538 });

    // The request cannot name an older revision: the later draft always starts from the latest one.
    const later = await artisan.request({ action: "new-draft", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), revision: 1, fromRevision: 1 });
    expect(later.status).toBe(200);
    detail = await later.json();
    expect(detail.draft).toEqual(detail.revisions[1].quote);
    expect(detail.revisions[0]).toEqual(revisionOne);
  });

  it("lists a current Working Draft separately from the latest Published Revision", async () => {
    const published = await publishedQuote();
    const entry = async () => (await steps.list()).quotes.find((candidate) => candidate.id === published.id);
    expect(await entry()).toMatchObject({ hasDraft: false, revision: 1 });

    let detail = await steps.newDraft(published);
    detail = await steps.save(detail, { ...detail.draft!, title: "Titre de la révision 2" });
    expect(await entry()).toMatchObject({ hasDraft: true, revision: 1, title: "Titre de la révision 2" });
    expect(await steps.read(detail.id)).toMatchObject({ draft: { title: "Titre de la révision 2" }, revisions: [{ number: 1, quote: { title: "Bibliothèque sur mesure" } }] });

    detail = await steps.publish(detail);
    expect(await entry()).toMatchObject({ hasDraft: false, revision: 2, title: "Titre de la révision 2" });
    expect(await steps.read(detail.id)).toMatchObject({ draft: null, revisions: [{ number: 1 }, { number: 2 }] });
  });

  it("publishes a later Working Draft exactly once under competing requests", async () => {
    const published = await publishedQuote();
    let detail = await steps.newDraft(published);
    detail = await steps.save(detail, { ...detail.draft!, title: "Révision concurrente" });
    const responses = await Promise.all([0, 1].map(() => artisan.request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await steps.read(detail.id)).revisions.map((revision) => revision.number)).toEqual([1, 2]);
  });

  it("rejects later-draft, save and Publication requests from another Artisan Business", async () => {
    const published = await publishedQuote();
    const foreignDraft = await other.request({ action: "new-draft", id: published.id, expectedVersion: published.version, requestId: crypto.randomUUID() });
    expect(foreignDraft.status).toBe(404);
    const detail = await steps.newDraft(published);
    for (const body of [
      { action: "save", quote: { ...detail.draft, title: "Intrusion" } },
      { action: "publish" },
      { action: "undo" },
    ]) {
      const response = await other.request({ ...body, id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
      expect(response.status, body.action).toBe(404);
    }
    expect((await other.request(undefined, detail.id)).status).toBe(404);
    const reopened = await steps.read(detail.id);
    expect(reopened).toMatchObject({ version: detail.version, draft: detail.draft, revisions: [{ number: 1 }] });
  });

  it("keeps the saved conversation across Publication and a later Working Draft", async () => {
    let detail = await steps.create();
    detail = await steps.save(detail, completeQuote(detail.draft!.reference));
    detail = await steps.save(detail, completeQuote(detail.draft!.reference, { title: "Avant annulation" }));
    detail = await steps.undo(detail);
    const messages = (await artisan.request(undefined, detail.id).then((response) => response.json())).messages;
    expect(messages).toContainEqual(expect.objectContaining({ role: "note" }));
    detail = await steps.publish(detail);
    detail = await steps.newDraft(detail);
    expect((await artisan.request(undefined, detail.id).then((response) => response.json())).messages).toEqual(messages);
  });
});
