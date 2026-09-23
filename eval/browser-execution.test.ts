import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEvaluatorServer, createReviewServer } from "./server";
import { readRun, readReviews } from "./artifacts";
import { scenarios } from "./scenarios";
import type { EvaluationSessionRecord } from "./types";

const databaseUrl = process.env.EVAL_DATABASE_URL;
const originalFetch = globalThis.fetch;
const cleanup: Array<() => Promise<unknown>> = [];
const example = scenarios.find(scenario => scenario.suite === "contract" && scenario.execution !== "controlled-only")!;
function form(overrides: Record<string, string> = {}) {
  return new URLSearchParams({ requestId: randomUUID(), scenario: example.id, repetitions: "1", reasoning: "minimal",
    maxOutputTokens: "1024", maxCalls: "10", maxElapsedMs: "30000", maxSpendUsd: "10", ...overrides });
}
async function open(root?: string, controlUrl = databaseUrl!) {
  if (!root) { root = await mkdtemp(join(tmpdir(), "browser-execution-")); const directory = root; cleanup.push(() => rm(directory, { recursive: true, force: true })); }
  const server = createEvaluatorServer({ root, scenarios, databaseUrl: controlUrl });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let closed = false;
  const close = () => new Promise<void>((resolve, reject) => {
    if (closed) return resolve(); closed = true;
    server.close(error => error ? reject(error) : resolve());
  });
  cleanup.push(close);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { root, url, close,
    post: (path: string, body = new URLSearchParams()) => originalFetch(`${url}${path}`, { method: "POST", headers: { origin: url, "content-type": "application/x-www-form-urlencoded" }, body }),
    record: async (id: string) => await (await originalFetch(`${url}/sessions/${id}`)).json() as EvaluationSessionRecord,
  };
}
async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const result = await read(); if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Progress did not reach the expected state.");
}
function googleReply(parts: unknown[] = [{ text: "No change needed." }]) {
  return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
}

describe.runIf(Boolean(databaseUrl))("browser execution through HTTP, PostgreSQL and the product agent", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
    vi.stubEnv("QUOTE_AI_PROVIDER", "google"); vi.stubEnv("QUOTE_AI_MODEL", "gemini-3.5-flash-lite"); vi.stubEnv("GEMINI_API_KEY", "browser-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external provider request"); }));
  });
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });

  it.each([
    { maxSpendUsd: "4.1", calls: 1 }, { maxSpendUsd: "8.2", calls: 1 }, { maxSpendUsd: "16.4", calls: 1 },
    { maxSpendUsd: "0.000000001", calls: 0 }, { maxSpendUsd: "1000000", calls: 1 },
  ])("accepts a decimal USD limit of $maxSpendUsd without binary floating-point rejection", async ({ maxSpendUsd, calls }) => {
    const network = vi.fn(async () => googleReply()); vi.stubGlobal("fetch", network);
    const app = await open();
    const response = await app.post("/sessions", form({ maxSpendUsd }));
    expect(response.status).toBe(202);
    const { id } = await response.json() as { id: string };
    const record = await eventually(() => app.record(id), record => !["starting", "running"].includes(record.state.status));
    expect(record.plan.limits?.maxSpendUsd).toBe(Number(maxSpendUsd));
    expect(record.state.status).toBe(calls ? "completed" : "stopped");
    expect(record.state.calls).toBe(calls);
    expect(network).toHaveBeenCalledTimes(calls);
  });

  it.each(["0", "-1", "0.0000000001", "1.0000000001", "1000000.000000001", "NaN", "Infinity", "1e-9"])("rejects invalid decimal USD text %s before provider access", async maxSpendUsd => {
    const app = await open();
    const response = await app.post("/sessions", form({ maxSpendUsd }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("maxSpendUsd") });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("launches promptly, persists progress after navigation, and commits a real Quote turn", async () => {
    const network = vi.fn(async () => network.mock.calls.length === 1
      ? googleReply([{ functionCall: { name: "edit_quote_details", args: { fields: { title: "Browser committed title" } } } }]) : googleReply([{ text: "Done." }]));
    vi.stubGlobal("fetch", network);
    const app = await open();
    const started = await app.post("/sessions", form());
    expect(started.status).toBe(202);
    const { id } = await started.json() as { id: string };
    expect((await app.record(id)).plan.launchAuthorization.method).toBe("browser-start");
    expect((await originalFetch(app.url)).status).toBe(200);
    const record = await eventually(() => app.record(id), result => result.state.status === "completed");
    expect(record.state.calls).toBe(2);
    expect(record.state.work).toMatchObject([{ status: "completed", runId: expect.any(String) }]);
    expect(network).toHaveBeenCalledTimes(2);
    const report = await (await originalFetch(`${app.url}/?run=${record.state.work[0].runId}`)).text();
    expect(report).toContain("Browser committed title");
    expect(report).toContain("committed");
    expect(JSON.stringify(record)).not.toContain("browser-test-key");
  });

  it.each([
    { selection: "single", reasoning: "low" },
    { selection: "subset", reasoning: "medium" },
    { selection: "suite", reasoning: "high" },
  ])("validates a $selection selection and delivers $reasoning reasoning to Google", async ({ selection, reasoning }) => {
    const payloads: Array<{ generationConfig: { maxOutputTokens: number; thinkingConfig: { thinkingLevel: string } } }> = [];
    const network = vi.fn(async (_url: unknown, init?: RequestInit) => { payloads.push(JSON.parse(String(init?.body))); return googleReply(); });
    vi.stubGlobal("fetch", network);
    const app = await open();
    const body = form({ reasoning, maxCalls: "1", maxOutputTokens: "512" }); body.delete("repetitions");
    const contractIds = scenarios.filter(scenario => scenario.suite === "contract").map(scenario => scenario.id);
    if (selection === "subset") body.append("scenario", contractIds[1]);
    if (selection === "suite") { body.delete("scenario"); body.set("suite", "contract"); }
    const response = await app.post("/sessions", body); expect(response.status).toBe(202);
    const { id } = await response.json() as { id: string };
    const record = await eventually(() => app.record(id), record => !["starting", "running"].includes(record.state.status));
    expect(record.plan.selection).toEqual({ scenarioIds: selection === "suite" ? contractIds : selection === "subset" ? contractIds.slice(0, 2) : [example.id], repetitions: 1 });
    expect(record.plan.model).toEqual({ provider: "google", id: "gemini-3.5-flash-lite", requested: { reasoning, maxOutputTokens: 512 }, effective: { reasoning, maxOutputTokens: 512 } });
    expect(record.plan.work).toHaveLength(selection === "suite" ? contractIds.length : selection === "subset" ? 2 : 1);
    expect(payloads).toMatchObject([{ generationConfig: { maxOutputTokens: 512, thinkingConfig: { thinkingLevel: reasoning.toUpperCase() } } }]);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent tabs across servers and restart, rejects conflicts, and requires a new explicit allowance for reuse", async () => {
    let release!: (response: Response) => void;
    const network = vi.fn(async () => new Promise<Response>(resolve => { release = resolve; }));
    vi.stubGlobal("fetch", network);
    const app = await open();
    const other = await open(app.root);
    const body = form();
    const launches = await Promise.all([app.post("/sessions", body), other.post("/sessions", body)]);
    expect(launches.map(response => response.status)).toEqual([202, 202]);
    const ids = await Promise.all(launches.map(response => response.json() as Promise<{ id: string }>));
    expect(ids[0]).toEqual(ids[1]);
    const { id } = ids[0];
    await eventually(() => app.record(id), record => record.state.calls === 1);
    const launchPage = await (await originalFetch(`${app.url}/?launch=1`)).text();
    expect(launchPage).not.toContain("Set QUOTE_AI_PROVIDER=google");
    const different = new URLSearchParams(body); different.set("reasoning", "high");
    expect((await other.post("/sessions", different)).status).toBe(409);
    expect((await other.post("/sessions", form())).status).toBe(409);
    release(googleReply());
    const complete = await eventually(() => app.record(id), record => record.state.status === "completed");
    expect(network).toHaveBeenCalledTimes(1);
    await app.close(); await other.close();
    const reopened = await open(app.root);
    expect(await reopened.record(id)).toEqual(complete);
    expect(await (await reopened.post("/sessions", body)).json()).toEqual({ id });
    expect(network).toHaveBeenCalledTimes(1);
    expect((await originalFetch(`${reopened.url}/?reuse=${id}`)).status).toBe(200);
    body.set("requestId", randomUUID());
    const next = await (await reopened.post("/sessions", body)).json() as { id: string };
    expect(next.id).not.toBe(id);
    await eventually(() => reopened.record(next.id), record => record.state.calls === 1);
    release(googleReply());
    const reused = await eventually(() => reopened.record(next.id), record => record.state.status === "completed");
    expect(reused.state.calls).toBe(1);
    expect(reused.state.reservedUsd).toBe(complete.state.reservedUsd);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("persists failed-to-start authorization and gives actionable configuration errors without disclosing secrets", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const network = vi.fn(async () => { throw new Error("Must not call Google"); }); vi.stubGlobal("fetch", network);
    const app = await open();
    const body = form();
    const response = await app.post("/sessions", body);
    expect(response.status).toBe(202);
    const { id } = await response.json() as { id: string };
    const failed = await app.record(id);
    expect(failed.state).toMatchObject({ status: "failed-to-start", calls: 0, reservedUsd: 0 });
    expect(failed.state.reason).toContain("Set GEMINI_API_KEY");
    expect(failed.plan.launchAuthorization.method).toBe("browser-start");
    expect(failed.plan.selection.scenarioIds).toEqual([example.id]);
    expect((await (await originalFetch(`${app.url}/?launch=1`)).text())).toContain("Set GEMINI_API_KEY");
    vi.stubEnv("GEMINI_API_KEY", "browser-test-key");
    expect(await (await app.post("/sessions", body)).json()).toEqual({ id });
    expect(network).not.toHaveBeenCalled();
    await app.close();
    const reopened = await open(app.root);
    expect(await reopened.record(id)).toEqual(failed);
    expect(await (await reopened.post("/sessions", body)).json()).toEqual({ id });
  });

  it.each([
    { name: "unsupported model", key: "QUOTE_AI_MODEL", value: "other-secret-model", expected: "Set QUOTE_AI_PROVIDER=google" },
    { name: "invalid timeout", key: "QUOTE_AI_TIMEOUT_MS", value: "other-secret-timeout", expected: "QUOTE_AI_TIMEOUT_MS must be an integer" },
    { name: "expired pricing", key: "", value: "", expected: "pricing review is outside its valid dates" },
  ])("explains $name before launch and persists an attempted start without calling the provider", async ({ key, value, expected }) => {
    if (key) vi.stubEnv(key, value); else vi.mocked(Date.now).mockReturnValue(Date.parse("2026-09-29T00:00:00Z"));
    const app = await open();
    const page = await (await originalFetch(`${app.url}/?launch=1`)).text();
    expect(page).toContain(expected);
    expect(page).not.toContain("other-secret");
    const { id } = await (await app.post("/sessions", form())).json() as { id: string };
    const record = await app.record(id);
    expect(record.state.status).toBe("failed-to-start");
    expect(record.state.reason).toContain(expected);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("retains provider failure reservations and rollback evidence but not provider error text", async () => {
    const network = vi.fn(async () => new Response(JSON.stringify({ error: { code: 401, message: "secret=external-secret /private/path https://provider.invalid/key", status: "UNAUTHENTICATED" } }), { status: 401, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", network);
    const app = await open();
    const { id } = await (await app.post("/sessions", form({ repetitions: "2" }))).json() as { id: string };
    const record = await eventually(() => app.record(id), record => record.state.status === "stopped");
    expect(record.state.calls).toBe(1);
    expect(record.state.reservedUsd).toBeGreaterThan(0);
    expect(record.state.work.map(work => work.status)).toEqual(["interrupted", "skipped"]);
    const run = await readRun(app.root, record.state.work[0].runId!);
    expect(run.turns[0].after).toEqual(run.turns[0].before);
    expect(JSON.stringify(record)).not.toMatch(/external-secret|private\/path|provider.invalid/);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([
    { limit: "calls", limits: { maxCalls: "1", maxSpendUsd: "10" }, calls: 1, completed: 1, reason: "call_limit" },
    { limit: "spend", limits: { maxCalls: "10", maxSpendUsd: "0.58" }, calls: 1, completed: 1, reason: "spend_limit" },
    { limit: "insufficient first reservation", limits: { maxCalls: "10", maxSpendUsd: "0.01" }, calls: 0, completed: 0, reason: "spend_limit" },
  ])("shares the $limit allowance across repetitions and skips remaining work", async ({ limits, calls, completed, reason }) => {
    const network = vi.fn(async () => googleReply()); vi.stubGlobal("fetch", network);
    const app = await open();
    const body = form({ repetitions: "4", ...limits });
    const { id } = await (await app.post("/sessions", body)).json() as { id: string };
    const stopped = await eventually(() => app.record(id), record => record.state.status === "stopped");
    expect(stopped.state.reason).toBe(reason);
    expect(stopped.state.calls).toBe(calls);
    expect(stopped.state.work.filter(work => work.status === "completed")).toHaveLength(completed);
    expect(stopped.state.work.filter(work => work.status === "interrupted")).toHaveLength(1);
    expect(stopped.state.work.at(-1)?.status).toBe("skipped");
    expect(network).toHaveBeenCalledTimes(calls);
  });

  it("shares one deadline across runs rather than restarting the clock", async () => {
    const network = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (network.mock.calls.length === 1) { await new Promise(resolve => setTimeout(resolve, 1500)); return googleReply(); }
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
    });
    vi.stubGlobal("fetch", network);
    const app = await open();
    const { id } = await (await app.post("/sessions", form({ repetitions: "4", maxElapsedMs: "3500" }))).json() as { id: string };
    const record = await eventually(() => app.record(id), record => record.state.status === "stopped");
    expect(record.state.reason).toBe("elapsed_limit");
    expect(record.state.work.map(work => work.status)).toEqual(["completed", "interrupted", "skipped", "skipped"]);
    expect(network).toHaveBeenCalledTimes(2);
  }, 10000);

  it("shutdown aborts and rolls back active work; reopening never resumes or retries it", async () => {
    let aborted = false;
    const network = vi.fn(async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Stopped", "AbortError")); }, { once: true });
    }));
    vi.stubGlobal("fetch", network);
    const app = await open();
    const body = form({ repetitions: "2" });
    const { id } = await (await app.post("/sessions", body)).json() as { id: string };
    await eventually(() => app.record(id), record => record.state.calls === 1);
    await app.close();
    expect(aborted).toBe(true);
    const reopened = await open(app.root);
    const record = await reopened.record(id);
    expect(record.state).toMatchObject({ status: "interrupted", reason: "server_shutdown", calls: 1 });
    expect(record.state.work.map(work => work.status)).toEqual(["interrupted", "skipped"]);
    const run = await readRun(app.root, record.state.work[0].runId!);
    expect(run.turns[0].after).toEqual(run.turns[0].before);
    expect(await (await reopened.post("/sessions", body)).json()).toEqual({ id });
    expect((await originalFetch(`${reopened.url}/?session=${id}`)).status).toBe(200);
    expect((await reopened.post(`/sessions/${id}/stop`)).status).toBe(200);
    expect(await reopened.record(id)).toEqual(record);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("reconciles a killed server from its durable ledger without resuming provider work", async () => {
    const app = await open(); await app.close();
    const source = `
      import { createEvaluatorServer } from './eval/server.ts';
      import { scenarios } from './eval/scenarios.ts';
      Date.now = () => Date.parse('2026-09-22T12:00:00Z');
      globalThis.fetch = async (url) => {
        if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) throw new Error('Unexpected transport');
        console.log(JSON.stringify({ database: new URL(process.env.DATABASE_URL).pathname.slice(1), providerCall: true }));
        return new Promise(() => {});
      };
      const server = createEvaluatorServer({ root: ${JSON.stringify(app.root)}, scenarios, databaseUrl: process.env.EVAL_DATABASE_URL });
      server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
    `;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: undefined, TEST_DATABASE_URL: undefined }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = ""; let errors = "";
    child.stdout.on("data", chunk => { output += String(chunk); }); child.stderr.on("data", chunk => { errors += String(chunk); });
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    const kill = async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; };
    cleanup.push(async () => {
      await kill();
      // A hard crash cannot run the runner's finally block. Drop only the exact
      // disposable database reported by this child's mocked provider boundary.
      const names = [...output.matchAll(/"database":"(quote_evaluation_case_[a-f0-9]{32})"/g)].map(match => match[1]);
      const pool = new pg.Pool({ connectionString: databaseUrl!, max: 1 });
      try { for (const name of new Set(names)) await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
      finally { await pool.end(); }
    });
    await eventually(async () => output, value => /"port":\d+/.test(value));
    expect(errors).toBe("");
    const port = /"port":(\d+)/.exec(output)![1];
    const url = `http://127.0.0.1:${port}`;
    const body = form({ repetitions: "3" });
    const response = await originalFetch(`${url}/sessions`, { method: "POST", headers: { origin: url, "content-type": "application/x-www-form-urlencoded" }, body });
    expect(response.status).toBe(202);
    const { id } = await response.json() as { id: string };
    await eventually(async () => output, value => value.includes('"providerCall":true'));
    const active = await (await originalFetch(`${url}/sessions/${id}`)).json() as EvaluationSessionRecord;
    expect(active.state).toMatchObject({ status: "running", calls: 1 });
    await kill();
    const reopened = await open(app.root);
    const record = await reopened.record(id);
    expect(record.state).toMatchObject({ status: "interrupted", reason: "process_interrupted", calls: 1, reservedUsd: active.state.reservedUsd });
    expect(record.state.work.map(work => work.status)).toEqual(["interrupted", "skipped", "skipped"]);
    expect(await (await reopened.post("/sessions", body)).json()).toEqual({ id });
    expect(await reopened.record(id)).toEqual(record);
    expect(output.match(/"providerCall":true/g)).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }, 15000);

  it("persists database setup failures without leaking connection details or making provider requests", async () => {
    const broken = new URL(databaseUrl!); broken.port = "1";
    const app = await open(undefined, broken.toString());
    const { id } = await (await app.post("/sessions", form())).json() as { id: string };
    const record = await eventually(() => app.record(id), record => record.state.status === "failed-to-start");
    expect(record.state.reason).toBe("execution_failed");
    expect(record.state.calls).toBe(0);
    expect(JSON.stringify(record)).not.toContain(broken.password);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects hostile hosts, cross-origin writes, untrusted configuration and invalid selections before any execution", async () => {
    const app = await open();
    const postRaw = (path: string, headers: Record<string, string>) => new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${app.url}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject); request.end(form().toString());
    });
    for (const path of ["/sessions", `/sessions/${randomUUID()}/stop`, "/reviews"]) {
      expect(await postRaw(path, { origin: "https://attacker.example" })).toBe(403);
      expect(await postRaw(path, { origin: app.url, host: "attacker.example" })).toBe(403);
      expect(await postRaw(path, { origin: app.url, "sec-fetch-site": "cross-site" })).toBe(403);
      expect(await postRaw(path, {})).toBe(403);
    }
    for (const [key, value] of Object.entries({ apiKey: "secret", databaseUrl: databaseUrl!, path: "/tmp/attack", command: "touch bad", model: "other", scenario: "unknown", suite: "unknown", repetitions: "0", reasoning: "off", maxCalls: "10001", maxElapsedMs: "3600001", maxSpendUsd: "0", maxOutputTokens: "4097", requestId: "not-a-uuid" })) {
      const body = form(); body.set(key, value);
      const response = await app.post("/sessions", body);
      expect(response.status, key).toBe(400);
      expect(await response.text()).not.toContain("browser-test-key");
    }
    const duplicates = form(); duplicates.append("reasoning", "high");
    expect((await app.post("/sessions", duplicates)).status).toBe(400);
    const repeatedScenario = form(); repeatedScenario.append("scenario", example.id);
    expect((await app.post("/sessions", repeatedScenario)).status).toBe(400);
    const controlled = scenarios.find(scenario => scenario.execution === "controlled-only")!;
    expect((await app.post("/sessions", form({ scenario: controlled.id }))).status).toBe(400);
    const noSelection = form(); noSelection.delete("scenario");
    expect((await app.post("/sessions", noSelection)).status).toBe(400);
    expect((await app.post(`/sessions/${randomUUID()}/stop`, new URLSearchParams({ command: "bad" }))).status).toBe(400);
    expect((await originalFetch(`${app.url}/sessions/missing`)).status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps review-only servers free of execution routes, controls and script permissions", async () => {
    const app = await open();
    const server = createReviewServer({ root: app.root, scenarios });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const page = await originalFetch(`${url}/?launch=1`);
    expect(page.headers.get("content-security-policy")).not.toContain("script-src");
    expect(await page.text()).not.toContain('id="launch-form"');
    for (const path of ["/sessions", "/sessions/missing/stop"]) {
      expect((await originalFetch(`${url}${path}`, { method: "POST", headers: { origin: url, "content-type": "application/x-www-form-urlencoded" }, body: form() })).status).toBe(404);
    }
    expect((await originalFetch(`${url}/execution.js`)).status).toBe(404);
    const evaluatorPage = await originalFetch(app.url);
    expect(evaluatorPage.headers.get("content-security-policy")).toContain("script-src 'self'; connect-src 'self'");
    expect((await originalFetch(`${app.url}/execution.js`)).status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps completed evidence, rolls back the interrupted Quote turn and makes Stop idempotent", async () => {
    let aborted = false;
    const network = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const call = network.mock.calls.length;
      if (call === 1 || call === 3) return googleReply([{ functionCall: { name: "edit_quote_details", args: { fields: { title: "Only a completed turn may commit" } } } }]);
      if (call === 2) return googleReply([{ text: "Done." }]);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
      });
    });
    vi.stubGlobal("fetch", network);
    const app = await open();
    const body = form({ repetitions: "3" });
    const { id } = await (await app.post("/sessions", body)).json() as { id: string };
    const running = await eventually(() => app.record(id), record => record.state.calls === 4);
    expect(running.state.work.map(work => work.status)).toEqual(["completed", "running", "missing"]);
    expect(running.state.activeWorkId).toBe(running.plan.work[1].id);
    expect((await app.post(`/sessions/${id}/stop`)).status).toBe(200);
    expect((await app.post(`/sessions/${id}/stop`)).status).toBe(200);
    const stopped = await eventually(() => app.record(id), record => record.state.status === "stopped");
    expect(stopped.state.work.map(work => work.status)).toEqual(["completed", "interrupted", "skipped"]);
    expect(stopped.state.calls).toBe(4);
    expect(stopped.state.reservedUsd).toBe(running.state.reservedUsd);
    expect(aborted).toBe(true);
    const completed = await readRun(app.root, stopped.state.work[0].runId!);
    const interrupted = await readRun(app.root, stopped.state.work[1].runId!);
    expect(completed.turns[0]).toMatchObject({ outcome: "committed", after: { title: "Only a completed turn may commit" } });
    expect(interrupted.turns[0].after).toEqual(interrupted.turns[0].before);
    expect(interrupted.live?.stopReason).toBe("user_stop");
    expect(network).toHaveBeenCalledTimes(4);
    expect(await readReviews(app.root, completed.id)).toEqual([]);
    expect(completed.scenario.review).toEqual(example.review);
  });
});
