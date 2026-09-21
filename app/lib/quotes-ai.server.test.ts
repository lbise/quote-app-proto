import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";

import { createAuthForDatabase } from "./auth.server";
import { connectDatabase } from "./db.server";
import { user } from "./db/schema";
import { calculateQuote, emptyQuote, type QuoteData } from "./quote";
import { createQuoteHandler } from "./quotes.server";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("authenticated Quote HTTP boundary", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const auth = createAuthForDatabase(connection.db);
  const originalAllowlist = process.env.AUTH_ALLOWED_EMAILS;
  const originalDelivery = process.env.EMAIL_DELIVERY;
  const origin = "http://localhost:5173";
  let cookie = "";
  let handler: ReturnType<typeof createQuoteHandler>;

  beforeAll(async () => {
    process.env.AUTH_ALLOWED_EMAILS = "*";
    process.env.EMAIL_DELIVERY = "fake";
    const email = `quotes-${crypto.randomUUID()}@example.com`;
    const signedUp = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Quote Artisan", email, password: "password123" }),
    }));
    const account = await signedUp.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, account.user.id));
    const signedIn = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    }));
    cookie = signedIn.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
    handler = createQuoteHandler({ database: connection.db, auth });
  });

  afterAll(async () => {
    if (originalAllowlist === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalAllowlist;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = originalDelivery;
    await connection.pool.end();
  });

  function request(body?: Record<string, unknown>, id?: string, target = handler) {
    return target(new Request(`${origin}/api/quotes${id ? `?id=${id}` : ""}`, {
      method: body ? "POST" : "GET",
      headers: { cookie, ...(body ? { origin, "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
  }

  function complete(reference: string): QuoteData {
    return {
      ...emptyQuote(reference), title: "Bibliothèque sur mesure", customerName: "Maison Exemple SA",
      customerAddress: "Rue Exemple 8\n1000 Exemple", businessName: "Atelier Exemple Sàrl",
      businessAddress: "Rue Exemple 1\n1000 Exemple", businessContact: "bonjour@example.test",
      vatRegistered: true, vatId: "CHE-000.000.000 TVA", issueDate: "2026-09-01",
      lines: [{ id: "line-1", sectionId: "", description: "Forfait pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "100.00" }],
    };
  }

  function scriptedModel(responses: FauxResponseStep[], beforeStream?: () => Promise<void>) {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses(responses);
    const modelBoundary = {
      model: faux.getModel(),
      streamFn: async (model: Parameters<typeof models.streamSimple>[0], context: Parameters<typeof models.streamSimple>[1], options: Parameters<typeof models.streamSimple>[2]) => {
        await beforeStream?.();
        return models.streamSimple(model, context, options);
      },
      timeoutMs: 1_000,
    };
    return {
      handler: createQuoteHandler({ database: connection.db, auth, modelBoundary }),
      modelBoundary,
      faux,
    };
  }

  async function createDraft() {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    expect(created.status).toBe(200);
    return created.json();
  }

  it("edits details and a manual line, saves the result, and undoes the whole turn", async () => {
    let detail = await createDraft();
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: complete(detail.draft.reference) })).json();
    const model = scriptedModel([
      fauxAssistantMessage([fauxToolCall("edit_quote_details", {
        fields: { title: "Bibliothèque corrigée", discountMode: "percent", discount: "5" },
        evidence: [
          { fields: ["title"], source: "current", text: "Bibliothèque corrigée" },
          { fields: ["discountMode", "discount"], source: "current", text: "remise de 5 pour cent" },
        ],
      }), fauxToolCall("edit_quote_lines", {
        lines: [{ id: "line-1", description: "Forfait pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "125.00" }],
        evidence: [{ fields: ["/lines/0/amount"], source: "current", text: "forfait à 125 CHF" }],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Correction enregistrée."),
    ]);
    const response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Bibliothèque corrigée, remise de 5 pour cent, forfait à 125 CHF.", locale: "fr" }, undefined, model.handler);
    expect(response.status).toBe(200);
    detail = await response.json();
    expect(detail.draft).toMatchObject({ title: "Bibliothèque corrigée", discountMode: "percent", discount: "5", lines: [{ amount: "125.00" }] });
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 12_500, discount: 625, total: 12_837 });
    expect(detail.canUndo).toBe(true);

    const undone = await request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(undone.status).toBe(200);
    const restored = await undone.json();
    expect(restored.draft).toMatchObject({ title: "Bibliothèque sur mesure", discountMode: "none", discount: "0", lines: [{ amount: "100.00" }] });
  });

  it("keeps assistant commercial corrections local to one Quote and its reusable records", async () => {
    const customerResponse = await request({ action: "customer-save", requestId: crypto.randomUUID(), customer: { name: "Reusable Customer", address: "Reusable address", contact: "Reusable contact" } });
    expect(customerResponse.status).toBe(200);
    const customerId = (await customerResponse.json()).savedCustomer.id as string;
    const defaults = { businessName: "Reusable Business", businessAddress: "Reusable business address", businessContact: "Reusable business contact", terms: "Reusable terms", vatRegistered: true, vatId: "CHE-111.111.111 TVA" };
    expect((await request({ action: "defaults-save", defaults })).status).toBe(200);

    let first = await createDraft();
    let second = await createDraft();
    const firstBaseline = complete(first.draft.reference);
    const secondBaseline = complete(second.draft.reference);
    first = await (await request({ action: "save", id: first.id, expectedVersion: first.version, requestId: crypto.randomUUID(), quote: firstBaseline })).json();
    second = await (await request({ action: "save", id: second.id, expectedVersion: second.version, requestId: crypto.randomUUID(), quote: secondBaseline })).json();

    const model = scriptedModel([
      fauxAssistantMessage([fauxToolCall("edit_quote_details", {
        fields: {
          customerName: "Quote-local Customer", customerAddress: "Quote-local address", customerContact: "Quote-local contact",
          businessName: "Quote-local Business", businessAddress: "Quote-local business address", businessContact: "Quote-local business contact",
          terms: "Quote-local terms", vatRegistered: false, vatId: "", discountMode: "percent", discount: "5",
        },
        evidence: [{
          fields: ["customerName", "customerAddress", "customerContact", "businessName", "businessAddress", "businessContact", "terms", "vatRegistered", "vatId", "discountMode", "discount"],
          source: "current",
          text: "Quote-local Customer, Quote-local address, Quote-local contact, Quote-local Business, Quote-local business address, Quote-local business contact, Quote-local terms, sans TVA et remise de 5 percent",
        }],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Correction enregistrée dans ce Quote."),
    ]);
    const response = await request({ action: "assistant", id: first.id, expectedVersion: first.version, requestId: crypto.randomUUID(), text: "Corrige ce Quote seulement: Quote-local Customer, Quote-local address, Quote-local contact, Quote-local Business, Quote-local business address, Quote-local business contact, Quote-local terms, sans TVA et remise de 5 percent.", locale: "fr" }, undefined, model.handler);
    expect(response.status).toBe(200);
    const changed = await response.json();
    expect(changed.draft).toMatchObject({ customerName: "Quote-local Customer", customerAddress: "Quote-local address", businessName: "Quote-local Business", terms: "Quote-local terms", vatRegistered: false, vatId: "", discountMode: "percent", discount: "5" });

    const other = await (await request(undefined, second.id)).json();
    expect(other.draft).toMatchObject({ customerName: "Maison Exemple SA", businessName: "Atelier Exemple Sàrl", terms: "", vatRegistered: true, vatId: "CHE-000.000.000 TVA" });
    const list = await (await request()).json();
    expect(list.customers).toContainEqual(expect.objectContaining({ id: customerId, name: "Reusable Customer", address: "Reusable address", contact: "Reusable contact" }));
    expect(list.defaults).toMatchObject(defaults);
  });

  it("switches pricing modes and accepts a bounded bulk correction", async () => {
    let detail = await createDraft();
    const baseline = {
      ...complete(detail.draft.reference),
      vatRegistered: false, vatId: "",
      lines: [
        { id: "one", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "100.00" },
        { id: "two", sectionId: "", description: "Finition", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "50.00" },
      ],
    };
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: baseline })).json();
    const model = scriptedModel([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [
          { id: "one", description: "Pose", mode: "quantity", quantity: "2", unit: "h", unitPrice: "50.00", amount: "" },
          { id: "two", description: "Finition", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "75.00" },
        ],
        evidence: [
          { fields: ["/lines/0/mode", "/lines/0/quantity", "/lines/0/unit", "/lines/0/unitPrice"], source: "current", text: "2 heures à 50 CHF" },
          { fields: ["/lines/1/amount"], source: "current", text: "Finition à 75 CHF" },
        ],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Les deux lignes sont corrigées."),
    ]);
    const response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Passe la pose à 2 heures à 50 CHF et la finition à 75 CHF.", locale: "fr" }, undefined, model.handler);
    expect(response.status).toBe(200);
    detail = await response.json();
    expect(detail.draft.lines).toEqual([
      expect.objectContaining({ id: "one", mode: "quantity", quantity: "2", unitPrice: "50.00", amount: "" }),
      expect.objectContaining({ id: "two", amount: "75.00" }),
    ]);
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 17_500, total: 17_500, complete: true });
  });

  it("retries a failed assistant request without duplicating its Artisan message", async () => {
    const detail = await createDraft();
    const body = { action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: "assistant-retry", text: "Pose pour 25 CHF.", locale: "fr" };
    const failed = scriptedModel([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "25.00" }],
        evidence: [{ fields: ["/lines/0/mode", "/lines/0/description", "/lines/0/amount"], source: "current", text: "Pose pour 25 CHF." }],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Provider unavailable", { stopReason: "error", errorMessage: "provider unavailable" }),
    ]);
    expect((await request(body, undefined, failed.handler)).status).toBe(502);

    const retry = scriptedModel([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "25.00" }],
        evidence: [{ fields: ["/lines/0/mode", "/lines/0/description", "/lines/0/amount"], source: "current", text: "Pose pour 25 CHF." }],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Pose ajoutée."),
    ]);
    const accepted = await request(body, undefined, retry.handler);
    expect(accepted.status).toBe(200);
    const reopened = await (await request(undefined, detail.id)).json();
    expect(reopened.draft.lines).toEqual([expect.objectContaining({ description: "Pose", amount: "25.00" })]);
    expect(reopened.messages.filter((message: { role: string }) => message.role === "artisan")).toHaveLength(1);
  });

  it("rejects assistant access to a Quote owned by another Artisan Business", async () => {
    const otherAuth = createAuthForDatabase(connection.db);
    const email = `assistant-isolation-${crypto.randomUUID()}@example.com`;
    const signup = await otherAuth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Other Artisan", email, password: "password123" }),
    }));
    expect(signup.status).toBe(200);
    const account = await signup.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, account.user.id));
    const signin = await otherAuth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    }));
    expect(signin.status).toBe(200);
    const otherCookie = signin.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
    const own = await createDraft();
    const model = scriptedModel([fauxAssistantMessage("This must not run.")]);
    const otherHandler = createQuoteHandler({ database: connection.db, auth: otherAuth, modelBoundary: model.modelBoundary });
    const otherRequest = (body?: Record<string, unknown>, id?: string) => otherHandler(new Request(`${origin}/api/quotes${id ? `?id=${id}` : ""}`, {
      method: body ? "POST" : "GET",
      headers: { cookie: otherCookie, ...(body ? { origin, "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const foreign = await (await otherRequest({ action: "create", requestId: crypto.randomUUID() })).json();

    const ownAttempt = await request({ action: "assistant", id: foreign.id, expectedVersion: foreign.version, requestId: crypto.randomUUID(), text: "Change the title.", locale: "en" }, undefined, model.handler);
    expect(ownAttempt.status).toBe(404);
    const foreignAttempt = await otherRequest({ action: "assistant", id: own.id, expectedVersion: own.version, requestId: crypto.randomUUID(), text: "Change the title.", locale: "en" });
    expect(foreignAttempt.status).toBe(404);
    const foreignRead = await otherRequest(undefined, foreign.id);
    expect(foreignRead.status).toBe(200);
    expect((await foreignRead.json()).messages).toHaveLength(0);
  });

  it("marks a delayed assistant response stale after an authenticated manual save", async () => {
    let detail = await createDraft();
    const baseline = complete(detail.draft.reference);
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: baseline })).json();
    let startedResolve!: () => void;
    let releaseResolve!: () => void;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    const gate = new Promise<void>((resolve) => { releaseResolve = resolve; });
    const delayed = scriptedModel([
      fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Assistant title" }, evidence: [{ fields: ["title"], source: "current", text: "Assistant title" }] })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Assistant correction."),
    ], async () => {
      startedResolve();
      await gate;
    });
    const assistant = request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Assistant title", locale: "en" }, undefined, delayed.handler);
    await started;
    const manual = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: { ...detail.draft, title: "Manual title" } });
    expect(manual.status).toBe(200);
    releaseResolve();

    const stale = await assistant;
    expect(stale.status).toBe(409);
    const reopened = await (await request(undefined, detail.id)).json();
    expect(reopened).toMatchObject({ draft: { title: "Manual title" }, pending: false });
    expect(reopened.messages.at(-1)).toMatchObject({ role: "note", en: "Response was stale; the Working Draft changed." });
  });

  it("keeps a Published reference immutable through the assistant", async () => {
    let detail = await createDraft();
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: complete(detail.draft.reference) })).json();
    detail = await (await request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() })).json();
    detail = await (await request({ action: "new-draft", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() })).json();
    const model = scriptedModel([
      fauxAssistantMessage([fauxToolCall("edit_quote_details", {
        fields: { reference: "Q-CHANGED" }, evidence: [{ fields: ["reference"], source: "current", text: "Q-CHANGED" }],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("La référence reste inchangée après publication."),
    ]);
    const response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Référence Q-CHANGED", locale: "fr" }, undefined, model.handler);
    expect(response.status).toBe(200);
    expect((await response.json()).draft.reference).toBe(detail.draft.reference);
  });

  it("persists structural edits, recalculates order, and undoes the complete turn", async () => {
    let detail = await createDraft();
    const baseline = {
      ...complete(detail.draft.reference),
      sections: [{ id: "living", title: "Séjour" }, { id: "bedroom", title: "Chambre" }],
      lines: [
        { id: "one", sectionId: "living", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "100.00" },
        { id: "two", sectionId: "bedroom", description: "Finition", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "50.00" },
      ],
    };
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: baseline })).json();
    const model = scriptedModel([
      fauxAssistantMessage([
        fauxToolCall("move_quote_work", { move: { sectionIds: ["bedroom"], beforeSectionId: "living" } }),
        fauxToolCall("move_quote_work", { move: { lineIds: ["one"], destinationSectionId: "bedroom", beforeLineId: "two" } }),
        fauxToolCall("delete_quote_lines", { lineIds: ["one"] }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("La ligne ciblée a été supprimée après réorganisation."),
    ]);
    const response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Déplace la pose dans Chambre puis supprime-la.", locale: "fr" }, undefined, model.handler);
    expect(response.status).toBe(200);
    detail = await response.json();
    expect(detail.draft.sections.map((section: { id: string }) => section.id)).toEqual(["bedroom", "living"]);
    expect(detail.draft.lines).toEqual([expect.objectContaining({ id: "two", sectionId: "bedroom" })]);
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 5_000, total: 5_405 });
    expect(detail.canUndo).toBe(true);

    const undone = await request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(undone.status).toBe(200);
    expect((await undone.json()).draft).toMatchObject({ sections: baseline.sections, lines: baseline.lines });
  });

  it("rejects all-work deletion as a whole-turn manual fallback", async () => {
    let detail = await createDraft();
    const baseline = {
      ...complete(detail.draft.reference),
      title: "Original title",
      lines: [
        { id: "one", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "100.00" },
        { id: "two", sectionId: "", description: "Finition", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "50.00" },
      ],
    };
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: baseline })).json();
    const model = scriptedModel([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_details", { fields: { title: "Must not persist" }, evidence: [{ fields: ["title"], source: "current", text: "Must not persist" }] }),
        fauxToolCall("delete_quote_lines", { lineIds: ["one", "two"] }),
      ], { stopReason: "toolUse" }),
    ]);
    const response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Supprime tout le travail.", locale: "fr" }, undefined, model.handler);
    expect(response.status).toBe(502);
    const reopened = await (await request(undefined, detail.id)).json();
    expect(reopened.draft).toMatchObject({ title: "Original title", lines: baseline.lines });
    expect(reopened.pending).toBe(false);
  });

  it("commits partial success below three failures and discards at the third failure", async () => {
    let detail = await createDraft();
    const partial = scriptedModel([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_lines", { lines: [{ description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "10.00" }], evidence: [{ fields: ["/lines/0/mode", "/lines/0/description", "/lines/0/amount"], source: "current", text: "Pose pour 10 CHF" }] }),
        fauxToolCall("edit_quote_details", { fields: { title: "Titre sans source" } }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("La pose a été ajoutée."),
    ]);
    let response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Pose pour 10 CHF", locale: "fr" }, undefined, partial.handler);
    expect(response.status).toBe(200);
    detail = await response.json();
    expect(detail.draft.lines).toHaveLength(1);

    const exhausted = scriptedModel([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_details", { fields: { title: "Encore" }, evidence: [{ fields: ["title"], source: "current", text: "Encore" }] }),
        fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {}),
      ], { stopReason: "toolUse" }),
    ]);
    response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Encore", locale: "fr" }, undefined, exhausted.handler);
    expect(response.status).toBe(502);
    const reloaded = await (await request(undefined, detail.id)).json();
    expect(reloaded.draft.title).toBe("");
  });
});
