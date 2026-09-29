import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";

import { AdministrationRefusal } from "./administration.server";
import { quote as quoteTable, turnTrace } from "./db/schema";
import type { QuoteAIModelBoundary } from "./quote-assistant.server";
import { completeQuote, quoteHttpHarness, quoteSteps, type ArtisanFixture } from "./quote-http.test-support";
import { response, scriptedModel, secret } from "./turn-trace.test-support";
import { deleteExpiredTurnTraces, listTurnTraces, readTurnTrace, readTurnTraces, recordTurnTrace, scheduleTurnTraceRetention } from "./turn-traces.server";
import type { TurnTraceModelCall } from "./turn-trace";

// #52: every Assistant Turn leaves a Turn Trace that only Administrators can read.

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("Turn Traces", () => {
  const harness = quoteHttpHarness("turn-traces");
  const database = harness.connection.db;
  const originalAdminEmails = process.env.ADMIN_EMAILS;
  let administrator: ArtisanFixture;
  let artisan: ArtisanFixture;

  beforeAll(async () => {
    harness.setUp();
    administrator = await harness.artisan("Trace Administrator");
    artisan = await harness.artisan("Trace Artisan");
    process.env.ADMIN_EMAILS = administrator.email;
    vi.stubEnv("OPENROUTER_API_KEY", secret);
  });
  afterEach(() => { process.env.ADMIN_EMAILS = administrator.email; });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
    await harness.tearDown();
  });

  const traces = (quoteId: string) => readTurnTraces(database, administrator.userId, { quoteId });

  async function draft(patch: Parameters<typeof completeQuote>[1] = {}) {
    const steps = quoteSteps(artisan.request);
    const created = await steps.create();
    return steps.save(created, completeQuote(created.draft!.reference, patch));
  }

  function send(modelBoundary: QuoteAIModelBoundary | undefined, detail: { id: string; version: number }, text = "Ajoute la pose.", extra: Record<string, unknown> = {}) {
    const request = modelBoundary ? artisan.withDependencies({ modelBoundary }) : artisan.request;
    return request({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text, locale: "fr", ...extra });
  }

  it("records a committed turn: payloads, responses, tool calls, usage, versions, User, Quote and resulting message", async () => {
    const detail = await draft();
    const model = scriptedModel([
      response([fauxThinking("The Artisan wants a line."), fauxToolCall("edit_quote_lines", { lines: [{ description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" }] })], { stopReason: "toolUse", input: 1200, output: 40, cost: 0.002 }),
      response("La pose a été ajoutée.", { input: 1500, output: 10, cost: 0.0015 }),
    ]);
    const sent = await send(model, detail);
    expect(sent.status).toBe(200);
    const committed = await sent.json();

    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({
      quoteId: detail.id, userId: artisan.userId, locale: "fr", outcome: "committed", outcomeKind: "committed", reason: null,
      baseVersion: detail.version, resultVersion: committed.version,
      provider: "faux", model: "faux-1", modelCallCount: 2, inputTokens: 2700, outputTokens: 50,
    });
    expect(trace.costUsd).toBeCloseTo(0.0035);
    expect(trace.detail.text).toBe("Ajoute la pose.");
    expect(trace.detail.message).toMatchObject({ role: "assistant" });
    expect(trace.detail.message?.text).toContain("La pose a été ajoutée.");
    expect(trace.messageId).toBe(trace.detail.message?.id);
    expect(trace.detail.assistantOutcome).toBe("committed");

    const [first, second] = trace.detail.modelCalls as TurnTraceModelCall[];
    expect(first).toMatchObject({ sequence: 1, provider: "faux", model: "faux-1", usage: { input: 1200, output: 40, costUsd: 0.002 } });
    expect(first.latencyMs).toBeGreaterThanOrEqual(0);
    expect(first.payload).toMatchObject({ system: expect.stringContaining("You help an Artisan prepare a Quote"), tools: expect.arrayContaining([expect.objectContaining({ name: "edit_quote_lines" })]) });
    expect(JSON.stringify(first.payload)).toContain("Ajoute la pose.");
    expect(JSON.stringify(first.payload)).toContain("Bibliothèque sur mesure");
    expect(first.response).toMatchObject({ stopReason: "toolUse", content: [{ type: "thinking", thinking: "The Artisan wants a line." }, { type: "toolCall", name: "edit_quote_lines" }] });
    expect(second.response).toMatchObject({ stopReason: "stop" });
    expect(trace.detail.toolCalls).toEqual([expect.objectContaining({ name: "edit_quote_lines", outcome: "applied", arguments: expect.objectContaining({ lines: [expect.objectContaining({ amount: "80.00" })] }) })]);
  });

  it("records a committed turn with failed tool calls", async () => {
    const detail = await draft();
    const model = scriptedModel([
      response([fauxToolCall("unknown_tool", {})], { stopReason: "toolUse" }),
      response([fauxToolCall("edit_quote_lines", { lines: [{ description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" }] })], { stopReason: "toolUse" }),
      response("La pose a été ajoutée."),
    ]);
    expect((await send(model, detail)).status).toBe(200);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "committed", outcomeKind: "committed_with_failed_calls" });
  });

  it("records a provider failure after the request was sent", async () => {
    const detail = await draft();
    const model = scriptedModel([]);
    const failing: QuoteAIModelBoundary = {
      ...model,
      streamFn: async (requestModel, context, options) => {
        await options?.onPayload?.({ model: requestModel.id, messages: context.messages }, requestModel);
        throw new Error("socket hang up");
      },
    };
    expect((await send(failing, detail)).status).toBe(502);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "discarded", outcomeKind: "provider_error", modelCallCount: 1 });
    expect(trace.detail.modelCalls[0]).toMatchObject({ error: "socket hang up", payload: expect.anything() });
  });

  it("records an unchanged turn", async () => {
    const detail = await draft();
    expect((await send(scriptedModel([response("Quelle pièce ?")]), detail, "Peins.")).status).toBe(200);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "unchanged", outcomeKind: "unchanged", baseVersion: detail.version, resultVersion: detail.version, modelCallCount: 1 });
  });

  it("never records credentials", async () => {
    const detail = await draft();
    await send(scriptedModel([response("Noté.")]), detail);
    const [trace] = await traces(detail.id);
    const stored = JSON.stringify(trace);
    expect(stored).not.toContain(secret);
    const payload = trace.detail.modelCalls[0].payload as { apiKey: string; headers: { Authorization: string }; note: string };
    expect(payload.apiKey).toBe("[redacted]");
    expect(payload.headers.Authorization).toBe("[redacted]");
    expect(payload.note).toBe("key [redacted] in text");
  });

  it("records a discarded turn with its rejected tool calls and the reason", async () => {
    const detail = await draft();
    const model = scriptedModel([
      response([fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {})], { stopReason: "toolUse" }),
    ]);
    expect((await send(model, detail)).status).toBe(502);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "discarded", outcomeKind: "discarded", reason: "failed_call_limit_reached", baseVersion: detail.version, resultVersion: detail.version, messageId: null });
    expect(trace.detail.toolCalls).toHaveLength(3);
    expect(trace.detail.toolCalls[0]).toMatchObject({ name: "unknown_tool", outcome: "rejected" });
    expect(trace.detail.toolCalls[0].result).toBeDefined();
  });

  it("records a provider failure with the provider's error response", async () => {
    const detail = await draft();
    expect((await send(scriptedModel([response([], { stopReason: "error", errorMessage: "Upstream overloaded" })]), detail)).status).toBe(502);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "discarded", outcomeKind: "provider_error", reason: "assistant_failed", modelCallCount: 1 });
    expect(trace.detail.modelCalls[0].response).toMatchObject({ stopReason: "error", errorMessage: "Upstream overloaded" });
  });

  it("records a call refused before sending, such as by the spending limit, with the context that would have been sent", async () => {
    const detail = await draft();
    let failure: string | undefined;
    const model: QuoteAIModelBoundary = {
      ...scriptedModel([]),
      failure: () => failure,
      streamFn: async () => { failure = "spend_limit_reached"; throw new Error("The Quote AI spending limit has been reached."); },
    };
    expect((await send(model, detail)).status).toBe(502);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "discarded", outcomeKind: "failed_before_model_call", reason: "spend_limit_reached", modelCallCount: 1, inputTokens: 0 });
    const [call] = trace.detail.modelCalls;
    expect(call.payload).toBeUndefined();
    expect(call.response).toBeUndefined();
    expect(call.error).toBe("The Quote AI spending limit has been reached.");
    expect(JSON.stringify(call.context)).toContain("Ajoute la pose.");
  });

  it("records a turn stopped by a stale Working Draft before any model call", async () => {
    const detail = await draft();
    const refused = await send(scriptedModel([response("Jamais envoyé.")]), { id: detail.id, version: detail.version - 1 });
    expect(refused.status).toBe(409);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "discarded", outcomeKind: "failed_before_model_call", reason: "stale_version", modelCallCount: 0, baseVersion: detail.version, resultVersion: detail.version });
    expect(trace.detail.text).toBe("Ajoute la pose.");
    expect(trace.detail.systemPrompt).toContain("You help an Artisan prepare a Quote");
    expect(trace.detail.applicationContext).toMatchObject({ currentWorkingDraft: { title: "Bibliothèque sur mesure" }, currentMessage: { text: "Ajoute la pose." } });
  });

  it("records a turn stopped because the draft is too large", async () => {
    const detail = await draft();
    const lines = Array.from({ length: 1_001 }, (_, index) => ({ id: `line-${index}`, sectionId: "", description: "Ligne", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "1.00" }));
    await database.update(quoteTable).set({ draft: { ...completeQuote(detail.draft!.reference), lines } }).where(eq(quoteTable.id, detail.id));
    expect((await send(scriptedModel([]), detail)).status).toBe(413);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "discarded", reason: "quote_limits_exceeded", modelCallCount: 0 });
    expect((trace.detail.applicationContext as { currentWorkingDraft: { lines: unknown[] } }).currentWorkingDraft.lines).toHaveLength(1_001);
  });

  it("records a turn stopped because the provider is not configured", async () => {
    const detail = await draft();
    const provider = process.env.QUOTE_AI_PROVIDER;
    vi.stubEnv("QUOTE_AI_PROVIDER", "");
    try {
      expect((await send(undefined, detail)).status).toBe(502);
    } finally {
      vi.stubEnv("QUOTE_AI_PROVIDER", provider);
    }
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "discarded", reason: "provider_configuration_invalid", modelCallCount: 0 });
    expect(trace.detail.applicationContext).toMatchObject({ currentMessage: { text: "Ajoute la pose." } });
  });

  it("records a response discarded as stale after the Working Draft changed, with the note it left", async () => {
    const detail = await draft();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { started = resolve; });
    const model = scriptedModel([
      response([fauxToolCall("edit_quote_details", { fields: { title: "Titre assistant" } })], { stopReason: "toolUse" }),
      response("Titre changé."),
    ], { beforeCall: async (call) => { if (call === 1) { started(); await gate; } } });
    const pending = send(model, detail);
    await reached;
    await quoteSteps(artisan.request).save(detail, { ...detail.draft!, title: "Titre manuel" });
    release();
    expect((await pending).status).toBe(409);
    const [trace] = await traces(detail.id);
    expect(trace).toMatchObject({ outcome: "discarded", outcomeKind: "discarded", reason: "stale", modelCallCount: 2, baseVersion: detail.version, resultVersion: detail.version + 1 });
    expect(trace.detail.message).toMatchObject({ role: "note", text: "Réponse devenue obsolète; le brouillon a changé." });
  });

  it("keeps the turn's result when recording its Turn Trace fails", async () => {
    const detail = await draft();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failingRecorder = artisan.withDependencies({ modelBoundary: scriptedModel([response("Noté.")]), recordTurnTrace: async () => { throw new Error(`insert failed ${secret}`); } });
      const committed = await failingRecorder({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Note.", locale: "fr" });
      expect(committed.status).toBe(200);
      const refusing = artisan.withDependencies({ recordTurnTrace: async () => { throw new Error("insert failed"); } });
      const stale = await refusing({ action: "assistant", id: detail.id, expectedVersion: detail.version - 1, requestId: crypto.randomUUID(), text: "Note.", locale: "fr" });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({ error: "stale_version" });
      // A fixed message only: nothing from the turn or the error reaches the logs.
      for (const call of errors.mock.calls) expect(JSON.stringify(call)).not.toMatch(/insert failed|Note\./);
    } finally {
      errors.mockRestore();
    }
  });

  it("deletes a Quote's Turn Traces with the Quote", async () => {
    const detail = await draft();
    await send(scriptedModel([response("Noté.")]), detail);
    expect(await traces(detail.id)).toHaveLength(1);
    const deleted = await artisan.request({ action: "delete", id: detail.id, requestId: crypto.randomUUID() });
    expect(deleted.status).toBe(200);
    expect(await database.select().from(turnTrace).where(eq(turnTrace.quoteId, detail.id))).toHaveLength(0);
  });

  it("deletes Turn Traces after 30 days and never shows older ones", async () => {
    const detail = await draft();
    await send(scriptedModel([response("Ancien.")]), detail);
    await send(scriptedModel([response("Récent.")]), detail);
    const [recent, old] = await traces(detail.id);
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60_000);
    await database.update(turnTrace).set({ createdAt: thirtyOneDaysAgo }).where(eq(turnTrace.id, old.id));

    expect((await traces(detail.id)).map((trace) => trace.id)).toEqual([recent.id]);
    await deleteExpiredTurnTraces(database, new Date());
    expect((await database.select({ id: turnTrace.id }).from(turnTrace).where(eq(turnTrace.quoteId, detail.id))).map((row) => row.id)).toEqual([recent.id]);
  });

  it("deletes expired Turn Traces on a schedule, without manual action", async () => {
    const detail = await draft();
    await send(scriptedModel([response("Ancien.")]), detail);
    await database.update(turnTrace).set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) }).where(eq(turnTrace.quoteId, detail.id));
    const stop = scheduleTurnTraceRetention(() => database, { firstRunMs: 10, intervalMs: 60_000 });
    try {
      await vi.waitFor(async () => {
        expect(await database.select({ id: turnTrace.id }).from(turnTrace).where(eq(turnTrace.quoteId, detail.id))).toHaveLength(0);
      }, { timeout: 2_000, interval: 50 });
    } finally {
      stop();
    }
  });

  it("lets only Administrators read Turn Traces", async () => {
    const detail = await draft();
    await send(scriptedModel([response("Noté.")]), detail);
    await expect(readTurnTraces(database, artisan.userId, { quoteId: detail.id })).rejects.toBeInstanceOf(AdministrationRefusal);
    process.env.ADMIN_EMAILS = "";
    await expect(readTurnTraces(database, administrator.userId, { quoteId: detail.id })).rejects.toBeInstanceOf(AdministrationRefusal);
  });

  it("stores the largest turn without truncation", async () => {
    const detail = await draft();
    const [business] = await database.select({ businessId: quoteTable.businessId }).from(quoteTable).where(eq(quoteTable.id, detail.id));
    const call = (sequence: number): TurnTraceModelCall => ({
      sequence, provider: "faux", model: "faux-1", startedAt: new Date().toISOString(), settings: { maxTokens: 4096, reasoning: "off", timeoutMs: 20_000 },
      // Just under the 600,000-byte payload limit, with multi-byte characters and key order that jsonb would change.
      payload: { z: "last", messages: [{ role: "user", content: `${"é".repeat(299_000)}${sequence}` }], a: "first" },
      response: { role: "assistant", content: [{ type: "text", text: "x".repeat(60_000) }] },
    });
    const modelCalls = Array.from({ length: 12 }, (_, index) => call(index + 1));
    await recordTurnTrace(database, {
      quoteId: detail.id, businessId: business.businessId, userId: artisan.userId, requestId: crypto.randomUUID(), locale: "en", text: "Large",
      outcome: "unchanged", baseVersion: detail.version, resultVersion: detail.version,
      turn: { systemPrompt: "system", modelCalls, toolCalls: [] },
    });
    const [trace] = await traces(detail.id);
    expect(trace.detail.modelCalls).toEqual(modelCalls);
    expect(Object.keys(trace.detail.modelCalls[0].payload as object)).toEqual(["z", "messages", "a"]);
  });
  describe("for the admin area", () => {
    let listed: ArtisanFixture;
    const now = new Date("2026-09-20T12:00:00Z");

    beforeAll(async () => { listed = await harness.artisan("Listed Artisan"); });

    async function listedDraft() {
      const steps = quoteSteps(listed.request);
      const created = await steps.create();
      return steps.save(created, completeQuote(created.draft!.reference));
    }
    function sendAs(modelBoundary: QuoteAIModelBoundary, detail: { id: string; version: number }) {
      return listed.withDependencies({ modelBoundary })({ action: "assistant", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), text: "Ajoute la pose.", locale: "fr" });
    }
    const list = (filter: Parameters<typeof listTurnTraces>[2], options: Parameters<typeof listTurnTraces>[3] = {}) =>
      listTurnTraces(database, administrator.userId, filter, { now, ...options });

    it("lists Turn Traces newest first with their User, business, Quote, outcome, model, calls, tokens and cost", async () => {
      const detail = await listedDraft();
      await sendAs(scriptedModel([response("Quelle pièce ?", { input: 300, output: 5, cost: 0.0004 })]), detail);
      await sendAs(scriptedModel([
        response([fauxToolCall("edit_quote_details", { fields: { title: "Nouveau titre" } })], { stopReason: "toolUse", input: 1000, output: 30, cost: 0.002 }),
        response("Titre changé.", { input: 1100, output: 8, cost: 0.001 }),
      ]), detail);
      const [first, second] = await database.select({ id: turnTrace.id }).from(turnTrace).where(eq(turnTrace.quoteId, detail.id)).orderBy(turnTrace.createdAt);
      await database.update(turnTrace).set({ createdAt: new Date("2026-09-10T08:00:00Z") }).where(eq(turnTrace.id, first.id));
      await database.update(turnTrace).set({ createdAt: new Date("2026-09-11T08:00:00Z") }).where(eq(turnTrace.id, second.id));

      const { traces: rows, hasMore } = await list({ quoteId: detail.id });
      expect(hasMore).toBe(false);
      expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
      expect(rows[0]).toEqual({
        id: second.id, createdAt: new Date("2026-09-11T08:00:00Z"), requestId: expect.any(String),
        outcome: "committed", outcomeKind: "committed", reason: null,
        provider: "faux", model: "faux-1", modelCallCount: 2, inputTokens: 2100, outputTokens: 38, costUsd: expect.closeTo(0.003),
        user: { id: listed.userId, name: "Listed Artisan", email: listed.email },
        business: { id: expect.any(String), name: "" },
        quote: { id: detail.id, reference: detail.draft!.reference, title: "Nouveau titre" },
      });
      expect(rows[1]).toMatchObject({ outcomeKind: "unchanged", modelCallCount: 1, inputTokens: 300, outputTokens: 5 });
    });

    it("filters by outcome, User and date range, in Swiss days", async () => {
      const detail = await listedDraft();
      await sendAs(scriptedModel([response("Quelle pièce ?")]), detail);
      await sendAs(scriptedModel([response([], { stopReason: "error", errorMessage: "Upstream overloaded" })]), detail);
      const [unchanged, failed] = await database.select({ id: turnTrace.id }).from(turnTrace).where(eq(turnTrace.quoteId, detail.id)).orderBy(turnTrace.createdAt);
      // 23:30 on 10 September and 00:30 on 11 September in Switzerland.
      await database.update(turnTrace).set({ createdAt: new Date("2026-09-10T21:30:00Z") }).where(eq(turnTrace.id, unchanged.id));
      await database.update(turnTrace).set({ createdAt: new Date("2026-09-10T22:30:00Z") }).where(eq(turnTrace.id, failed.id));

      const ids = async (filter: Parameters<typeof listTurnTraces>[2]) => (await list({ quoteId: detail.id, ...filter })).traces.map((row) => row.id);
      expect(await ids({ outcomeKind: "provider_error" })).toEqual([failed.id]);
      expect(await ids({ outcomeKind: "unchanged" })).toEqual([unchanged.id]);
      expect(await ids({ outcomeKind: "committed" })).toEqual([]);
      expect(await ids({ userId: listed.userId })).toEqual([failed.id, unchanged.id]);
      expect(await ids({ userId: administrator.userId })).toEqual([]);
      expect(await ids({ from: "2026-09-10", to: "2026-09-10" })).toEqual([unchanged.id]);
      expect(await ids({ from: "2026-09-11" })).toEqual([failed.id]);
      expect(await ids({ to: "2026-09-09" })).toEqual([]);
      // Impossible days are ignored, not sent to the database.
      expect(await ids({ from: "2026-13-45", to: "2026-02-30" })).toEqual([failed.id, unchanged.id]);
    });

    it("pages through Turn Traces and leaves out expired ones", async () => {
      const detail = await listedDraft();
      for (const text of ["Un.", "Deux.", "Trois."]) await sendAs(scriptedModel([response(text)]), detail);
      const rows = await database.select({ id: turnTrace.id }).from(turnTrace).where(eq(turnTrace.quoteId, detail.id)).orderBy(turnTrace.createdAt);
      await Promise.all(rows.map((row, index) => database.update(turnTrace).set({ createdAt: new Date(now.getTime() - (3 - index) * 60_000) }).where(eq(turnTrace.id, row.id))));

      const firstPage = await list({ quoteId: detail.id }, { pageSize: 2 });
      expect(firstPage).toMatchObject({ hasMore: true });
      expect(firstPage.traces.map((row) => row.id)).toEqual([rows[2].id, rows[1].id]);
      const secondPage = await list({ quoteId: detail.id }, { pageSize: 2, page: 2 });
      expect(secondPage).toMatchObject({ hasMore: false });
      expect(secondPage.traces.map((row) => row.id)).toEqual([rows[0].id]);

      await database.update(turnTrace).set({ createdAt: new Date(now.getTime() - 31 * 24 * 60 * 60_000) }).where(eq(turnTrace.id, rows[0].id));
      expect((await list({ quoteId: detail.id })).traces.map((row) => row.id)).toEqual([rows[2].id, rows[1].id]);
    });

    it("reads one Turn Trace with its User, business and Quote, until it expires or its Quote is deleted", async () => {
      const detail = await listedDraft();
      await sendAs(scriptedModel([response("Noté.")]), detail);
      const [{ id }] = await database.select({ id: turnTrace.id }).from(turnTrace).where(eq(turnTrace.quoteId, detail.id));

      const trace = await readTurnTrace(database, administrator.userId, id);
      expect(trace).toMatchObject({
        id, outcomeKind: "unchanged",
        user: { id: listed.userId, email: listed.email },
        quote: { id: detail.id, reference: detail.draft!.reference },
        detail: { text: "Ajoute la pose.", modelCalls: [expect.objectContaining({ sequence: 1 })] },
      });
      expect(await readTurnTrace(database, administrator.userId, id, new Date(Date.now() + 31 * 24 * 60 * 60_000))).toBeNull();
      expect(await readTurnTrace(database, administrator.userId, crypto.randomUUID())).toBeNull();

      expect((await listed.request({ action: "delete", id: detail.id, requestId: crypto.randomUUID() })).status).toBe(200);
      expect(await readTurnTrace(database, administrator.userId, id)).toBeNull();
    });

    it("refuses anyone but an Administrator", async () => {
      await expect(listTurnTraces(database, listed.userId, {})).rejects.toBeInstanceOf(AdministrationRefusal);
      await expect(readTurnTrace(database, listed.userId, crypto.randomUUID())).rejects.toBeInstanceOf(AdministrationRefusal);
    });
  });
});
