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


  it("keeps the real undo target when an identical normalized save is retried", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const first = complete(detail.draft.reference);
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: first });
    detail = await saved.json();
    const changed = { ...first, title: "Titre réellement modifié" };
    const changedSave = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: changed });
    detail = await changedSave.json();
    const noOp = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: { ...changed, lines: [...changed.lines] } });
    const afterNoOp = await noOp.json();
    expect(afterNoOp.version).toBe(detail.version);
    const undone = await request({ action: "undo", id: detail.id, expectedVersion: afterNoOp.version, requestId: crypto.randomUUID() });
    expect(await undone.json()).toMatchObject({ draft: { title: first.title } });
  });

  it("persists section structure and deliberate copies through reopen and one structural undo", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const original = {
      ...complete(detail.draft.reference),
      sections: [
        { id: "section-a", title: "Séjour" },
        { id: "section-b", title: "Chambre" },
      ],
      lines: [
        { id: "line-a", sectionId: "section-a", description: "Habillage mural", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "100.00" },
        { id: "line-b", sectionId: "section-b", description: "Tablette", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "50.00" },
      ],
    };
    const firstSave = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: original });
    expect(firstSave.status).toBe(200);
    detail = await firstSave.json();

    const structural = {
      ...original,
      sections: [
        { id: "section-b", title: "Chambre nord" },
        { id: "section-a", title: "Séjour" },
      ],
      lines: [
        { ...original.lines[1], id: "line-b-copy", sectionId: "section-b" },
        original.lines[1],
        original.lines[0],
      ],
    };
    const changed = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: structural });
    expect(changed.status).toBe(200);
    detail = await changed.json();
    expect(detail.draft).toMatchObject({
      sections: structural.sections,
      lines: structural.lines,
    });
    expect(new Set(detail.draft.lines.map((line: { id: string }) => line.id)).size).toBe(3);

    const reopened = await request(undefined, detail.id);
    expect((await reopened.json()).draft).toMatchObject({ sections: structural.sections, lines: structural.lines });
    const undone = await request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect((await undone.json()).draft).toMatchObject({ sections: original.sections, lines: original.lines });
  });

  it("publishes authoritative section subtotals and global line numbering", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    let detail = await created.json();
    const quote = {
      ...complete(detail.draft.reference),
      sections: [
        { id: "section-a", title: "Séjour" },
        { id: "section-b", title: "Chambre" },
      ],
      lines: [
        { id: "line-a", sectionId: "section-a", description: "Habillage", mode: "quantity", quantity: "1.005", unit: "m", unitPrice: "10.00", amount: "" },
        { id: "line-b", sectionId: "section-b", description: "Tablette", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "20.00" },
      ],
    };
    const saved = await request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote });
    detail = await saved.json();
    const published = await request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(published.status).toBe(200);
    expect((await published.json()).revisions[0].calculation).toMatchObject({
      lines: [{ id: "line-a", number: 1, amount: 1005 }, { id: "line-b", number: 2, amount: 2000 }],
      sections: [{ id: "section-a", subtotal: 1005, incomplete: false }, { id: "section-b", subtotal: 2000, incomplete: false }],
      subtotal: 3005,
    });
  });

  it("serializes duplicate customer creation keys and rejects changed payloads", async () => {
    const requestId = crypto.randomUUID();
    const customer = { name: "Maison Exemple", address: "Rue Exemple 1", contact: "Camille" };
    const [first, second] = await Promise.all([
      request({ action: "customer-save", requestId, customer }),
      request({ action: "customer-save", requestId, customer }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.customers.filter((entry: { name: string }) => entry.name === customer.name)).toHaveLength(1);
    expect(firstBody.savedCustomer).toMatchObject(customer);
    const changed = await request({ action: "customer-save", requestId, customer: { ...customer, contact: "Autre" } });
    expect(changed.status).toBe(409);
  });

  it("applies an owned Customer to one Working Draft without linking later changes", async () => {
    const savedCustomer = await request({ action: "customer-save", requestId: crypto.randomUUID(), customer: { name: "Maison Alpha", address: "Rue Alpha 1", contact: "Camille" } });
    const customerBody = await savedCustomer.json();
    const customerId = customerBody.savedCustomer.id as string;
    const firstCreated = await request({ action: "create", requestId: crypto.randomUUID() });
    const first = await firstCreated.json();
    const secondCreated = await request({ action: "create", requestId: crypto.randomUUID() });
    const second = await secondCreated.json();

    const applied = await request({ action: "customer-apply", id: first.id, expectedVersion: first.version, requestId: crypto.randomUUID(), customerId });
    expect(applied.status).toBe(200);
    let firstDetail = await applied.json();
    expect(firstDetail.draft).toMatchObject({ customerName: "Maison Alpha", customerAddress: "Rue Alpha 1", customerContact: "Camille" });

    const localCorrection = { ...firstDetail.draft, customerAddress: "Rue Alpha 9", customerContact: "" };
    const corrected = await request({ action: "save", id: first.id, expectedVersion: firstDetail.version, requestId: crypto.randomUUID(), quote: localCorrection });
    firstDetail = await corrected.json();
    const secondApplied = await request({ action: "customer-apply", id: second.id, expectedVersion: second.version, requestId: crypto.randomUUID(), customerId });
    expect(secondApplied.status).toBe(200);

    const updatedReusable = await request({ action: "customer-save", requestId: crypto.randomUUID(), customer: { id: customerId, name: "Maison Alpha", address: "Rue Alpha 14", contact: "Camille mise à jour" } });
    expect(updatedReusable.status).toBe(200);
    const reopenedFirst = await request(undefined, first.id);
    expect((await reopenedFirst.json()).draft).toMatchObject({ customerName: "Maison Alpha", customerAddress: "Rue Alpha 9", customerContact: "" });
    const reopenedSecond = await request(undefined, second.id);
    expect((await reopenedSecond.json()).draft).toMatchObject({ customerName: "Maison Alpha", customerAddress: "Rue Alpha 1", customerContact: "Camille" });

    const missingCustomer = await request({ action: "customer-apply", id: first.id, expectedVersion: firstDetail.version, requestId: crypto.randomUUID(), customerId: "customer-from-another-business" });
    expect(missingCustomer.status).toBe(404);
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


  it("rejects cross-business detail reads and reusable Customer operations", async () => {
    const created = await request({ action: "create", requestId: crypto.randomUUID() });
    const own = await created.json();
    const ownCustomerResponse = await request({ action: "customer-save", requestId: crypto.randomUUID(), customer: { name: "Own Customer", address: "Own address", contact: "" } });
    const ownCustomerId = (await ownCustomerResponse.json()).savedCustomer.id as string;
    const otherAuth = createAuthForDatabase(connection.db);
    const email = `other-${crypto.randomUUID()}@example.com`;
    const signup = await otherAuth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Other", email, password: "password123" }) }));
    const other = await signup.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, other.user.id));
    const signin = await otherAuth.handler(new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "password123" }) }));
    const otherCookie = signin.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
    const otherHandler = createQuoteHandler({ database: connection.db, auth: otherAuth });
    const otherRequest = (body?: Record<string, unknown>, id?: string) => otherHandler(new Request(`${origin}/api/quotes${id ? `?id=${id}` : ""}`, {
      method: body ? "POST" : "GET", headers: { cookie: otherCookie, ...(body ? { origin, "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const otherCustomerResponse = await otherRequest({ action: "customer-save", requestId: crypto.randomUUID(), customer: { name: "Other Customer", address: "Other address", contact: "" } });
    const otherCustomerId = (await otherCustomerResponse.json()).savedCustomer.id as string;

    const ownList = await request();
    expect(ownList.status).toBe(200);
    expect((await ownList.json()).customers).not.toContainEqual(expect.objectContaining({ id: otherCustomerId }));
    expect((await request({ action: "customer-save", requestId: crypto.randomUUID(), customer: { id: otherCustomerId, name: "Hijacked", address: "Nope", contact: "" } })).status).toBe(404);
    expect((await request({ action: "customer-apply", id: own.id, expectedVersion: own.version, requestId: crypto.randomUUID(), customerId: otherCustomerId })).status).toBe(404);
    expect((await otherRequest(undefined, own.id)).status).toBe(404);
    expect((await otherRequest({ action: "customer-apply", id: own.id, expectedVersion: own.version, requestId: crypto.randomUUID(), customerId: ownCustomerId })).status).toBe(404);
  });
});
