import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { createEvaluatorServer } from "../../eval/server";
import { saveReview, saveRun } from "../../eval/artifacts";
import { emptyQuote } from "../../app/lib/quote";
import type { EvaluationRun, EvaluationSessionPlan, EvaluationSessionState, Scenario } from "../../eval/types";

const hash = "b".repeat(64);
const scenario: Scenario = {
  id: "delete-browser-case", title: "Deletion browser case", version: 1, profession: "joinery", locale: "fr",
  provenance: { kind: "synthetic-edge", alias: "test-only", notes: [] },
  review: { inputs: "pending", expectations: "pending", provider: "blocked", note: "No provider calls" },
  startingQuote: emptyQuote("EVAL-DELETE"), history: [], steps: [], requiredClarification: [], forbiddenMutations: [], humanReview: [],
};
const run = (id: string, repetition: number, sessionId?: string): EvaluationRun => ({
  format: "quote-evaluation/v1", id, sessionId, scenario, scenarioHash: hash, startedAt: "2026-09-22T10:00:00Z",
  revision: { application: "fixture", promptTools: "fixture", dirty: false }, model: { provider: "faux", id: "controlled", settings: {} },
  repetition, elapsedMs: 10, usage: null, cost: { estimatedUsd: null, assumptions: "Offline fixture", ceilingEnforceable: false },
  modelCalls: 0, turns: [], automated: "passed", human: "pending",
});
const sessionPlan = (id: string, createdAt: string, work: string[]): EvaluationSessionPlan => ({
  format: "quote-evaluation-session/v1", id, createdAt, mode: "offline-smoke",
  selection: { scenarioIds: [scenario.id], repetitions: work.length }, model: { provider: "faux", id: `controlled-${id}`, requested: {}, effective: {} },
  launchAuthorization: { method: "explicit-cli-launch", at: createdAt, scenarioHashes: [hash] }, limits: null, pricing: null,
  work: work.map((workId, index) => ({ id: workId, scenarioId: scenario.id, scenarioHash: hash, repetition: index + 1 })),
});
const finished = (work: string[]): EvaluationSessionState => ({ status: "completed", startedAt: "2026-09-22T10:00:00Z", finishedAt: "2026-09-22T10:00:05Z",
  calls: 2, reservedUsd: 0, work: work.map(id => ({ id, status: "completed", runId: id })) });

let root: string;
let url: string;
let server: Server;
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eval-delete-browser-"));
  await mkdir(join(root, "sessions"));
  await mkdir(join(root, "live-sessions"));
  for (const [plan, runs] of [[sessionPlan("session-keep", "2026-09-22T10:00:00Z", ["keep-1", "keep-2"]), ["keep-1", "keep-2"]], [sessionPlan("session-drop", "2026-09-21T10:00:00Z", ["drop-1"]), ["drop-1"]]] as const) {
    await writeFile(join(root, "sessions", `${plan.id}.plan.json`), JSON.stringify(plan));
    await writeFile(join(root, "sessions", `${plan.id}.state.json`), JSON.stringify(finished([...runs])));
    await writeFile(join(root, "live-sessions", `${plan.id}.jsonl`), `{"sessionId":"${plan.id}"}\n`);
    for (const [index, id] of runs.entries()) await saveRun(root, run(id, index + 1, plan.id));
  }
  await saveRun(root, run("legacy-browser-run", 1));
  for (const id of ["keep-1", "keep-2", "drop-1", "legacy-browser-run"]) {
    await saveReview(root, id, { scenarioHash: hash, reviewer: "Browser reviewer", wording: "pass", inventedFacts: "pass", clarification: "pass", notes: "Fixture review" });
  }
  server = createEvaluatorServer({ root, scenarios: [scenario], databaseUrl: process.env.EVAL_DATABASE_URL!, providerEnvironment: {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
});

test("deletes one Scenario Run from the dashboard after a distinct confirmation and shows the session as incomplete", async ({ page }) => {
  const ledger = await readFile(join(root, "live-sessions", "session-keep.jsonl"), "utf8");
  await page.goto(url);
  const card = page.locator("article.session").filter({ hasText: "controlled-session-keep" });
  await card.getByText("Scenario Runs (2) and session details").click();
  await card.getByRole("link", { name: "Delete run Deletion browser case repetition 1" }).click();

  await expect(page.getByRole("heading", { name: "Delete this Scenario Run permanently?" })).toBeVisible();
  await expect(page.getByText("Repetition 1", { exact: true })).toBeVisible();
  await expect(page.getByText("keep-1", { exact: true })).toBeVisible();
  await expect(page.getByText("session-keep", { exact: true })).toBeVisible();
  await expect(page.getByText(/its 1 human review\./)).toBeVisible();
  await expect(page.getByText(/Spending records remain/)).toBeVisible();
  await expect(page.getByText(/does not refund budget/)).toBeVisible();
  await expect(page.getByText(/does not start, stop or authorize an evaluation/)).toBeVisible();
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\?run=keep-1$/);
  expect(existsSync(join(root, "runs", "keep-1.json"))).toBe(true);

  await page.getByRole("link", { name: "Delete this Scenario Run" }).click();
  await page.getByRole("button", { name: "Permanently delete Scenario Run" }).click();
  await expect(page).toHaveURL(/\?session=session-keep&deleted=run$/);
  await expect(page.getByRole("status").filter({ hasText: "Scenario Run permanently deleted" })).toBeVisible();
  await expect(page.locator("#completed-count")).toHaveText("1 / 2 Scenario Runs completed · 1 deleted; evidence incomplete");
  const rows = page.locator("#progress-work li");
  await expect(rows.nth(0)).toContainText("deleted");
  await expect(rows.nth(0).getByRole("link")).toHaveCount(0);
  await expect(rows.nth(1).getByRole("link", { name: "View result" })).toBeVisible();
  expect(existsSync(join(root, "runs", "keep-1.json"))).toBe(false);
  expect(existsSync(join(root, "reviews", "keep-1"))).toBe(false);
  expect(existsSync(join(root, "runs", "keep-2.json"))).toBe(true);
  expect(await readFile(join(root, "live-sessions", "session-keep.jsonl"), "utf8")).toBe(ledger);

  await page.getByRole("link", { name: "Sessions", exact: true }).click();
  await expect(card.getByText("Evidence incomplete: 1 of 2 planned Scenario Runs deleted.")).toBeVisible();
  await card.getByText("Scenario Runs (2) and session details").click();
  await expect(card.getByText(/Execution: deleted · Automated: deleted · Human review: deleted/)).toBeVisible();
  await page.goto(`${url}/?run=keep-1`);
  await expect(page.getByText("Scenario Run not found. It may have been deleted.")).toBeVisible();
});

test("deletes a whole session from its detail page and keeps other sessions and older runs", async ({ page }) => {
  await page.goto(`${url}/?session=session-drop`);
  await page.getByRole("link", { name: "Delete session" }).click();
  await expect(page.getByRole("heading", { name: "Delete this Evaluation Session permanently?" })).toBeVisible();
  await expect(page.getByText("faux / controlled-session-drop")).toBeVisible();
  await expect(page.getByText("1 planned Scenario Run · 1 saved Scenario Run")).toBeVisible();
  await expect(page.getByText(/1 saved Scenario Run and their 1 human review\./)).toBeVisible();
  await expect(page.getByText(/Spending records remain/)).toBeVisible();
  await page.getByRole("button", { name: "Permanently delete Evaluation Session" }).click();
  await expect(page).toHaveURL(/\?deleted=session$/);
  await expect(page.getByRole("status").filter({ hasText: "Evaluation Session permanently deleted" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "controlled-session-drop" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "controlled-session-keep" })).toBeVisible();
  await expect(page.getByRole("link", { name: "controlled · Deletion browser case", exact: true })).toBeVisible();
  expect(existsSync(join(root, "runs", "drop-1.json"))).toBe(false);
  expect(existsSync(join(root, "live-sessions", "session-drop.jsonl"))).toBe(true);
  await page.goto(`${url}/?session=session-drop`);
  await expect(page.getByText("Session not found.")).toBeVisible();
});

test("deletes an older run without session metadata from the dashboard", async ({ page }) => {
  await page.goto(url);
  const older = page.locator("li").filter({ hasText: "legacy-browser-run" });
  await older.getByRole("link", { name: /^Delete run/ }).click();
  await expect(page.getByText("Older run without a saved session")).toBeVisible();
  await expect(page.getByText(/Any separate spending ledger for this run stays unchanged/)).toBeVisible();
  await page.getByRole("button", { name: "Permanently delete Scenario Run" }).click();
  await expect(page).toHaveURL(/\?deleted=run$/);
  await expect(page.getByRole("status").filter({ hasText: "Scenario Run permanently deleted" })).toBeVisible();
  await expect(page.getByText("No older runs match.")).toBeVisible();
});
