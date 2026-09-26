import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createAuthForDatabase } from "./auth.server";
import { connectDatabase } from "./db.server";
import { user } from "./db/schema";
import { firstQuoteExample } from "./first-quote-examples";
import type { QuoteData } from "./quote";
import { createQuotePdfHandler } from "./quote-pdf.server";
import { createQuoteHandler } from "./quotes.server";
import { createPdfRenderer } from "./pdf-renderer.server";
import { pdfPages } from "./pdf-test-support";
import { quoteLayouts, type QuoteLayout } from "./quote-layouts";

async function responsePages(response: Response): Promise<string[]> {
  return pdfPages(new Uint8Array(await response.arrayBuffer()));
}

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("Quote PDF downloads", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const auth = createAuthForDatabase(connection.db);
  const renderer = createPdfRenderer();
  const origin = "http://localhost:5173";
  const originalAllowlist = process.env.AUTH_ALLOWED_EMAILS;
  const originalDelivery = process.env.EMAIL_DELIVERY;
  let owner = "";
  let stranger = "";
  const quotes = createQuoteHandler({ database: connection.db, auth });
  const pdfs = createQuotePdfHandler({ database: connection.db, auth, renderer });

  async function signIn(): Promise<string> {
    const email = `pdf-${crypto.randomUUID()}@example.com`;
    const signedUp = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "PDF Artisan", email, password: "password123" }),
    }));
    const account = await signedUp.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, account.user.id));
    const signedIn = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    }));
    return signedIn.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  }

  async function mutate(cookie: string, body: Record<string, unknown>) {
    const response = await quotes(new Request(`${origin}/api/quotes`, {
      method: "POST", headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
    }));
    expect(response.status).toBe(200);
    return response.json();
  }

  /** Create a Quote whose Working Draft holds the given content, keeping the server-suggested reference unless one is supplied. */
  async function quoteWithDraft(cookie: string, content: (reference: string) => QuoteData) {
    const created = await mutate(cookie, { action: "create" });
    return mutate(cookie, { action: "save", id: created.id, expectedVersion: created.version, quote: content(created.draft.reference) });
  }

  async function publish(cookie: string, detail: { id: string; version: number }) {
    return mutate(cookie, { action: "publish", id: detail.id, expectedVersion: detail.version });
  }

  function download(path: string, cookie: string, handler = pdfs) {
    return handler(new Request(`${origin}${path}`, { headers: { cookie } }));
  }

  beforeAll(async () => {
    process.env.AUTH_ALLOWED_EMAILS = "*";
    process.env.EMAIL_DELIVERY = "fake";
    owner = await signIn();
    stranger = await signIn();
  });

  afterAll(async () => {
    if (originalAllowlist === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalAllowlist;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = originalDelivery;
    await renderer.close();
    await connection.pool.end();
  });

  it("downloads a Published Revision's Quote Document with searchable content, and the reference and page number on every page", async () => {
    const example = firstQuoteExample("joinery-reference");
    const detail = await publish(owner, await quoteWithDraft(owner, (reference) => ({ ...example, reference })));
    const reference = detail.revisions[0].quote.reference;

    const response = await download(`/api/quotes/${detail.id}/revisions/1/document`, owner);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(`filename="Devis-${reference}-r1.pdf"`);

    const pages = await responsePages(response);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, index) => {
      expect(page).toContain(`Devis ${reference}`);
      expect(page).toContain(`page ${index + 1}/${pages.length}`);
    });
    const text = pages.join(" ");
    expect(text).not.toContain("BROUILLON");
    expect(text).toContain("Habitat Echantillon SA");
    // Every description is present in full, however the pages break.
    for (const line of example.lines) expect(text).toContain(line.description.replace(/\s+/g, " ").trim());
    expect(text).toContain("Total CHF");
  }, 60_000);

  it("downloads a Draft Preview of the saved Working Draft, marked as a draft on every page, without publishing it", async () => {
    const draft = await quoteWithDraft(owner, (reference) => ({ ...firstQuoteExample("civil-works-reference"), reference, customerName: "" }));

    const response = await download(`/api/quotes/${draft.id}/draft-preview`, owner);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(`filename="Devis-${draft.draft.reference}-brouillon.pdf"`);
    const pages = await responsePages(response);
    pages.forEach((page) => expect(page).toContain("BROUILLON"));
    expect(pages.join(" ")).toContain("à compléter");

    const reopened = await (await quotes(new Request(`${origin}/api/quotes?id=${draft.id}`, { headers: { cookie: owner } }))).json();
    expect(reopened).toMatchObject({ version: draft.version, revisions: [] });
  }, 60_000);

  it("keeps each Published Revision in the Quote Layout it was published with while Draft Previews use the current one", async () => {
    const detail = await publish(owner, await quoteWithDraft(owner, (reference) => ({ ...firstQuoteExample("civil-works-reference"), reference })));
    const reopened = await mutate(owner, { action: "new-draft", id: detail.id, expectedVersion: detail.version });

    const standard = quoteLayouts[0];
    const redesigned: QuoteLayout = { ...standard, version: standard.version + 1, render: (content) => {
      const page = standard.render(content);
      return { ...page, html: page.html.replace("<body>", "<body><p>Mise en page redessinée</p>") };
    } };
    const afterRedesign = createQuotePdfHandler({ database: connection.db, auth, renderer, layouts: [standard, redesigned], currentLayout: redesigned });

    const revision = (await responsePages(await download(`/api/quotes/${detail.id}/revisions/1/document`, owner, afterRedesign))).join(" ");
    expect(revision).not.toContain("Mise en page redessinée");
    const preview = (await responsePages(await download(`/api/quotes/${reopened.id}/draft-preview`, owner, afterRedesign))).join(" ");
    expect(preview).toContain("Mise en page redessinée");
  }, 60_000);

  it("does not let another Artisan Business download a Quote's PDFs", async () => {
    const detail = await publish(owner, await quoteWithDraft(owner, (reference) => ({ ...firstQuoteExample("civil-works-reference"), reference })));
    expect((await download(`/api/quotes/${detail.id}/revisions/1/document`, stranger)).status).toBe(404);
    const reopened = await mutate(owner, { action: "new-draft", id: detail.id, expectedVersion: detail.version });
    expect((await download(`/api/quotes/${reopened.id}/draft-preview`, stranger)).status).toBe(404);
    expect((await download(`/api/quotes/${detail.id}/revisions/1/document`, "")).status).toBe(401);
    expect((await download(`/api/quotes/${detail.id}/revisions/2/document`, owner)).status).toBe(404);
  }, 60_000);
});
