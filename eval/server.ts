import { createServer, type IncomingMessage } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BlockList } from "node:net";
import { networkInterfaces } from "node:os";
import { listRuns, readReviews, saveReview, withoutCredentials, type ReviewInput } from "./artifacts";
import { renderReport } from "./report";
import { ActiveEvaluationSessionError, beginEvaluationSession, listEvaluationSessions } from "./sessions";
import { createEvaluationPlan, selectEvaluationScenarios, startEvaluation } from "./execution";
import { assertLivePricing, createLiveSession } from "./live";
import { parseSpendUsd } from "./spend";
import { configuredQuoteAI } from "../app/lib/quote-ai-config.server";
import { assertEvaluationControlUrl } from "./isolation";
import pg from "pg";
import type { DashboardStatus } from "./report";
import type { EvaluationSessionRecord, Scenario } from "./types";

async function formBody(request: IncomingMessage): Promise<URLSearchParams> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") throw new Error("Invalid form.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_000) throw new Error("Form too large.");
    chunks.push(Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
const privateNetworks = new BlockList();
for (const [network, prefix] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10]] as const) {
  privateNetworks.addSubnet(network, prefix);
}
function privateAddress(address: string): boolean {
  return privateNetworks.check(address.replace(/^::ffff:/, ""));
}
export function privateReviewAddresses(): string[] {
  return [...new Set(Object.values(networkInterfaces()).flatMap(entries => (entries ?? [])
    .filter(entry => entry.family === "IPv4" && !entry.internal && privateAddress(entry.address))
    .map(entry => entry.address)))];
}
class FormProblem extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function browserSelection(form: URLSearchParams) {
  const allowed = ["requestId", "scenario", "suite", "repetitions", "reasoning", "maxOutputTokens", "maxCalls", "maxElapsedMs", "maxSpendUsd"];
  for (const key of form.keys()) {
    if (!allowed.includes(key)) throw new FormProblem("Unsupported launch field. Credentials and configuration belong on the server.");
    if (key !== "scenario" && form.getAll(key).length !== 1) throw new FormProblem("Launch settings must not be repeated.");
  }
  const requestId = form.get("requestId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new FormProblem("A UUID requestId is required. Reload the launch form.");
  const suite = form.get("suite") || undefined;
  if (suite !== undefined && suite !== "contract" && suite !== "scenario") throw new FormProblem("Select the contract or scenario suite.");
  const ids = form.getAll("scenario");
  if (!ids.length && !suite) throw new FormProblem("Select at least one scenario or a suite.");
  let selected: Scenario[];
  try { selected = selectEvaluationScenarios(ids, suite, true); }
  catch { throw new FormProblem("Select known scenarios once, within the chosen suite. Controlled-only scenarios cannot run live."); }
  const integer = (key: string, maximum: number, fallback?: string) => {
    const value = form.get(key) ?? fallback ?? "";
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) throw new FormProblem(`${key} must be an integer from 1 to ${maximum}.`);
    return Number(value);
  };
  const repetitions = integer("repetitions", 1000, "1");
  const reasoning = form.get("reasoning");
  if (reasoning !== "minimal" && reasoning !== "low" && reasoning !== "medium" && reasoning !== "high") throw new FormProblem("Choose minimal, low, medium or high reasoning. This Google model cannot disable reasoning.");
  const generation = { reasoning, maxOutputTokens: integer("maxOutputTokens", 4096, "4096") };
  let maxSpendUsd: number;
  try { maxSpendUsd = parseSpendUsd(form.get("maxSpendUsd") ?? "").usd; }
  catch { throw new FormProblem("maxSpendUsd must be positive, at most 1000000, with at most nine decimals."); }
  const limits = { maxCalls: integer("maxCalls", 10_000), maxElapsedMs: integer("maxElapsedMs", 3_600_000), maxSpendUsd };
  const fingerprint = createHash("sha256").update(JSON.stringify({ scenarios: selected.map(scenario => scenario.id), repetitions, generation, limits })).digest("hex");
  return { selected, repetitions, generation, limits, browserRequest: { id: requestId.toLowerCase(), fingerprint } };
}
const providerProblems = {
  model: "Set QUOTE_AI_PROVIDER=google and QUOTE_AI_MODEL=gemini-3.5-flash-lite in the server environment, then restart the evaluator.",
  credential: "Set GEMINI_API_KEY in the server environment, then restart the evaluator. Never enter credentials in the browser.",
  configuration: "Check the server provider configuration. QUOTE_AI_TIMEOUT_MS must be an integer from 1000 to 45000.",
  pricing: "The Google pricing review is outside its valid dates. Recheck the documented rates and bounds before launching.",
};
/** Only fixed, actionable messages reach the browser. Never echo environment values. */
function providerProblem(environment: Record<string, string | undefined>): string | undefined {
  if (environment.QUOTE_AI_PROVIDER?.trim() !== "google" || environment.QUOTE_AI_MODEL?.trim() !== "gemini-3.5-flash-lite") return providerProblems.model;
  if (!environment.GEMINI_API_KEY?.trim()) return providerProblems.credential;
  try { configuredQuoteAI(environment); } catch { return providerProblems.configuration; }
  try { assertLivePricing(); } catch { return providerProblems.pricing; }
}
function publicSession(record: EvaluationSessionRecord): EvaluationSessionRecord {
  const safe = JSON.parse(JSON.stringify(record, withoutCredentials)) as EvaluationSessionRecord;
  const reason = safe.state.reason;
  if (reason && !/^[a-z][a-z0-9_]{0,63}$/.test(reason) && !Object.values(providerProblems).includes(reason)) {
    safe.state.reason = "Execution failed. Check the dedicated evaluation database and server configuration.";
  }
  return safe;
}
type ExecutionControl = {
  providerProblem(): string | undefined;
  launch(form: URLSearchParams): string;
  stop(id: string): void;
};
type ReportServerOptions = { root: string; scenarios: Scenario[]; networkAccess?: boolean; dashboardStatus?: DashboardStatus | (() => Promise<DashboardStatus>) };
export function createEvaluatorServer({ root, scenarios, databaseUrl, networkAccess = false }: {
  root: string; scenarios: Scenario[]; databaseUrl: string; networkAccess?: boolean;
}) {
  assertEvaluationControlUrl(databaseUrl);
  listEvaluationSessions(root); // Reconcile interrupted attempts before the first request.
  // The isolated product runner temporarily sets process.env for module setup.
  // Capture only server-owned provider fields before any task can change them.
  const environment = Object.fromEntries(["QUOTE_AI_PROVIDER", "QUOTE_AI_MODEL", "GEMINI_API_KEY", "QUOTE_AI_TIMEOUT_MS"].map(key => [key, process.env[key]]));
  const tasks = new Map<string, ReturnType<typeof startEvaluation>>();
  let closing = false;
  const execution: ExecutionControl = {
    providerProblem: () => providerProblem(environment),
    launch(form) {
      if (closing) throw new FormProblem("The evaluator is shutting down. Restart it before launching.", 503);
      const input = browserSelection(form);
      const previousId = () => {
        const previous = listEvaluationSessions(root).find(record => record.plan.browserRequest?.id === input.browserRequest.id);
        if (!previous) return;
        if (previous.plan.browserRequest?.fingerprint !== input.browserRequest.fingerprint) throw new FormProblem("This requestId already authorized different settings. Reload the launch form for a new request.", 409);
        return previous.plan.id;
      };
      const previous = previousId();
      if (previous) return previous;
      if (listEvaluationSessions(root).some(record => ["starting", "running"].includes(record.state.status))) throw new ActiveEvaluationSessionError();
      const problem = providerProblem(environment);
      let live: ReturnType<typeof createLiveSession> | undefined;
      try {
        if (problem) throw new Error("provider_unavailable");
        const boundary = configuredQuoteAI(environment);
        live = createLiveSession({ modelBoundary: boundary, scenarios: input.selected, approvedProviderDataReview: true,
          ...input.limits, generation: input.generation, artifactRoot: root });
        const task = startEvaluation({ artifactRoot: root, databaseUrl, scenarios: input.selected, repetitions: input.repetitions,
          boundary, live, mode: "live", settings: { requested: input.generation, effective: live.effectiveGeneration },
          authorization: "browser-start", browserRequest: input.browserRequest });
        tasks.set(task.id, task);
        void task.completion.then(() => tasks.delete(task.id), () => tasks.delete(task.id));
        return task.id;
      } catch (error) {
        live?.close();
        // Another process may have claimed this key after our initial read.
        const raced = previousId();
        if (raced) return raced;
        if (error instanceof ActiveEvaluationSessionError) throw error;
        // Configuration failures are attempts too. Preserve their selection and
        // authorization, without claiming unvalidated effective settings.
        const plan = createEvaluationPlan({
          scenarios: input.selected, repetitions: input.repetitions, mode: "live", browserRequest: input.browserRequest,
          model: { provider: "google", id: "gemini-3.5-flash-lite", requested: input.generation, effective: {} },
          authorization: "browser-start", limits: input.limits,
        });
        try { beginEvaluationSession(root, plan).fail(problem ?? "execution_failed"); }
        catch (failure) {
          const raced = previousId();
          if (raced) return raced;
          throw failure;
        }
        return plan.id;
      }
    },
    stop(id) {
      const record = listEvaluationSessions(root).find(record => record.plan.id === id);
      if (!record) throw new FormProblem("Session not found.", 404);
      const task = tasks.get(id);
      if (!task && ["starting", "running"].includes(record.state.status)) throw new FormProblem("This session belongs to another evaluator process. Stop it from its owning server.", 409);
      task?.cancel();
    },
  };
  const server = createReportServer({ root, scenarios, networkAccess, execution, dashboardStatus: async () => {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000, query_timeout: 2000 });
    const provider = providerProblem(environment) ? "unavailable" : "available";
    try {
      await client.connect();
      await client.query("SELECT 1");
      return { database: "ready", provider };
    } catch {
      return { database: "unavailable", provider };
    } finally { await client.end().catch(() => {}); }
  } });
  const close = server.close.bind(server);
  server.close = callback => {
    closing = true;
    const pending = [...tasks.values()];
    for (const task of pending) task.cancel("server_shutdown");
    close(error => { void Promise.allSettled(pending.map(task => task.completion)).then(() => callback?.(error)); });
    return server;
  };
  return server;
}

export function createReviewServer(options: ReportServerOptions) { return createReportServer(options); }
function createReportServer({ root, scenarios, networkAccess = false, dashboardStatus, execution }: ReportServerOptions & { execution?: ExecutionControl }) {
  // Exact local interface addresses prevent accepting arbitrary DNS Host names.
  const allowedAddresses = ["127.0.0.1", "localhost", "[::1]", ...(networkAccess ? privateReviewAddresses() : [])];
  return createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "same-origin");
    response.setHeader("content-security-policy", `default-src 'none'; style-src 'self'; ${execution ? "script-src 'self'; connect-src 'self'; " : ""}form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    const host = request.headers.host ?? "";
    const address = request.socket.localPort;
    const peer = request.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "";
    const trustedPeer = peer === "127.0.0.1" || peer === "::1" || (networkAccess && privateAddress(peer));
    if (!trustedPeer || !allowedAddresses.some(allowed => host === `${allowed}:${address}`)) {
      response.writeHead(403).end("Trusted local or private-network address required."); return;
    }
    try {
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (!["GET", "HEAD"].includes(request.method ?? "") && (request.headers.origin !== `http://${host}` || request.headers["sec-fetch-site"] === "cross-site")) {
        response.writeHead(403).end("Same-origin form required."); return;
      }
      const json = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(value, withoutCredentials)); };
      if (execution && request.method === "GET" && url.pathname === "/execution.js") {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.end(await readFile(new URL("./execution-client.js", import.meta.url), "utf8")); return;
      }
      if (execution && request.method === "POST" && url.pathname === "/sessions") {
        json(202, { id: execution.launch(await formBody(request)) }); return;
      }
      const sessionRoute = /^\/sessions\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})(\/stop)?$/.exec(url.pathname);
      if (execution && sessionRoute) {
        const [, id, stop] = sessionRoute;
        if (request.method === "GET" && !stop) {
          const record = listEvaluationSessions(root).find(record => record.plan.id === id);
          if (!record) throw new FormProblem("Session not found.", 404);
          json(200, publicSession(record)); return;
        }
        if (request.method === "POST" && stop) {
          if ((await formBody(request)).size) throw new FormProblem("Stop accepts an empty form only.");
          execution.stop(id); json(200, { id }); return;
        }
      }
      if (request.method === "GET" && url.pathname === "/report.css") {
        response.setHeader("content-type", "text/css; charset=utf-8");
        response.end(await readFile(new URL("./report.css", import.meta.url), "utf8")); return;
      }
      if (request.method === "POST" && url.pathname === "/reviews") {
        const form = await formBody(request);
        const runId = form.get("runId") ?? "";
        const input = Object.fromEntries(["scenarioHash", "reviewer", "wording", "inventedFacts", "clarification", "notes"].map(key => [key, form.get(key)]));
        await saveReview(root, runId, input as ReviewInput);
        response.writeHead(303, { location: `/?run=${encodeURIComponent(runId)}#human-review` }).end(); return;
      }
      if (request.method !== "GET" || url.pathname !== "/") { response.writeHead(404).end("Not found."); return; }
      const runs = await listRuns(root);
      const runId = url.searchParams.get("run") ?? undefined;
      if (runId && !runs.some(run => run.id === runId)) { response.writeHead(404).end("Run not found."); return; }
      response.setHeader("content-type", "text/html; charset=utf-8");
      const historyView = !runId && (!url.searchParams.has("scenario") || url.searchParams.has("outcome") || url.searchParams.has("mode") || url.searchParams.has("view"));
      const reviewsByRun = historyView ? Object.fromEntries(await Promise.all(runs.map(async run => [run.id, await readReviews(root, run.id)] as const))) : undefined;
      const sessions = listEvaluationSessions(root).map(publicSession);
      const reuseId = execution ? url.searchParams.get("reuse") : null;
      const sessionId = execution ? url.searchParams.get("session") ?? undefined : undefined;
      const reuseSession = reuseId ? sessions.find(record => record.plan.id === reuseId) : undefined;
      if (reuseId && !reuseSession || sessionId && !sessions.some(record => record.plan.id === sessionId)) throw new FormProblem("Session not found.", 404);
      const launchView = Boolean(execution && (url.searchParams.get("launch") === "1" || reuseSession));
      const executionInput = execution ? { executionEnabled: true, launchView, reuseSession, sessionId, launchRequestId: launchView ? randomUUID() : undefined, providerProblem: execution.providerProblem() } : {};
      response.end(renderReport({ scenarios, runs, sessions, ...executionInput, dashboardStatus: typeof dashboardStatus === "function" ? await dashboardStatus() : dashboardStatus, runId, scenarioId: url.searchParams.get("scenario") ?? undefined,
        outcome: url.searchParams.get("outcome") ?? undefined, mode: url.searchParams.get("mode") ?? undefined,
        historyView, reviewsByRun,
        reviews: runId ? await readReviews(root, runId) : [] }));
    } catch (error) {
      // Only locally authored validation messages may cross this boundary.
      if (error instanceof FormProblem || error instanceof ActiveEvaluationSessionError) {
        response.writeHead(error instanceof ActiveEvaluationSessionError ? 409 : error.status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: error.message })); return;
      }
      response.writeHead(400).end("Unable to read the report or save this request. Check the artifact and scenario version.");
    }
  });
}
