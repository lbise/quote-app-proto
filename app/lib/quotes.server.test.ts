import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createAuthForDatabase } from "./auth.server";
import { connectDatabase } from "./db.server";
import { user } from "./db/schema";
import { emptyQuote, type QuoteData } from "./quote";
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
    expect(signedUp.status).toBe(200);
    const account = await signedUp.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, account.user.id));
    const signedIn = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    }));
    expect(signedIn.status).toBe(200);
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

  function request(body?: Record<string, unknown>, id?: string) {
    return handler(new Request(`${origin}/api/quotes${id ? `?id=${id}` : ""}`, {
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

  it("creates, saves an incomplete Working Draft, publishes immutable revisions, and reopens a later draft", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    expect(created.status).toBe(200);
    let detail = await created.json();
    expect(detail.draft.reference).toMatch(/^Q-\d+$/);

    const incomplete = { ...detail.draft, title: "Bibliothèque", lines: [{ id: "unknown", sectionId: "", description: "Prix à confirmer", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "" }] };
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: incomplete });
    expect(saved.status).toBe(200);
    detail = await saved.json();
    expect(detail.draft.lines[0].amount).toBe("");

    const blocked = await request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(blocked.status).toBe(422);

    const ready = complete(detail.draft.reference);
    const settled = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: ready });
    detail = await settled.json();
    const publishRequestId = crypto.randomUUID();
    const published = await request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: publishRequestId });
    expect(published.status).toBe(200);
    detail = await published.json();
    expect(detail).toMatchObject({ draft: null, revisions: [{ number: 1, quote: { reference: ready.reference } }] });
    const retriedPublication = await request({ action: "publish", id: detail.id, expectedVersion: detail.version - 1, requestId: publishRequestId });
    expect(await retriedPublication.json()).toMatchObject({ draft: null, revisions: [{ number: 1 }] });

    const newDraftRequestId = crypto.randomUUID();
    const draft = await request({ action: "new-draft", id: detail.id, expectedVersion: detail.version, requestId: newDraftRequestId });
    detail = await draft.json();
    const retriedDraft = await request({ action: "new-draft", id: detail.id, expectedVersion: detail.version - 1, requestId: newDraftRequestId });
    expect(await retriedDraft.json()).toMatchObject({ draft: { reference: ready.reference }, revisions: [{ number: 1 }] });
    const revisionTwo = { ...detail.draft, lines: [{ ...detail.draft.lines[0], amount: "200.00" }] };
    const changed = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: revisionTwo });
    detail = await changed.json();
    const publishedAgain = await request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(await publishedAgain.json()).toMatchObject({ revisions: [{ number: 1, calculation: { total: 10810 } }, { number: 2, calculation: { total: 21620 } }] });
  });

  it("rejects a stale AI result without overwriting a manual Working Draft save", async () => {
    let resolveProvider: ((value: { quote: QuoteData; message: string; changed: string[]; reviewPublication: boolean }) => void) | undefined;
    let started: (() => void) | undefined;
    const provider = (input: { quote: QuoteData }) => new Promise<{ quote: QuoteData; message: string; changed: string[]; reviewPublication: boolean }>((resolve) => {
      resolveProvider = resolve;
      started?.();
    });
    const fakeHandler = createQuoteHandler({ database: connection.db, auth, provider });
    const call = (body: Record<string, unknown>, id?: string) => fakeHandler(new Request(`${origin}/api/quotes${id ? `?id=${id}` : ""}`, {
      method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const created = await call({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const current = complete(detail.draft.reference);
    const saved = await call({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: current });
    detail = await saved.json();

    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const pending = call({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: "delayed-ai", text: "Renommer le projet", locale: "fr" });
    await providerStarted;
    const manual = { ...current, title: "Titre manuel prioritaire" };
    const manuallySaved = await call({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: manual });
    expect(manuallySaved.status).toBe(200);
    resolveProvider!({ quote: { ...current, title: "Titre IA obsolète" }, message: "Modification proposée.", changed: ["title"], reviewPublication: false });
    expect((await pending).status).toBe(409);

    const reloaded = await handler(new Request(`${origin}/api/quotes?id=${detail.id}`, { headers: { cookie } }));
    expect(await reloaded.json()).toMatchObject({ draft: { title: "Titre manuel prioritaire" }, pending: false, assistantRequest: { requestId: "delayed-ai", text: "Renommer le projet", status: "stale", baseVersion: detail.version } });
  });

  it("serializes duplicate create keys and rejects a reused key with a different payload", async () => {
    const requestId = crypto.randomUUID();
    const [one, two] = await Promise.all([
      request({ action: "create", requestId }),
      request({ action: "create", requestId }),
    ]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect((await one.json()).id).toBe((await two.json()).id);
    const reused = await request({ action: "create", requestId, quote: { unexpected: true } });
    expect(reused.status).toBe(409);
  });

  it("returns an accepted AI operation on an idempotent retry", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const ready = complete(detail.draft.reference);
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: ready });
    detail = await saved.json();
    const requestId = crypto.randomUUID();
    const provider = async (input: { quote: QuoteData }) => ({ quote: { ...input.quote, title: "Titre assistant" }, message: "Mis à jour.", changed: ["title"], reviewPublication: false });
    const fakeHandler = createQuoteHandler({ database: connection.db, auth, provider });
    const call = (body: Record<string, unknown>) => fakeHandler(new Request(`${origin}/api/quotes`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
    const accepted = await call({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId, text: "Renomme", locale: "fr" });
    expect(accepted.status).toBe(200);
    const retry = await call({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId, text: "Renomme", locale: "fr" });
    expect(await retry.json()).toMatchObject({ draft: { title: "Titre assistant" } });
    const reused = await call({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId, text: "Autre instruction", locale: "fr" });
    expect(reused.status).toBe(409);
  });

  it("serializes concurrent Publication and later Working Draft retries", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: complete(detail.draft.reference) });
    detail = await saved.json();
    const publishKey = crypto.randomUUID();
    const [firstPublication, secondPublication] = await Promise.all([
      request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: publishKey }),
      request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: publishKey }),
    ]);
    expect(firstPublication.status).toBe(200);
    expect(secondPublication.status).toBe(200);
    detail = await firstPublication.json();
    expect(detail.revisions).toHaveLength(1);
    const draftKey = crypto.randomUUID();
    const [firstDraft, secondDraft] = await Promise.all([
      request({ action: "new-draft", id: detail.id, expectedVersion: detail.version, requestId: draftKey }),
      request({ action: "new-draft", id: detail.id, expectedVersion: detail.version, requestId: draftKey }),
    ]);
    expect(firstDraft.status).toBe(200);
    expect(secondDraft.status).toBe(200);
    expect((await firstDraft.json())).toMatchObject({ draft: { reference: detail.revisions[0].quote.reference }, revisions: [{ number: 1 }] });
  });

  it("undoes a pre-Publication reference change in both draft and list", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const original = detail.draft.reference;
    const first = complete(original);
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: first });
    detail = await saved.json();
    const renamed = { ...first, reference: "CUSTOM-UNDO-REFERENCE" };
    const changed = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: renamed });
    detail = await changed.json();
    const undone = await request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(await undone.json()).toMatchObject({ draft: { reference: original } });
    const listed = await request();
    expect((await listed.json()).quotes).toContainEqual(expect.objectContaining({ id: detail.id, reference: original }));
  });

  it("copies only business defaults into a new Working Draft", async () => {
    const defaults = await request({ action: "defaults-save", defaults: { businessName: "Atelier par défaut", businessAddress: "Rue Exemple 1", businessContact: "contact@example.test", vatRegistered: true, vatId: "CHE-000.000.000 TVA", terms: "Paiement à 30 jours", title: "Ne pas copier", customerName: "Ne pas copier", lines: [{ id: "no", amount: "1" }] } });
    expect(defaults.status).toBe(200);
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    const detail = await created.json();
    expect(detail).toMatchObject({ draft: { businessName: "Atelier par défaut", terms: "Paiement à 30 jours", title: "", customerName: "", lines: [] } });
    await request({ action: "defaults-save", defaults: { businessName: "Nouveau défaut", terms: "Nouvelles conditions" } });
    const reloaded = await request(undefined, detail.id);
    expect(await reloaded.json()).toMatchObject({ draft: { businessName: "Atelier par défaut", terms: "Paiement à 30 jours" } });
  });

  it("reaps an expired AI lease through the authenticated detail boundary", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    let resolveProvider: ((value: { quote: null; message: string; changed: string[]; reviewPublication: boolean }) => void) | undefined;
    let started: (() => void) | undefined;
    const provider = () => new Promise<{ quote: null; message: string; changed: string[]; reviewPublication: boolean }>((resolve) => { resolveProvider = resolve; started?.(); });
    const clocked = createQuoteHandler({ database: connection.db, auth, provider, now: () => now });
    const call = (body?: Record<string, unknown>, id?: string) => clocked(new Request(`${origin}/api/quotes${id ? `?id=${id}` : ""}`, { method: body ? "POST" : "GET", headers: { cookie, ...(body ? { origin, "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    const created = await call({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const saved = await call({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: complete(detail.draft.reference) });
    detail = await saved.json();
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const pending = call({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Question", locale: "fr" });
    await providerStarted;
    now = new Date("2026-01-01T00:02:00.000Z");
    const reloaded = await call(undefined, detail.id);
    expect(await reloaded.json()).toMatchObject({ pending: false, draft: { title: "Bibliothèque sur mesure" }, assistantRequest: { text: "Question", status: "failed", baseVersion: detail.version } });
    resolveProvider!({ quote: null, message: "Trop tard", changed: [], reviewPublication: false });
    expect((await pending).status).toBe(409);
  });

  it("retains retry metadata after an AI provider failure without changing the Working Draft", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: complete(detail.draft.reference) });
    detail = await saved.json();
    const failing = createQuoteHandler({ database: connection.db, auth, provider: async () => { throw new Error("unavailable"); } });
    const response = await failing(new Request(`${origin}/api/quotes`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: "failed-assistant", text: "Réessayer plus tard", locale: "fr" }) }));
    expect(response.status).toBe(502);
    const reloaded = await request(undefined, detail.id);
    expect(await reloaded.json()).toMatchObject({ draft: { title: "Bibliothèque sur mesure" }, pending: false, assistantRequest: { requestId: "failed-assistant", text: "Réessayer plus tard", status: "failed", baseVersion: detail.version } });
  });

  it("accepts valid ungrouped decimal lines alongside sections", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const draft = { ...complete(detail.draft.reference), sections: [{ id: "area", title: "Zone" }], lines: [
      { id: "grouped", sectionId: "area", description: "Pose", mode: "quantity", quantity: " 01,250 ", unit: "h", unitPrice: " 080.20 ", amount: "" },
      { id: "ungrouped", sectionId: "", description: "Forfait", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: " 000.50 " },
    ] };
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: draft });
    detail = await saved.json();
    const published = await request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(await published.json()).toMatchObject({ revisions: [{ calculation: { lines: [{ id: "ungrouped", amount: 50 }, { id: "grouped", amount: 10025 }], total: 10891 } }] });
  });

  it("undoes thirty fake-provider line changes as one Working Draft action", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const original = { ...complete(detail.draft.reference), lines: Array.from({ length: 30 }, (_, index) => ({ id: `line-${index + 1}`, sectionId: "", description: `Ligne ${index + 1}`, mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "1.00" })) };
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: original });
    detail = await saved.json();
    const provider = async (input: { quote: QuoteData }) => ({ quote: { ...input.quote, lines: input.quote.lines.map((line) => ({ ...line, description: `${line.description} modifiée` })) }, message: "Mises à jour appliquées.", changed: input.quote.lines.map((line) => line.id), reviewPublication: false });
    const assisted = await createQuoteHandler({ database: connection.db, auth, provider })(new Request(`${origin}/api/quotes`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Préciser les lignes", locale: "fr" }) }));
    detail = await assisted.json();
    expect(detail.draft.lines).toHaveLength(30);
    const undone = await request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    const reverted = await undone.json();
    expect(reverted.canUndo).toBe(false);
    expect(reverted.draft.lines).toHaveLength(30);
    expect(reverted.draft.lines[0]).toMatchObject({ id: "line-1", description: "Ligne 1" });
    expect(reverted.draft.lines[29]).toMatchObject({ id: "line-30", description: "Ligne 30" });
  });

  it("rejects cross-business detail reads", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    const own = await created.json();
    const otherAuth = createAuthForDatabase(connection.db);
    const email = `other-${crypto.randomUUID()}@example.com`;
    const signup = await otherAuth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Other", email, password: "password123" }) }));
    const other = await signup.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, other.user.id));
    const signin = await otherAuth.handler(new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "password123" }) }));
    const otherCookie = signin.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
    const response = await createQuoteHandler({ database: connection.db, auth: otherAuth })(new Request(`${origin}/api/quotes?id=${own.id}`, { headers: { cookie: otherCookie } }));
    expect(response.status).toBe(404);
  });
});
