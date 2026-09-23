import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { BlockList } from "node:net";
import { networkInterfaces } from "node:os";
import { listRuns, readReviews, saveReview, type ReviewInput } from "./artifacts";
import { renderReport } from "./report";
import { listEvaluationSessions } from "./sessions";
import { assertEvaluationControlUrl } from "./isolation";
import pg from "pg";
import type { DashboardStatus } from "./report";
import type { Scenario } from "./types";

async function formBody(request: IncomingMessage): Promise<URLSearchParams> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") throw new Error("Invalid form.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_000) throw new Error("Review too large.");
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
export function createEvaluatorServer({ root, scenarios, databaseUrl, networkAccess = false, providerAvailable = false }: {
  root: string; scenarios: Scenario[]; databaseUrl: string; networkAccess?: boolean; providerAvailable?: boolean;
}) {
  assertEvaluationControlUrl(databaseUrl);
  listEvaluationSessions(root); // Reconcile interrupted attempts before the first request.
  return createReviewServer({ root, scenarios, networkAccess, dashboardStatus: async () => {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000, query_timeout: 2000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return { database: "ready", provider: providerAvailable ? "available" : "unavailable" };
    } catch {
      return { database: "unavailable", provider: providerAvailable ? "available" : "unavailable" };
    } finally { await client.end().catch(() => {}); }
  } });
}

export function createReviewServer({ root, scenarios, networkAccess = false, dashboardStatus }: { root: string; scenarios: Scenario[]; networkAccess?: boolean; dashboardStatus?: DashboardStatus | (() => Promise<DashboardStatus>) }) {
  // Exact local interface addresses prevent accepting arbitrary DNS Host names.
  const allowedAddresses = ["127.0.0.1", "localhost", "[::1]", ...(networkAccess ? privateReviewAddresses() : [])];
  return createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "same-origin");
    response.setHeader("content-security-policy", "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const host = request.headers.host ?? "";
    const address = request.socket.localPort;
    const peer = request.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "";
    const trustedPeer = peer === "127.0.0.1" || peer === "::1" || (networkAccess && privateAddress(peer));
    if (!trustedPeer || !allowedAddresses.some(allowed => host === `${allowed}:${address}`)) {
      response.writeHead(403).end("Trusted local or private-network address required."); return;
    }
    try {
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/report.css") {
        response.setHeader("content-type", "text/css; charset=utf-8");
        response.end(await readFile(new URL("./report.css", import.meta.url), "utf8")); return;
      }
      if (request.method === "POST" && url.pathname === "/reviews") {
        if (request.headers.origin !== `http://${host}` || request.headers["sec-fetch-site"] === "cross-site") {
          response.writeHead(403).end("Same-origin review form required."); return;
        }
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
      response.end(renderReport({ scenarios, runs, sessions: listEvaluationSessions(root), dashboardStatus: typeof dashboardStatus === "function" ? await dashboardStatus() : dashboardStatus, runId, scenarioId: url.searchParams.get("scenario") ?? undefined,
        outcome: url.searchParams.get("outcome") ?? undefined, mode: url.searchParams.get("mode") ?? undefined,
        historyView, reviewsByRun,
        reviews: runId ? await readReviews(root, runId) : [] }));
    } catch {
      // Do not disclose filesystem paths or arbitrary provider errors to the browser.
      response.writeHead(400).end("Unable to read the report or save this review. Check the artifact and scenario version.");
    }
  });
}
