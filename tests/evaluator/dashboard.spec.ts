import type { Server } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { createEvaluatorServer } from "../../eval/server";
import { saveRun } from "../../eval/artifacts";
import { emptyQuote } from "../../app/lib/quote";
import type { EvaluationRun, EvaluationSessionRecord, Scenario } from "../../eval/types";

const scenario: Scenario = {
  id: "browser-case", title: "Browser case", version: 2, profession: "joinery", locale: "fr",
  provenance: { kind: "synthetic-edge", alias: "test-only", notes: ["Browser fixture"] },
  review: { inputs: "pending", expectations: "pending", provider: "blocked", note: "No provider calls" },
  startingQuote: emptyQuote("EVAL-BROWSER"), history: [], steps: [],
  requiredClarification: [], forbiddenMutations: [], humanReview: [],
};
let root: string;
let url: string;
let server: Server;
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "eval-browser-"));
  const run: EvaluationRun = {
    format: "quote-evaluation/v1", id: "browser-run", scenario, scenarioHash: "e".repeat(64),
    startedAt: "2026-09-21T10:00:00Z", revision: { application: "fixture", promptTools: "fixture", dirty: false },
    model: { provider: "faux", id: "controlled", settings: {} }, repetition: 1, elapsedMs: 250,
    usage: null, cost: { estimatedUsd: null, assumptions: "Offline test fixture", ceilingEnforceable: false },
    modelCalls: 0, automated: "failed", human: "pending", turns: [],
  };
  await saveRun(root, run);
  const session: EvaluationSessionRecord = {
    plan: { format: "quote-evaluation-session/v1", id: "browser-session", createdAt: "2026-09-22T10:00:00Z", mode: "offline-smoke",
      selection: { scenarioIds: [scenario.id], repetitions: 1 }, model: { provider: "faux", id: "controlled", requested: {}, effective: {} },
      launchAuthorization: { method: "explicit-cli-launch", at: "2026-09-22T10:00:00Z", scenarioHashes: [run.scenarioHash] }, limits: null, pricing: null,
      work: [{ id: "session-run", scenarioId: scenario.id, scenarioHash: run.scenarioHash, repetition: 1 }] },
    state: { status: "completed", startedAt: "2026-09-22T10:00:00Z", finishedAt: "2026-09-22T10:00:01Z", calls: 0, reservedUsd: 0,
      work: [{ id: "session-run", status: "skipped" }] },
  };
  await mkdir(join(root, "sessions"));
  await writeFile(join(root, "sessions", "browser-session.plan.json"), JSON.stringify(session.plan));
  await writeFile(join(root, "sessions", "browser-session.state.json"), JSON.stringify(session.state));
  server = createEvaluatorServer({ root, scenarios: [scenario], databaseUrl: process.env.EVAL_DATABASE_URL! });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
});

test("browse offline history, inspect a report, and save human review without a provider", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Evaluation sessions" })).toBeVisible();
  await expect(page.getByText("Database: ready")).toBeVisible();
  await page.getByText("browser-session").click();
  await expect(page.getByText("Execution: skipped")).toBeVisible();
  await page.getByRole("combobox", { name: /Scenario/ }).selectOption("browser-case");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("heading", { name: "Evaluation sessions" })).toBeVisible();
  await page.getByLabel("Automated outcome").selectOption("failed");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("browser-session")).toHaveCount(0);
  await expect(page.getByText("Older runs without a saved session")).toBeVisible();
  await page.getByRole("link", { name: "browser-run" }).click();
  await expect(page.getByText("Execution: unavailable (older run without a session)")).toBeVisible();
  await page.getByLabel("Reviewer").fill("Browser reviewer");
  await page.getByLabel("Faithful French wording and reply language").selectOption("pass");
  await page.getByLabel("Review notes").fill("Local fixture only");
  await page.getByRole("button", { name: "Save a new review" }).click();
  await expect(page.getByText("Browser reviewer")).toBeVisible();
  await page.reload();
  await page.getByText("Browser reviewer").click();
  await expect(page.getByRole("paragraph").filter({ hasText: "Local fixture only" })).toBeVisible();
});
