import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { get } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createReviewServer } from "./server";
import { saveRun, readReviews } from "./artifacts";
import { emptyQuote } from "../app/lib/quote";
import type { EvaluationRun } from "./types";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
it("serves a local-only report and rejects cross-origin review writes and hostile hosts", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-report-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = createReviewServer({ root, scenarios: [] });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(await response.text()).toContain("No scenarios available");
  const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(url, { headers: { host: "attacker.example" } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject);
  });
  expect(hostileHostStatus).toBe(403);
  expect((await fetch(`${url}/reviews`, { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/x-www-form-urlencoded" }, body: "runId=test" })).status).toBe(403);
});
it("saves form judgments against one run and reads them after reopening the report", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-review-form-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const run: EvaluationRun = {
    format: "quote-evaluation/v1", id: "review-form-run", scenarioHash: "c".repeat(64), startedAt: "2026-09-01T00:00:00Z",
    scenario: { id: "review-form", title: "Review form", version: 1, profession: "joinery", locale: "fr", provenance: { kind: "synthetic-edge", alias: "report-test", notes: [] }, review: { inputs: "pending", expectations: "pending", provider: "blocked", note: "" }, startingQuote: emptyQuote("EVAL-1"), history: [], steps: [], requiredClarification: [], forbiddenMutations: [], humanReview: [] },
    revision: { application: "test", promptTools: "test", dirty: false }, model: { provider: "faux", id: "controlled", settings: {} }, repetition: 1, elapsedMs: 0, usage: null, cost: { estimatedUsd: null, assumptions: "Offline", ceilingEnforceable: false }, modelCalls: 0, turns: [], automated: "passed", human: "pending",
  };
  await saveRun(root, run);
  const server = createReviewServer({ root, scenarios: [] });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(`${url}/reviews`, { method: "POST", redirect: "manual", headers: { origin: url, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ runId: run.id, scenarioHash: run.scenarioHash, reviewer: "Maintainer", wording: "pass", inventedFacts: "pass", clarification: "pending", notes: "Check <script>unsafe()</script> wording." }) });
  expect(response.status).toBe(303);
  expect(await readReviews(root, run.id)).toMatchObject([{ reviewer: "Maintainer", clarification: "pending", scenarioHash: run.scenarioHash }]);
  const html = await (await fetch(`${url}/?run=${run.id}`)).text();
  expect(html).toContain("Human review: <strong>pending</strong>");
  expect(html).toContain("Check &lt;script&gt;unsafe()&lt;/script&gt; wording.");
});
