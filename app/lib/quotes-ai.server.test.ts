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

  function scriptedModel(responses: FauxResponseStep[]) {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses(responses);
    return {
      handler: createQuoteHandler({
        database: connection.db, auth,
        modelBoundary: { model: faux.getModel(), streamFn: models.streamSimple.bind(models), timeoutMs: 1_000 },
      }),
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
