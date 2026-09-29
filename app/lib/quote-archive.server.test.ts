import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

import { artisanBusiness, quote, quoteMessage, quoteRequest, quoteRevision } from "./db/schema";
import { createQuotePdfHandler } from "./quote-pdf.server";
import { createQuoteHandler } from "./quotes.server";
import { completeQuote, quoteHttpHarness, quoteSteps, type ArtisanFixture, type QuoteDetailBody } from "./quote-http.test-support";

// #44: archive, restore and permanently delete Quotes; never reuse automatic references.

type ListBody = { quotes: { id: string; reference: string; archived: boolean; hasDraft: boolean; revision: number }[] };

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("archiving and deleting Quotes through the authenticated Quote HTTP boundary", () => {
  const harness = quoteHttpHarness("archive");
  let artisan: ArtisanFixture;
  let other: ArtisanFixture;
  let steps: ReturnType<typeof quoteSteps>;

  beforeAll(async () => {
    harness.setUp();
    artisan = await harness.artisan("Archiving Artisan");
    other = await harness.artisan("Other Artisan");
    steps = quoteSteps(artisan.request);
  });
  afterAll(() => harness.tearDown());

  const archive = (id: string, requestId: string = crypto.randomUUID(), request = artisan.request) => request({ action: "archive", id, requestId });
  const restore = (id: string, requestId: string = crypto.randomUUID(), request = artisan.request) => request({ action: "restore", id, requestId });
  const remove = (id: string, requestId: string = crypto.randomUUID(), request = artisan.request) => request({ action: "delete", id, requestId });

  async function ok<T = QuoteDetailBody & { archived: boolean }>(response: Promise<Response>): Promise<T> {
    const resolved = await response;
    const body = await resolved.json();
    expect(resolved.status, JSON.stringify(body)).toBe(200);
    return body;
  }

  async function list(request = artisan.request): Promise<ListBody> {
    return ok<ListBody>(request());
  }

  async function publishedWithPendingDraft() {
    const created = await steps.create();
    const saved = await steps.save(created, completeQuote(created.draft!.reference));
    const published = await steps.publish(saved);
    const draft = await steps.newDraft(published);
    return steps.save(draft, { ...draft.draft!, title: "Changement non publié" });
  }

  function pdf(path: string, cookie = artisan.cookie) {
    const handler = createQuotePdfHandler({
      database: harness.connection.db, auth: harness.auth,
      renderer: { render: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]), close: async () => {} },
    });
    return handler(new Request(`http://localhost:5173${path}`, { headers: { cookie } }));
  }

  it("archives a never-published Quote, keeps its Working Draft read-only, and restores it", async () => {
    const created = await steps.create();
    const saved = await steps.save(created, { ...created.draft!, title: "Brouillon abandonné" });

    const archived = await ok(archive(saved.id));
    expect(archived).toMatchObject({ id: saved.id, archived: true, version: saved.version, draft: { title: "Brouillon abandonné" } });
    expect((await list()).quotes).toContainEqual(expect.objectContaining({ id: saved.id, archived: true }));
    expect(await ok(artisan.request(undefined, saved.id))).toMatchObject({ archived: true, draft: { title: "Brouillon abandonné" } });
    expect((await pdf(`/api/quotes/${saved.id}/draft-preview`)).status).toBe(200);

    const refused = await artisan.request({ action: "save", id: saved.id, expectedVersion: saved.version, requestId: crypto.randomUUID(), quote: { ...saved.draft!, title: "Refusé" } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "quote_archived" });

    const restored = await ok(restore(saved.id));
    expect(restored).toMatchObject({ archived: false, draft: { title: "Brouillon abandonné" } });
    expect((await list()).quotes).toContainEqual(expect.objectContaining({ id: saved.id, archived: false }));
    await steps.save(restored, { ...restored.draft!, title: "Repris" });
  });

  it("keeps a pending Working Draft on top of a Published Revision unchanged while archived", async () => {
    const pending = await publishedWithPendingDraft();
    const archived = await ok(archive(pending.id));
    expect(archived).toMatchObject({ archived: true, draft: { title: "Changement non publié" }, revisions: [{ number: 1 }] });
    expect((await pdf(`/api/quotes/${pending.id}/revisions/1/document`)).status).toBe(200);

    for (const action of ["publish", "undo"]) {
      const response = await artisan.request({ action, id: pending.id, expectedVersion: archived.version, requestId: crypto.randomUUID() });
      expect(response.status, action).toBe(409);
      expect(await response.json()).toMatchObject({ error: "quote_archived" });
    }

    const restored = await ok(restore(pending.id));
    expect(restored).toMatchObject({ archived: false, version: pending.version, draft: pending.draft, canUndo: true });
    await steps.publish(restored);
  });

  it("refuses to start a new Working Draft, apply a Customer or run the assistant on an Archived Quote", async () => {
    const created = await steps.create();
    const saved = await steps.save(created, completeQuote(created.draft!.reference));
    const published = await steps.publish(saved);
    await ok(archive(published.id));
    const newDraft = await artisan.request({ action: "new-draft", id: published.id, expectedVersion: published.version, requestId: crypto.randomUUID() });
    expect(await newDraft.json()).toMatchObject({ error: "quote_archived" });

    const draft = await steps.create();
    const customer = await ok<{ savedCustomer: { id: string } }>(artisan.request({ action: "customer-save", requestId: crypto.randomUUID(), customer: { name: "Maison Archive", address: "Rue Archive 1", contact: "" } }));
    await ok(archive(draft.id));
    const applied = await artisan.request({ action: "customer-apply", id: draft.id, expectedVersion: draft.version, requestId: crypto.randomUUID(), customerId: customer.savedCustomer.id });
    expect(await applied.json()).toMatchObject({ error: "quote_archived" });
    const assistant = await artisan.request({ action: "assistant", id: draft.id, expectedVersion: draft.version, requestId: crypto.randomUUID(), text: "Ajoute une ligne.", locale: "fr" });
    expect(assistant.status).toBe(409);
    expect(await assistant.json()).toMatchObject({ error: "quote_archived" });
  });

  it("discards an assistant response that finishes after the Quote was archived", async () => {
    const created = await steps.create();
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Titre de l’assistant" } })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Titre modifié."),
    ]);
    const request = artisan.withDependencies({ modelBoundary: {
      model: faux.getModel(),
      streamFn: async (model, context, options) => {
        await ok(archive(created.id));
        return models.streamSimple(model, context, options);
      },
      timeoutMs: 1_000,
    } });
    const response = await request({ action: "assistant", id: created.id, expectedVersion: created.version, requestId: crypto.randomUUID(), text: "Change le titre.", locale: "fr" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "quote_archived" });
    const reopened = await ok(artisan.request(undefined, created.id));
    expect(reopened).toMatchObject({ archived: true, pending: false, version: created.version, draft: { title: created.draft!.title } });
  });

  it("discards an assistant response even when the Quote was restored before it finished", async () => {
    const created = await steps.create();
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Titre de l’assistant" } })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Titre modifié."),
    ]);
    let calls = 0;
    const request = artisan.withDependencies({ modelBoundary: {
      model: faux.getModel(),
      streamFn: async (model, context, options) => {
        if (calls++ === 0) {
          const archived = await ok(archive(created.id));
          expect(archived).toMatchObject({ pending: false });
          await ok(restore(created.id));
        }
        return models.streamSimple(model, context, options);
      },
      timeoutMs: 1_000,
    } });
    const response = await request({ action: "assistant", id: created.id, expectedVersion: created.version, requestId: crypto.randomUUID(), text: "Change le titre.", locale: "fr" });
    expect(response.status).toBe(409);
    const reopened = await ok(artisan.request(undefined, created.id));
    expect(reopened).toMatchObject({ archived: false, pending: false, version: created.version, draft: { title: created.draft!.title } });
    const notes = (reopened as unknown as { messages: { role: string; en: string }[] }).messages.filter((message) => message.role === "note");
    expect(notes).toEqual([expect.objectContaining({ en: "Response discarded; the Quote was archived." })]);
  });

  it("archives and restores idempotently", async () => {
    const created = await steps.create();
    const requestId = crypto.randomUUID();
    await ok(archive(created.id, requestId));
    expect(await ok(archive(created.id, requestId))).toMatchObject({ archived: true });
    expect(await ok(archive(created.id))).toMatchObject({ archived: true });
    await ok(restore(created.id));
    expect(await ok(restore(created.id))).toMatchObject({ archived: false });
    expect((await restore(created.id, requestId)).status).toBe(409);
  });

  it("permanently deletes a published Quote with its revisions, conversation and request records", async () => {
    const pending = await publishedWithPendingDraft();
    const database = harness.connection.db;
    await database.insert(quoteMessage).values({ id: crypto.randomUUID(), quoteId: pending.id, role: "note", fr: "Note", en: "Note" });
    expect((await database.select().from(quoteRequest).where(eq(quoteRequest.quoteId, pending.id))).length).toBeGreaterThan(0);

    const requestId = crypto.randomUUID();
    const deleted = await ok<ListBody>(remove(pending.id, requestId));
    expect(deleted.quotes).not.toContainEqual(expect.objectContaining({ id: pending.id }));
    expect((await artisan.request(undefined, pending.id)).status).toBe(404);
    expect(await database.select().from(quote).where(eq(quote.id, pending.id))).toEqual([]);
    expect(await database.select().from(quoteRevision).where(eq(quoteRevision.quoteId, pending.id))).toEqual([]);
    expect(await database.select().from(quoteMessage).where(eq(quoteMessage.quoteId, pending.id))).toEqual([]);
    expect(await database.select().from(quoteRequest).where(eq(quoteRequest.quoteId, pending.id))).toEqual([]);

    // A retried delete succeeds without deleting anything else; a new key finds nothing.
    expect((await remove(pending.id, requestId)).status).toBe(200);
    expect((await remove(pending.id)).status).toBe(404);
  });

  it("deletes an Archived Quote", async () => {
    const created = await steps.create();
    await ok(archive(created.id));
    await ok(remove(created.id));
    expect((await list()).quotes).not.toContainEqual(expect.objectContaining({ id: created.id }));
  });

  it("never reuses an automatic reference after a deletion", async () => {
    const fresh = await harness.artisan("Numbering Artisan");
    const fresher = quoteSteps(fresh.request);
    const first = await fresher.create();
    const second = await fresher.create();
    expect([first.draft!.reference, second.draft!.reference]).toEqual(["Q-1", "Q-2"]);
    await ok(remove(second.id, undefined, fresh.request));
    expect((await fresher.create()).draft!.reference).toBe("Q-3");

    // An unpublished deletion leaves a gap too, and a typed reference is skipped rather than duplicated.
    await ok(remove(first.id, undefined, fresh.request));
    const typed = await fresher.create();
    await fresher.save(typed, { ...typed.draft!, reference: "Q-6" });
    expect((await fresher.create()).draft!.reference).toBe("Q-5");
    expect((await fresher.create()).draft!.reference).toBe("Q-7");

    // Easy Quote does not remember deleted references, so an Artisan may type one again.
    const retyped = await fresher.create();
    expect((await fresher.save(retyped, { ...retyped.draft!, reference: "Q-1" })).draft!.reference).toBe("Q-1");
  });

  it("starts each existing business's counter after its highest Q-<n> when migrating", async () => {
    const fresh = await harness.artisan("Migrated Artisan");
    const fresher = quoteSteps(fresh.request);
    const created = await fresher.create();
    await fresher.save(created, { ...created.draft!, reference: "Q-41" });
    const other = await fresher.create();
    await fresher.save(other, { ...other.draft!, reference: "CUSTOM-99" });
    const database = harness.connection.db;
    const [{ businessId }] = await database.select({ businessId: quote.businessId }).from(quote).where(eq(quote.id, created.id));
    await database.update(artisanBusiness).set({ nextQuoteNumber: 1 }).where(eq(artisanBusiness.id, businessId));

    const migration = readFileSync(new URL("../../drizzle/0010_quote_archive.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await database.execute(sql.raw(statement));

    const [business] = await database.select().from(artisanBusiness).where(eq(artisanBusiness.id, businessId));
    expect(business.nextQuoteNumber).toBe(42);
    expect((await fresher.create()).draft!.reference).toBe("Q-42");
  });

  it("limits archive, restore and delete to the Artisan's own business", async () => {
    const created = await steps.create();
    for (const response of [archive(created.id, undefined, other.request), restore(created.id, undefined, other.request), remove(created.id, undefined, other.request)]) {
      expect((await response).status).toBe(404);
    }
    expect((await list(other.request)).quotes).not.toContainEqual(expect.objectContaining({ id: created.id }));
    expect(await ok(artisan.request(undefined, created.id))).toMatchObject({ archived: false });
  });

  it("requires a request from the app's own origin", async () => {
    const created = await steps.create();
    const handler = createQuoteHandler({ database: harness.connection.db, auth: harness.auth });
    for (const action of ["archive", "restore", "delete"]) {
      const response = await handler(new Request("http://localhost:5173/api/quotes", {
        method: "POST", headers: { cookie: artisan.cookie, origin: "https://attacker.example", "content-type": "application/json" },
        body: JSON.stringify({ action, id: created.id, requestId: crypto.randomUUID() }),
      }));
      expect(response.status, action).toBe(403);
    }
    expect(await ok(artisan.request(undefined, created.id))).toMatchObject({ archived: false });
  });
});
