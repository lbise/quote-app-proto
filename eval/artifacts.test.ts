import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { emptyQuote } from "../app/lib/quote";
import { listRuns, readReviews, saveReview, saveRun } from "./artifacts";
import type { EvaluationRun } from "./types";

const roots: string[] = [];
async function root() { const dir = await mkdtemp(join(tmpdir(), "quote-eval-")); roots.push(dir); return dir; }
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
function sampleRun(): EvaluationRun {
  return {
    format: "quote-evaluation/v1", id: "run-test", scenarioHash: "a".repeat(64), startedAt: "2026-09-01T00:00:00Z",
    scenario: { id: "joinery-test", version: 1, title: "Joinery review", profession: "joinery", provenance: { kind: "source-derived", alias: "joinery-cladding-reference", notes: [] }, review: { inputs: "pending", expectations: "pending", provider: "blocked", note: "Local only" }, locale: "fr", startingQuote: emptyQuote("EVAL-1"), history: [], steps: [], requiredClarification: [], forbiddenMutations: [], humanReview: [] },
    revision: { application: "test", promptTools: "test", dirty: false }, model: { provider: "faux", id: "controlled", settings: {} }, repetition: 1,
    elapsedMs: 1, usage: null, cost: { estimatedUsd: null, assumptions: "Offline", ceilingEnforceable: false }, modelCalls: 1, turns: [], automated: "passed", human: "pending",
  };
}
it("retains runs and append-only human reviews across later runs", async () => {
  const dir = await root(); const run = sampleRun();
  await saveRun(dir, run);
  expect((await listRuns(dir))[0].human).toBe("pending");
  const first = await saveReview(dir, run.id, { scenarioHash: run.scenarioHash, reviewer: "Maintainer", wording: "pass", inventedFacts: "pass", clarification: "pending", notes: "Check the missing unit question." });
  await saveReview(dir, run.id, { ...first, clarification: "pass", notes: "Reviewed." });
  await saveRun(dir, { ...run, id: "run-next" });
  expect(await readReviews(dir, run.id)).toHaveLength(2);
  expect(await readReviews(dir, "run-next")).toEqual([]);
  await expect(saveRun(dir, run)).rejects.toThrow();
});
it("rejects stale review versions and unsafe artifact identifiers", async () => {
  const dir = await root(); const run = sampleRun(); await saveRun(dir, run);
  await expect(saveReview(dir, run.id, { scenarioHash: "stale", reviewer: "Maintainer", wording: "pass", inventedFacts: "pass", clarification: "pass", notes: "" })).rejects.toThrow("different scenario version");
  await expect(saveRun(dir, { ...run, id: "../escape" })).rejects.toThrow("identifier");
});
it("excludes credential-shaped metadata from persisted artifacts", async () => {
  const dir = await root(); const run = sampleRun();
  run.model.settings = { apiKey: "secret-value", headers: { Authorization: "Bearer private" }, maxTokens: 4096 };
  await saveRun(dir, run);
  const text = await readFile(join(dir, "runs", `${run.id}.json`), "utf8");
  expect(text).not.toContain("secret-value"); expect(text).not.toContain("Bearer private");
  expect(text).toContain("4096");
});
