import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { extractImages, getDocumentProxy } from "unpdf";

import { createAuthForDatabase } from "./auth.server";
import { createBusinessLogoHandler } from "./business-logo.server";
import { connectDatabase } from "./db.server";
import { user } from "./db/schema";
import { firstQuoteExample } from "./first-quote-examples";
import { createPdfRenderer } from "./pdf-renderer.server";
import { png } from "./pdf-test-support";
import { createQuotePdfHandler } from "./quote-pdf.server";
import { createQuoteHandler } from "./quotes.server";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("business logo", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const auth = createAuthForDatabase(connection.db);
  const renderer = createPdfRenderer();
  const origin = "http://localhost:5173";
  const quotes = createQuoteHandler({ database: connection.db, auth });
  const logos = createBusinessLogoHandler({ database: connection.db, auth });
  const pdfs = createQuotePdfHandler({ database: connection.db, auth, renderer });
  const originalAllowlist = process.env.AUTH_ALLOWED_EMAILS;
  const originalDelivery = process.env.EMAIL_DELIVERY;

  async function signIn(): Promise<string> {
    const email = `logo-${crypto.randomUUID()}@example.com`;
    const signedUp = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Logo Artisan", email, password: "password123" }),
    }));
    const account = await signedUp.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, account.user.id));
    const signedIn = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    }));
    return signedIn.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  }

  function upload(cookie: string, body: Uint8Array, contentType: string) {
    return logos(new Request(`${origin}/api/business-logo`, { method: "POST", headers: { cookie, origin, "content-type": contentType }, body: body as Uint8Array<ArrayBuffer> }));
  }

  async function mutate(cookie: string, body: Record<string, unknown>) {
    const response = await quotes(new Request(`${origin}/api/quotes`, {
      method: "POST", headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
    }));
    expect(response.status).toBe(200);
    return response.json();
  }

  async function publishedQuote(cookie: string) {
    const created = await mutate(cookie, { action: "create" });
    // The Working Draft keeps the logo copied from the business defaults at creation.
    const saved = await mutate(cookie, { action: "save", id: created.id, expectedVersion: created.version, quote: { ...firstQuoteExample("civil-works-reference"), reference: created.draft.reference, logoId: created.draft.logoId } });
    return mutate(cookie, { action: "publish", id: saved.id, expectedVersion: saved.version });
  }

  async function firstPageImages(path: string, cookie: string) {
    const response = await pdfs(new Request(`${origin}${path}`, { headers: { cookie } }));
    expect(response.status).toBe(200);
    const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
    return (await extractImages(pdf, 1)).map((image) => [image.width, image.height]);
  }

  beforeAll(() => {
    process.env.AUTH_ALLOWED_EMAILS = "*";
    process.env.EMAIL_DELIVERY = "fake";
  });

  afterAll(async () => {
    if (originalAllowlist === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalAllowlist;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = originalDelivery;
    await renderer.close();
    await connection.pool.end();
  });

  it("accepts PNG and JPEG logos up to 1 MB and rejects SVG, disguised or oversized files", async () => {
    const cookie = await signIn();
    const accepted = await upload(cookie, png(40, 20), "image/png");
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ defaults: { logoId: expect.any(String) } });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
    expect((await upload(cookie, jpeg, "image/jpeg")).status).toBe(200);

    const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>");
    expect((await upload(cookie, svg, "image/svg+xml")).status).toBe(415);
    expect((await upload(cookie, svg, "image/png")).status).toBe(415);
    const oversized = new Uint8Array(1_000_001); oversized.set(png(1, 1));
    expect((await upload(cookie, oversized, "image/png")).status).toBe(413);
  });

  it("freezes the logo with each Published Revision when the business later replaces it", async () => {
    const cookie = await signIn();
    expect((await upload(cookie, png(40, 20), "image/png")).status).toBe(200);
    const first = await publishedQuote(cookie);
    expect(await firstPageImages(`/api/quotes/${first.id}/revisions/1/document`, cookie)).toEqual([[40, 20]]);

    expect((await upload(cookie, png(30, 30), "image/png")).status).toBe(200);
    const second = await publishedQuote(cookie);
    expect(await firstPageImages(`/api/quotes/${second.id}/revisions/1/document`, cookie)).toEqual([[30, 30]]);
    expect(await firstPageImages(`/api/quotes/${first.id}/revisions/1/document`, cookie)).toEqual([[40, 20]]);
  }, 60_000);

  it("never shows another business's logo, even when a Working Draft names it", async () => {
    const owner = await signIn();
    const { defaults } = await (await upload(owner, png(40, 20), "image/png")).json();
    const stranger = await signIn();
    const created = await mutate(stranger, { action: "create" });
    await mutate(stranger, { action: "save", id: created.id, expectedVersion: created.version, quote: { ...firstQuoteExample("civil-works-reference"), reference: created.draft.reference, logoId: defaults.logoId } });
    expect(await firstPageImages(`/api/quotes/${created.id}/draft-preview`, stranger)).toEqual([]);
    const shown = await logos(new Request(`${origin}/api/business-logo/${defaults.logoId}`, { headers: { cookie: stranger } }));
    expect(shown.status).toBe(404);
  }, 60_000);
});
