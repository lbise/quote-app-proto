import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { listRuns, readReviews, saveReview, type ReviewInput } from "./artifacts";
import { renderReport } from "./report";
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
export function createReviewServer({ root, scenarios }: { root: string; scenarios: Scenario[] }) {
  return createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const host = request.headers.host ?? "";
    const address = request.socket.localPort;
    if (![ `127.0.0.1:${address}`, `localhost:${address}` ].includes(host)) {
      response.writeHead(403).end("Local host required."); return;
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
      response.end(renderReport({ scenarios, runs, runId, scenarioId: url.searchParams.get("scenario") ?? undefined, reviews: runId ? await readReviews(root, runId) : [] }));
    } catch {
      // Do not disclose filesystem paths or arbitrary provider errors to the browser.
      response.writeHead(400).end("Unable to read the report or save this review. Check the artifact and scenario version.");
    }
  });
}
