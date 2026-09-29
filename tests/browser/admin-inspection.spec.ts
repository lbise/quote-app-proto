import type { Browser } from "@playwright/test";
import pg from "pg";
import { baseURL, createUser, signedInContext } from "./admin-support";
import { createCompleteQuote, expect, requestQuote, test } from "./fixtures";

// #53: Administrators inspect businesses, Quotes and Turn Traces, read-only.

/**
 * Record an Assistant Turn in the conversation of a Quote, as the server
 * would: the Artisan message, the assistant reply, and optionally its Turn
 * Trace. Live model calls are never made in browser tests.
 */
async function recordTurn(quoteId: string, options: { text: string; reply: string; trace: boolean }) {
  const database = new pg.Client({ connectionString: process.env.BROWSER_TEST_DATABASE_URL });
  await database.connect();
  try {
    const { rows: [quote] } = await database.query<{ business_id: string; owner_user_id: string }>(
      'select q.business_id, b.owner_user_id from quote q join artisan_business b on b.id = q.business_id where q.id = $1', [quoteId]);
    const requestId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await database.query("insert into quote_message (id, quote_id, role, fr, en, request_id) values ($1, $2, 'artisan', $3, $3, $4)", [crypto.randomUUID(), quoteId, options.text, requestId]);
    await database.query("insert into quote_message (id, quote_id, role, fr, en) values ($1, $2, 'assistant', $3, $3)", [messageId, quoteId, options.reply]);
    if (!options.trace) return null;
    const traceId = crypto.randomUUID();
    const detail = {
      text: options.text, locale: "en", systemPrompt: "You help an Artisan prepare a Quote.",
      modelCalls: [
        {
          sequence: 1, provider: "faux", model: "faux-1", startedAt: new Date().toISOString(), latencyMs: 850,
          settings: { maxTokens: 4096, reasoning: "off", timeoutMs: 20000 },
          payload: { model: "faux-1", messages: [{ role: "user", content: options.text }], marker: "payload-marker-53" },
          response: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "edit_quote_lines", arguments: { lines: [] } }] },
          usage: { input: 1200, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 1240, costUsd: 0.002 },
        },
        {
          sequence: 2, provider: "faux", model: "faux-1", startedAt: new Date().toISOString(), latencyMs: 400,
          settings: { maxTokens: 4096, reasoning: "off", timeoutMs: 20000 },
          payload: { model: "faux-1", messages: [] },
          response: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: options.reply }] },
          usage: { input: 1300, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 1310, costUsd: 0.001 },
        },
      ],
      toolCalls: [{ toolCallId: "call-1", name: "edit_quote_lines", arguments: { lines: [] }, outcome: "applied", result: { content: [{ type: "text", text: "Lines changed." }] } }],
      assistantOutcome: "committed",
      message: { id: messageId, role: "assistant", text: options.reply },
    };
    await database.query(
      `insert into turn_trace (id, quote_id, business_id, user_id, request_id, locale, outcome, outcome_kind, provider, model, model_call_count, input_tokens, output_tokens, cost_usd, message_id, detail)
       values ($1, $2, $3, $4, $5, 'en', 'committed', 'committed', 'faux', 'faux-1', 2, 2500, 50, 0.003, $6, $7)`,
      [traceId, quoteId, quote.business_id, quote.owner_user_id, requestId, messageId, JSON.stringify(detail)]);
    return traceId;
  } finally {
    await database.end();
  }
}

// One Administrator for the file: sign-up is rate limited.
let administrator: Promise<{ email: string }> | undefined;

async function administratorPage(browser: Browser) {
  administrator ??= createUser("Inspecting Administrator", { administrator: true });
  const { email } = await administrator;
  const context = await signedInContext(browser, email);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  return { context, page: await context.newPage() };
}

test("an Administrator follows a business to a Quote's conversation and opens a Turn Trace", async ({ artisan, browser }) => {
  const businessName = `Atelier Inspecté ${crypto.randomUUID().slice(0, 8)}`;
  expect((await requestQuote(artisan, { action: "defaults-save", defaults: { businessName } })).ok).toBe(true);
  const quote = await createCompleteQuote(artisan);
  await recordTurn(quote.id, { text: "An older request.", reply: "Older reply.", trace: false });
  const traceId = await recordTurn(quote.id, { text: "Add the installation.", reply: "The installation was added.", trace: true });

  const admin = await administratorPage(browser);
  try {
    const { page } = admin;
    await page.goto("/admin");
    await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Businesses" }).click();
    await expect(page.getByRole("heading", { name: "Artisan Businesses", level: 1 })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: businessName });
    await expect(row).toContainText(artisan.email);
    await expect(row).toContainText("1 active · 0 archived");
    await row.getByRole("link", { name: businessName }).click();

    await expect(page.getByRole("heading", { name: businessName, level: 1 })).toBeVisible();
    await page.getByRole("row").filter({ hasText: quote.draft.reference }).getByRole("link", { name: "Bibliothèque sur mesure" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(quote.draft.reference);
    await expect(page.getByText("Read-only.", { exact: false })).toBeVisible();
    await expect(page.frameLocator("iframe.qp-admin-document").getByText("Bibliothèque en chêne avec fixations invisibles.")).toBeVisible();
    const download = page.getByRole("link", { name: "Download Draft Preview" });
    const preview = await admin.context.request.get((await download.getAttribute("href"))!);
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toBe("application/pdf");
    // Nothing on the page changes the Quote.
    for (const name of ["Publish", "Archive", "Delete", "Send"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);

    const conversation = page.getByRole("region", { name: "Conversation" });
    await expect(conversation.getByRole("listitem").filter({ hasText: "An older request." })).toContainText("Turn Trace expired");
    await conversation.getByRole("listitem").filter({ hasText: "Add the installation." }).getByRole("link", { name: "View trace" }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/turns/${traceId}$`));
    await expect(page.getByRole("heading", { name: "Turn Trace", level: 1 })).toBeVisible();
    const steps = page.getByRole("region", { name: "Model and tool calls" });
    await expect(steps.getByRole("heading", { level: 3 })).toHaveText(["Model call 1", "Tool call edit_quote_lines", "Model call 2"]);
    await expect(steps.getByRole("listitem").first()).toContainText("850 ms");
    await steps.getByText("Provider payload").first().click();
    await expect(steps.locator("pre").first()).toContainText('"marker": "payload-marker-53"');
    await steps.getByRole("button", { name: "Copy Provider payload" }).first().click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("payload-marker-53");
  } finally { await admin.context.close(); }
});

test("an Administrator lists Assistant Turns and filters them by outcome and User", async ({ artisan, browser }) => {
  const quote = await createCompleteQuote(artisan);
  const traceId = await recordTurn(quote.id, { text: "Add a shelf.", reply: "The shelf was added.", trace: true });

  const admin = await administratorPage(browser);
  try {
    const { page } = admin;
    await page.goto("/admin");
    await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Assistant Turns" }).click();
    await expect(page.getByRole("heading", { name: "Assistant Turns", level: 1 })).toBeVisible();
    const row = page.getByRole("row").filter({ has: page.locator(`a[href="/admin/turns/${traceId}"]`) });
    await expect(row).toContainText(artisan.email);
    await expect(row).toContainText(quote.draft.reference);
    await expect(row).toContainText("Committed");
    await expect(row).toContainText("faux-1");
    await expect(row).toContainText("2,500 / 50");
    await expect(row).toContainText("US$0.003");

    const filters = page.getByRole("form", { name: "Filters" });
    await filters.getByLabel("Outcome").selectOption({ label: "Provider error" });
    await filters.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/outcome=provider_error/);
    await expect(row).toHaveCount(0);

    await filters.getByLabel("Outcome").selectOption({ label: "Committed" });
    await filters.getByLabel("User").selectOption({ label: `Browser Artisan · ${artisan.email}` });
    await filters.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/outcome=committed&user=/);
    await expect(row).toHaveCount(1);
    await row.getByRole("link", { name: `View trace ${quote.draft.reference}` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/turns/${traceId}$`));
  } finally { await admin.context.close(); }
});

test("a Turn Trace link says when the trace is gone", async ({ browser }) => {
  const admin = await administratorPage(browser);
  try {
    const response = await admin.page.goto(`/admin/turns/${crypto.randomUUID()}`);
    expect(response?.status()).toBe(404);
    await expect(admin.page.getByText("This Turn Trace is no longer available.", { exact: false })).toBeVisible();
  } finally { await admin.context.close(); }
});

test("the inspection views are not found for Artisans who are not Administrators", async ({ artisan }) => {
  const quote = await createCompleteQuote(artisan);
  for (const path of ["/admin/businesses", "/admin/turns", `/admin/turns/${crypto.randomUUID()}`, `/admin/quotes/${quote.id}`]) {
    expect((await artisan.page.goto(path))?.status(), path).toBe(404);
  }
  expect((await artisan.page.request.get(`/admin/quotes/${quote.id}/draft-preview`)).status()).toBe(404);
});
