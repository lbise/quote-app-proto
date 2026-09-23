import type { Server } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { createEvaluatorServer, createReviewServer } from "../../eval/server";
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
let reviewServer: Server;
let reviewUrl: string;
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "eval-browser-"));
  const run: EvaluationRun = {
    format: "quote-evaluation/v1", id: "browser-run", scenario, scenarioHash: "e".repeat(64),
    startedAt: "2026-09-21T10:00:00Z", revision: { application: "fixture", promptTools: "fixture", dirty: false },
    model: { provider: "faux", id: "controlled", settings: {} }, repetition: 1, elapsedMs: 250,
    usage: null, cost: { estimatedUsd: null, assumptions: "Offline test fixture", ceilingEnforceable: false },
    modelCalls: 0, automated: "failed", human: "pending", turns: [{
      step: 0, kind: "artisan", input: "Keep the existing title.", before: scenario.startingQuote,
      after: scenario.startingQuote, message: "No changes.", outcome: "completed", failedCalls: 0, elapsedMs: 250,
      assertions: [{ category: "commercial", label: "Quote title matches", path: "title", passed: false,
        expected: "Authored reference title", actual: "Unchanged draft title" }],
    }],
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
  reviewServer = createReviewServer({ root, scenarios: [scenario] });
  await new Promise<void>(resolve => reviewServer.listen(0, "127.0.0.1", resolve));
  reviewUrl = `http://127.0.0.1:${(reviewServer.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => reviewServer.close(error => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
});

test("browse offline history, inspect a report, and save human review without a provider", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Evaluation sessions" })).toBeVisible();
  await expect(page.getByText("Database: ready")).toBeVisible();
  await page.getByText("Scenario Runs (1) and session details", { exact: true }).click();
  await expect(page.getByText("browser-session", { exact: true })).toBeVisible();
  await expect(page.getByText("Execution: skipped")).toBeVisible();
  await page.getByRole("combobox", { name: /Scenario/ }).selectOption("browser-case");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("heading", { name: "Evaluation sessions" })).toBeVisible();
  await page.getByLabel("Automated outcome").selectOption("failed");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("browser-session")).toHaveCount(0);
  await expect(page.getByText("Older runs without a saved session")).toBeVisible();
  await page.getByRole("link", { name: "controlled · Browser case", exact: true }).click();
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

for (const theme of ["light", "dark"] as const) {
  test(`uses the system ${theme} preference before a theme is chosen`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("button", { name: `Switch to ${theme === "dark" ? "light" : "dark"} theme` })).toBeVisible();
    const opposite = theme === "dark" ? "light" : "dark";
    await page.emulateMedia({ colorScheme: opposite });
    await expect(page.locator("html")).toHaveAttribute("data-theme", opposite);
  });
}

test("theme choices persist across library navigation and reload, overriding the system preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(url);
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "Scenario library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Scenario library", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: /^Browser case/ }).click();
  await expect(page.getByRole("heading", { name: "Browser case", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Sessions", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
});

test("read-only reports support themes without loading or exposing execution routes", async ({ page, request }) => {
  const browserRequests: string[] = [];
  page.on("request", request => browserRequests.push(new URL(request.url()).pathname));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${reviewUrl}/?run=browser-run`);
  await expect(page.getByRole("heading", { name: "Browser case", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("link", { name: "New evaluation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Scenario library", exact: true }).click();
  await page.getByRole("link", { name: /^Browser case/ }).click();
  await expect(page.getByRole("link", { name: "Run this scenario" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(browserRequests).toContain("/report-ui.js");
  expect(browserRequests.filter(path => /^\/(execution\.js|models|sessions)(\/|$)/.test(path))).toEqual([]);
  for (const path of ["/execution.js", "/models", "/sessions/browser-session"]) {
    expect((await request.get(`${reviewUrl}${path}`)).status()).toBe(404);
  }
  for (const path of ["/sessions", "/sessions/browser-session/stop"]) {
    expect((await request.post(`${reviewUrl}${path}`, { headers: { origin: reviewUrl }, form: {} })).status()).toBe(404);
  }
});

test("mobile failure comparisons retain column headers and a full-width caption", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}/?run=browser-run`);
  const table = page.getByRole("table", { name: "1 failed check" });
  await expect(table.getByRole("columnheader", { name: "Expected", exact: true })).toHaveCount(1);
  await expect(table.getByRole("columnheader", { name: "Actual", exact: true })).toHaveCount(1);
  await expect(table.locator('td[data-label="Expected"]')).toHaveAttribute("headers", "failed-check-0-0 failure-expected");
  await expect(table.locator('td[data-label="Actual"]')).toHaveAttribute("headers", "failed-check-0-0 failure-actual");
  await expect(table.locator(".cell-label").first()).toBeVisible();
  const width = await table.evaluate(element => element.getBoundingClientRect().width);
  const captionWidth = await table.locator("caption").evaluate(element => element.getBoundingClientRect().width);
  expect(captionWidth).toBeGreaterThan(width - 3);
});

test("keyboard failure links reveal collapsed evidence and move focus to the step", async ({ page }) => {
  await page.goto(`${url}/?run=browser-run`);
  const evidence = page.locator("#execution");
  const step = page.locator("#turn-0");
  await expect(evidence).not.toHaveAttribute("open", "");
  await expect(step).toBeHidden();
  const failures = page.getByRole("region", { name: "Failures and execution issues" });
  await expect(failures).toContainText("Quote title matches");
  await expect(failures).toContainText("Authored reference title");
  await expect(failures).toContainText("Unchanged draft title");
  const link = failures.getByRole("link", { name: "Inspect step 1", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#turn-0$/);
  await expect(evidence).toHaveAttribute("open", "");
  await expect(step).toBeVisible();
  await expect(step).toBeFocused();
  await expect(step.getByText("Keep the existing title.", { exact: true })).toBeVisible();
  // Activating the same fragment must reopen evidence after a reviewer collapses it.
  await page.getByText("Conversation and execution", { exact: true }).click();
  await expect(step).toBeHidden();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(step).toBeVisible();
  await expect(step).toBeFocused();
});
