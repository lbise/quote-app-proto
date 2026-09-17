import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";

import { createAuthForDatabase } from "./auth.server";
import { connectDatabase } from "./db.server";
import { user } from "./db/schema";
import { calculateQuote, emptyQuote, type QuoteData } from "./quote";
import { createQuoteHandler } from "./quotes.server";

// These tests exercise the pi agent and Easy Quote tools. The faux provider
// replaces only inference, not tool execution or the HTTP persistence path.
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
        database: connection.db,
        auth,
        modelBoundary: { model: faux.getModel(), streamFn: models.streamSimple.bind(models), timeoutMs: 1_000 },
      }),
      faux,
    };
  }

  function toolTurn(...calls: ReturnType<typeof fauxToolCall>[]) {
    return fauxAssistantMessage(calls, { stopReason: "toolUse" });
  }

  async function createDraft() {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    expect(created.status).toBe(200);
    return created.json();
  }


  it.each([
    ["fr", "Pose de 2 étagères", "Pose de deux étagères", "Dites-moi le prix unitaire.", "75 francs pièce", "Le prix unitaire a été ajouté."],
    ["en", "Install 2 shelves", "Pose de deux étagères", "What is the unit price?", "75 francs per shelf", "The unit price has been added."],
  ] as const)("captures initial work in %s and reopens the clarification conversation", async (locale, text, description, initialReply, priceText, clarificationReply) => {
    let detail = await createDraft();
    const initial = scriptedModel([
      toolTurn(fauxToolCall("add_quote_line", { description, mode: "quantity", quantity: "2", unit: "pièce", unitPrice: "", amount: "", evidence: [{ field: "quantity", text: "2" }] })),
      fauxAssistantMessage(initialReply),
    ]);
    const captured = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text, locale }, undefined, initial.handler);
    expect(captured.status).toBe(200);
    detail = await captured.json();
    expect(detail.draft.lines).toEqual([expect.objectContaining({ description, quantity: "2", unit: "pièce", unitPrice: "", amount: "" })]);
    const lineId = detail.draft.lines[0].id;

    const clarification = scriptedModel([
      toolTurn(fauxToolCall("supply_missing_line_fields", { lineId, fields: { unitPrice: "75.00" }, evidence: [{ field: "unitPrice", text: "75" }] })),
      fauxAssistantMessage(clarificationReply),
    ]);
    const supplied = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: priceText, locale }, undefined, clarification.handler);
    expect(supplied.status).toBe(200);
    detail = await supplied.json();
    expect(detail.draft.lines[0]).toMatchObject({ id: lineId, quantity: "2", unitPrice: "75.00" });
    const reloaded = await request(undefined, detail.id);
    const reopened = await reloaded.json();
    expect(reopened.draft).toMatchObject({
      customerName: "", customerAddress: "", customerContact: "",
      businessName: "", businessAddress: "", businessContact: "", vatId: "",
    });
    expect(reopened.draft.lines[0]).toMatchObject({ id: lineId, unitPrice: "75.00" });
    expect(calculateQuote({ ...reopened.draft, vatRegistered: false })).toMatchObject({ subtotal: 15_000, total: 15_000 });
    expect(reopened.messages).toEqual([
      expect.objectContaining({ role: "artisan", fr: text, en: text }),
      expect.objectContaining({ role: "assistant", fr: initialReply, en: initialReply }),
      expect.objectContaining({ role: "artisan", fr: priceText, en: priceText }),
      expect.objectContaining({ role: "assistant", fr: clarificationReply, en: clarificationReply }),
    ]);
  });

  it("keeps unknown commercial values missing", async () => {
    const detail = await createDraft();
    const model = scriptedModel([
      toolTurn(fauxToolCall("add_quote_line", { description: "Réparation de portail", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "", evidence: [] })),
      fauxAssistantMessage("Il me faut les mesures et le prix."),
    ]);
    const response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Réparer le portail, les mesures sont inconnues", locale: "fr" }, undefined, model.handler);
    const accepted = await response.json();
    expect(accepted.draft.lines[0]).toMatchObject({ description: "Réparation de portail", quantity: "", unit: "", unitPrice: "", amount: "" });
  });

  it("does not let a browser save grant follow-up eligibility to an existing line", async () => {
    let detail = await createDraft();
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: complete(detail.draft.reference) });
    detail = await saved.json();
    const model = scriptedModel([
      toolTurn(fauxToolCall("supply_missing_line_fields", { lineId: "line-1", fields: { amount: "200.00" }, evidence: [{ field: "amount", text: "200" }] })),
      fauxAssistantMessage("Je ne peux modifier que le travail capturé dans cette conversation."),
    ]);
    const attempted = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Passe le forfait à 200", locale: "fr" }, undefined, model.handler);
    expect(attempted.status).toBe(502);
    const reloaded = await request(undefined, detail.id);
    expect((await reloaded.json()).draft.lines[0].amount).toBe("100.00");
  });

  it("undoes a multi-tool capture as one action", async () => {
    let detail = await createDraft();
    const model = scriptedModel([
      toolTurn(
        fauxToolCall("add_quote_line", { description: "Dépose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00", evidence: [{ field: "amount", text: "50" }] }),
        fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00", evidence: [{ field: "amount", text: "80" }] }),
      ),
      fauxAssistantMessage("Les deux lignes ont été ajoutées."),
    ]);
    const captured = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Ajoute la dépose à 50 et la pose à 80", locale: "fr" }, undefined, model.handler);
    detail = await captured.json();
    expect(detail.draft.lines).toHaveLength(2);
    const undone = await request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect((await undone.json()).draft.lines).toEqual([]);
  });

  it("corrects existing lines, undoes the compound turn, and copies a section with unknown measurements", async () => {
    let detail = await createDraft();
    const baseline = {
      ...complete(detail.draft.reference),
      vatRegistered: false,
      vatId: "",
      sections: [{ id: "living", title: "Séjour" }, { id: "bedroom", title: "Chambre" }],
      lines: [
        { id: "living-wall", sectionId: "living", description: "Habillage mural en chêne", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "bedroom-wall", sectionId: "bedroom", description: "Habillage mural en chêne", mode: "quantity", quantity: "8", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "bedroom-tablet", sectionId: "bedroom", description: "Pose de la tablette", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "150.00" },
      ],
    };
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: baseline })).json();
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 95_000, total: 95_000, complete: true });

    const correction = scriptedModel([
      toolTurn(
        fauxToolCall("update_quote_line", { lineId: "living-wall", fields: { unitPrice: "45.00" }, evidence: [{ field: "unitPrice", text: "45" }] }),
        fauxToolCall("update_quote_line", { lineId: "bedroom-wall", fields: { unitPrice: "45.00" }, evidence: [{ field: "unitPrice", text: "45" }] }),
      ),
      fauxAssistantMessage("Prix unitaires corrigés pour les deux habillages; quantités conservées."),
    ]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Passe les deux prix unitaires à 45 CHF par m².", locale: "fr" }, undefined, correction.handler)).json();
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 105_000, total: 105_000, complete: true });
    expect(detail.messages.at(-1)).toMatchObject({ changed: ["living-wall", "bedroom-wall"] });

    detail = await (await request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() })).json();
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 95_000, total: 95_000, complete: true });
    expect(detail.messages.at(-1).en).toContain("Earlier messages describe the previous state");

    const copy = scriptedModel([
      toolTurn(fauxToolCall("duplicate_quote_section", { sectionId: "bedroom", measurementPolicy: "unknown" })),
      fauxAssistantMessage("Chambre copiée; unité et prix conservés, quantité inconnue laissée vide."),
    ]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Copie Chambre au Bureau, je ne connais pas la surface.", locale: "fr" }, undefined, copy.handler)).json();
    expect(detail.draft.sections).toHaveLength(3);
    expect(detail.draft.lines).toHaveLength(5);
    expect(detail.draft.lines[3]).toMatchObject({ quantity: "", unit: "m²", unitPrice: "40.00", amount: "" });
    expect(detail.draft.lines[4]).toMatchObject({ amount: "150.00" });
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 110_000, total: null, complete: false });
  });

  it("clarifies an ambiguous target without mutation, then resolves against the current draft", async () => {
    let detail = await createDraft();
    const baseline = {
      ...complete(detail.draft.reference),
      vatRegistered: false,
      vatId: "",
      sections: [{ id: "living", title: "Séjour" }, { id: "bedroom", title: "Chambre" }],
      lines: [
        { id: "living-wall", sectionId: "living", description: "Habillage mural", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "bedroom-wall", sectionId: "bedroom", description: "Habillage mural", mode: "quantity" as const, quantity: "8", unit: "m²", unitPrice: "40.00", amount: "" },
      ],
    };
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: baseline })).json();
    const beforeDraft = structuredClone(detail.draft);
    const beforeVersion = detail.version;
    const ambiguous = scriptedModel([fauxAssistantMessage("Voulez-vous modifier la ligne 1, la ligne 2 ou les deux ? Aucune modification appliquée.")]);
    const clarified = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Passe l'habillage à 45", locale: "fr" }, undefined, ambiguous.handler);
    expect(clarified.status).toBe(200);
    detail = await clarified.json();
    expect(detail.draft).toEqual(beforeDraft);
    expect(detail.version).toBe(beforeVersion);
    expect(detail.canUndo).toBe(true);

    const manuallyEdited = { ...detail.draft, title: "Titre manuel actuel" };
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: manuallyEdited })).json();
    const resolved = scriptedModel([
      toolTurn(
        fauxToolCall("update_quote_line", { lineId: "living-wall", fields: { unitPrice: "45.00" }, evidence: [{ field: "unitPrice", text: "45" }] }),
        fauxToolCall("update_quote_line", { lineId: "bedroom-wall", fields: { unitPrice: "45.00" }, evidence: [{ field: "unitPrice", text: "45" }] }),
      ),
      fauxAssistantMessage("Prix des deux lignes passés à 45 CHF par m²."),
    ]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Les deux prix unitaires à 45", locale: "fr" }, undefined, resolved.handler)).json();
    expect(detail.draft.title).toBe("Titre manuel actuel");
    expect(detail.draft.lines).toEqual([
      expect.objectContaining({ id: "living-wall", unitPrice: "45.00" }),
      expect.objectContaining({ id: "bedroom-wall", unitPrice: "45.00" }),
    ]);
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 90_000, total: 90_000, complete: true });
  });

  it("exercises section creation, renaming, moving, line copying and section copying through HTTP", async () => {
    let detail = await createDraft();
    const baseline = {
      ...complete(detail.draft.reference),
      vatRegistered: false,
      vatId: "",
      sections: [{ id: "living", title: "Séjour" }, { id: "bedroom", title: "Chambre" }, { id: "office", title: "Bureau" }],
      lines: [
        { id: "living-wall", sectionId: "living", description: "Habillage mural", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "bedroom-wall", sectionId: "bedroom", description: "Habillage mural 8 m²", mode: "quantity" as const, quantity: "8", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "bedroom-tablet", sectionId: "bedroom", description: "Pose de la tablette", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "150.00" },
      ],
    };
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: baseline })).json();

    const created = scriptedModel([toolTurn(fauxToolCall("create_quote_section", { title: "Entrée" })), fauxAssistantMessage("Section Entrée créée.")]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Crée une section Entrée", locale: "fr" }, undefined, created.handler)).json();
    const entrance = detail.draft.sections.find((section: { title: string }) => section.title === "Entrée");
    expect(entrance).toBeTruthy();

    const renamed = scriptedModel([toolTurn(fauxToolCall("rename_quote_section", { sectionId: "office", title: "Atelier" })), fauxAssistantMessage("Bureau renommé Atelier.")]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Renomme Bureau en Atelier", locale: "fr" }, undefined, renamed.handler)).json();
    expect(detail.draft.sections).toContainEqual({ id: "office", title: "Atelier" });

    const moved = scriptedModel([toolTurn(fauxToolCall("move_quote_line", { lineId: "living-wall", sectionId: "office" })), fauxAssistantMessage("Ligne déplacée dans Atelier.")]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Déplace la ligne vers Atelier", locale: "fr" }, undefined, moved.handler)).json();
    expect(detail.draft.lines.at(-1)).toMatchObject({ id: "living-wall", sectionId: "office" });

    const copiedLine = scriptedModel([toolTurn(fauxToolCall("duplicate_quote_line", { lineId: "bedroom-wall", sectionId: "office", measurementPolicy: "unknown" })), fauxAssistantMessage("Ligne copiée; prix conservé et quantité inconnue laissée vide.")]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Copie cette ligne dans Atelier, surface inconnue", locale: "fr" }, undefined, copiedLine.handler)).json();
    const lineCopy = detail.draft.lines.find((line: { id: string; sectionId: string; quantity: string }) => line.id !== "bedroom-wall" && line.sectionId === "office" && line.quantity === "");
    expect(lineCopy).toMatchObject({ unit: "m²", unitPrice: "40.00" });
    expect(lineCopy.description).not.toContain("8 m²");
    expect(detail.messages.at(-1).fr).toContain("quantité inconnue");

    const copiedSection = scriptedModel([toolTurn(fauxToolCall("duplicate_quote_section", { sectionId: "bedroom", measurementPolicy: "unknown" })), fauxAssistantMessage("Chambre copiée; prix et forfait conservés, quantité inconnue laissée vide.")]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Copie Chambre, surface inconnue", locale: "fr" }, undefined, copiedSection.handler)).json();
    const copiedSectionIndex = detail.draft.sections.findIndex((section: { title: string }) => section.title === "Chambre copie");
    expect(copiedSectionIndex).toBeGreaterThanOrEqual(0);
    const copiedSectionId = detail.draft.sections[copiedSectionIndex].id;
    const copiedWall = detail.draft.lines.find((line: { sectionId: string; description: string }) => line.sectionId === copiedSectionId && line.description.includes("Habillage"));
    expect(copiedWall).toMatchObject({ quantity: "", unit: "m²", unitPrice: "40.00" });
    expect(copiedWall.description).not.toContain("8 m²");
    expect(detail.messages.at(-1).fr).toContain("prix");
    expect(calculateQuote(detail.draft)).toMatchObject({ subtotal: 110_000, total: null, complete: false });
  });

  it("keeps staged tool changes out of PostgreSQL when a later tool call fails", async () => {
    const detail = await createDraft();
    const model = scriptedModel([
      toolTurn(
        fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00", evidence: [{ field: "amount", text: "50" }] }),
        fauxToolCall("supply_missing_line_fields", { lineId: "not-captured", fields: { amount: "80.00" }, evidence: [{ field: "amount", text: "80" }] }),
      ),
      fauxAssistantMessage("Je dois clarifier la seconde ligne."),
    ]);
    const response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Ajoute deux lignes à 50 et 80", locale: "fr" }, undefined, model.handler);
    expect(response.status).toBe(502);
    const reloaded = await request(undefined, detail.id);
    expect((await reloaded.json()).draft.lines).toEqual([]);
  });

  it("leaves the Working Draft unchanged when the pi round limit is exhausted", async () => {
    const detail = await createDraft();
    const model = scriptedModel([
      toolTurn(fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00", evidence: [{ field: "amount", text: "50" }] })),
      ...Array.from({ length: 5 }, () => toolTurn(fauxToolCall("read_work", {}))),
      fauxAssistantMessage("This reply must not be accepted."),
    ]);
    const response = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Add pose at 50", locale: "en" }, undefined, model.handler);
    expect(response.status).toBe(502);
    const reloaded = await request(undefined, detail.id);
    expect(await reloaded.json()).toMatchObject({ draft: { lines: [] }, pending: false, assistantRequest: { status: "failed" } });
  });

  it("reaps an expired pi lease without changing the Working Draft", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    let releaseModel: ((message: ReturnType<typeof fauxAssistantMessage>) => void) | undefined;
    let modelStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    const faux = fauxProvider();
    faux.setResponses([() => new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
      releaseModel = resolve;
      modelStarted?.();
    })]);
    const models = createModels();
    models.setProvider(faux.provider);
    const clocked = createQuoteHandler({
      database: connection.db, auth, now: () => now,
      modelBoundary: { model: faux.getModel(), streamFn: models.streamSimple.bind(models), timeoutMs: 1_000 },
    });
    const call = (body?: Record<string, unknown>, id?: string) => request(body, id, clocked);
    let detail = await (await call({ action: "create", requestId: crypto.randomUUID() })).json();
    detail = await (await call({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: complete(detail.draft.reference) })).json();
    const pending = call({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: "expired-pi", text: "Question", locale: "fr" });
    await started;
    now = new Date("2026-01-01T00:02:00.000Z");
    const reloaded = await call(undefined, detail.id);
    expect(await reloaded.json()).toMatchObject({ pending: false, draft: { title: "Bibliothèque sur mesure" }, assistantRequest: { requestId: "expired-pi", text: "Question", status: "failed", baseVersion: detail.version } });
    releaseModel!(fauxAssistantMessage("Trop tard."));
    expect((await pending).status).toBe(409);
  });

  it("rejects a stale result, then permits a retry against the manual Working Draft", async () => {
    let releaseModel: ((message: ReturnType<typeof fauxAssistantMessage>) => void) | undefined;
    let modelStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    const delayed = scriptedModel([
      () => new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
        releaseModel = resolve;
        modelStarted?.();
      }),
      fauxAssistantMessage("The stale reply must not be accepted."),
    ]);
    let detail = await createDraft();
    const pending = request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: "stale-request", text: "Add pose at 50", locale: "en" }, undefined, delayed.handler);
    await started;
    const manual = { ...detail.draft, title: "Titre manuel prioritaire" };
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: manual });
    expect(saved.status).toBe(200);
    detail = await saved.json();
    releaseModel!(toolTurn(fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00", evidence: [{ field: "amount", text: "50" }] })));
    expect((await pending).status).toBe(409);

    const retry = scriptedModel([
      toolTurn(fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00", evidence: [{ field: "amount", text: "50" }] })),
      fauxAssistantMessage("Added the supplied work."),
    ]);
    const accepted = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: "stale-retry", text: "Add pose at 50", locale: "en" }, undefined, retry.handler);
    expect(await accepted.json()).toMatchObject({ draft: { title: "Titre manuel prioritaire", lines: [expect.objectContaining({ description: "Pose", amount: "50.00" })] } });
  });

  it("revokes only manually edited captured lines", async () => {
    let detail = await createDraft();
    const capture = scriptedModel([
      toolTurn(
        fauxToolCall("add_quote_line", { description: "Première pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "", evidence: [] }),
        fauxToolCall("add_quote_line", { description: "Seconde pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "", evidence: [] }),
      ),
      fauxAssistantMessage("Deux lignes ont été ajoutées."),
    ]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Ajoute les deux poses, prix inconnus", locale: "fr" }, undefined, capture.handler)).json();
    const [first, second] = detail.draft.lines;
    const manual = { ...detail.draft, lines: [{ ...first, description: "Première pose corrigée" }, second] };
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: manual })).json();
    const eligible = scriptedModel([
      toolTurn(fauxToolCall("supply_missing_line_fields", { lineId: second.id, fields: { amount: "20.00" }, evidence: [{ field: "amount", text: "20" }] })),
      fauxAssistantMessage("Le second prix a été ajouté."),
    ]);
    const accepted = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "La seconde pose coûte 20", locale: "fr" }, undefined, eligible.handler);
    expect((await accepted.json()).draft.lines).toEqual([
      expect.objectContaining({ id: first.id, description: "Première pose corrigée", amount: "" }),
      expect.objectContaining({ id: second.id, amount: "20.00" }),
    ]);
  });

  it("restores capture eligibility with undo", async () => {
    let detail = await createDraft();
    const capture = scriptedModel([
      toolTurn(fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "", evidence: [] })),
      fauxAssistantMessage("La ligne a été ajoutée."),
    ]);
    detail = await (await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Ajoute une pose, prix inconnu", locale: "fr" }, undefined, capture.handler)).json();
    const line = detail.draft.lines[0];
    detail = await (await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: { ...detail.draft, lines: [{ ...line, description: "Pose modifiée manuellement" }] } })).json();
    detail = await (await request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() })).json();
    const supply = scriptedModel([
      toolTurn(fauxToolCall("supply_missing_line_fields", { lineId: line.id, fields: { amount: "10.00" }, evidence: [{ field: "amount", text: "10" }] })),
      fauxAssistantMessage("Le prix a été ajouté."),
    ]);
    const accepted = await request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "La pose coûte 10", locale: "fr" }, undefined, supply.handler);
    expect((await accepted.json()).draft.lines[0]).toMatchObject({ id: line.id, description: "Pose", amount: "10.00" });
  });

  it("retries a failed staged turn with the same request ID without duplicate work or messages", async () => {
    const detail = await createDraft();
    const requestId = "failed-turn-retry";
    const body = { action: "assistant", id: detail.id, expectedVersion: detail.version, requestId, text: "Add pose at 50", locale: "en" };
    const failed = scriptedModel([
      toolTurn(fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00", evidence: [{ field: "amount", text: "50" }] })),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "model unavailable" }),
    ]);
    expect((await request(body, undefined, failed.handler)).status).toBe(502);

    const retry = scriptedModel([
      toolTurn(fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00", evidence: [{ field: "amount", text: "50" }] })),
      fauxAssistantMessage("Added the supplied work."),
    ]);
    const accepted = await request(body, undefined, retry.handler);
    expect(accepted.status).toBe(200);
    const reloaded = await request(undefined, detail.id);
    const reopened = await reloaded.json();
    expect(reopened.draft.lines).toEqual([expect.objectContaining({ description: "Pose", amount: "50.00" })]);
    expect(reopened.messages.filter((message: { role: string }) => message.role === "artisan")).toHaveLength(1);
  });

  it("binds accepted multi-tool requests to their payload and request key", async () => {
    const detail = await createDraft();
    const requestId = crypto.randomUUID();
    const model = scriptedModel([
      toolTurn(
        fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00", evidence: [{ field: "amount", text: "50" }] }),
        fauxToolCall("add_quote_line", { description: "Finition", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "20.00", evidence: [{ field: "amount", text: "20" }] }),
      ),
      fauxAssistantMessage("Ajouté."),
    ]);
    const body = { action: "assistant", id: detail.id, expectedVersion: detail.version, requestId, text: "Ajoute la pose à 50 et la finition à 20", locale: "fr" };
    const accepted = await request(body, undefined, model.handler);
    expect(accepted.status).toBe(200);
    const retry = await request(body, undefined, model.handler);
    expect((await retry.json()).draft.lines).toHaveLength(2);
    const reused = await request({ ...body, text: "Autre demande" }, undefined, model.handler);
    expect(reused.status).toBe(409);
  });

});
