import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { createEvaluatorServer } from "../../eval/server";
import { scenarios } from "../../eval/scenarios";

let root: string;
let url: string;
let server: Server;
const originalEnv = { ...process.env };
test.beforeAll(async () => {
  Object.assign(process.env, { QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" });
  root = await mkdtemp(join(tmpdir(), "eval-launch-browser-"));
  server = createEvaluatorServer({ root, scenarios, databaseUrl: process.env.EVAL_DATABASE_URL! });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
  for (const key of ["QUOTE_AI_PROVIDER", "QUOTE_AI_MODEL", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});

test("browse inputs, select editable groups, and configure an explicit launch", async ({ page }) => {
  await page.goto(`${url}/?scenario=contract-fixed-line`);
  await expect(page.getByRole("heading", { name: "Expected commercial state" })).toBeVisible();
  await page.getByRole("link", { name: "Run this scenario" }).click();
  await expect(page.getByRole("heading", { name: "Start an evaluation" })).toBeVisible();
  await expect(page.getByLabel("Repetitions")).toHaveValue("1");
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: /approv/i })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Reasoning", exact: true }).selectOption("high");
  await expect(page.getByRole("combobox", { name: "Reasoning", exact: true })).toHaveValue("high");
  await expect(page.getByRole("combobox", { name: "Reasoning", exact: true }).locator("option")).toHaveText(["Minimal", "Low", "Medium", "High"]);
  await page.getByLabel("Repetitions").fill("2");
  await expect(page.getByTestId("selection-summary")).toHaveText("1 selected item × 2 repetitions = 2 planned Scenario Runs.");
  await page.getByRole("checkbox", { name: "Quantité et prix unitaire fictifs", exact: true }).check();
  await expect(page.getByTestId("selection-summary")).toHaveText("2 selected items × 2 repetitions = 4 planned Scenario Runs.");
  await page.getByRole("button", { name: "All tool tests" }).click();
  const toolCount = scenarios.filter(scenario => scenario.suite === "contract").length;
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(toolCount);
  await page.locator('input[name="scenario"][value="contract-fixed-line"]').uncheck();
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(toolCount - 1);
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByLabel("Output-token limit").fill("1024");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await expect(page.getByText(/GEMINI_API_KEY/)).toBeVisible();
  await page.locator("summary").filter({ hasText: /^OpenRouter unavailable$/ }).click();
  await expect(page.getByText(/Set OPENROUTER_API_KEY/)).toBeVisible();
});

test("quick selections add across search and stay editable", async ({ page }) => {
  await page.goto(`${url}/?launch=1&scenario=contract-fixed-line`);
  const search = page.getByRole("searchbox", { name: "Search scenarios and tool tests" });
  const fixed = page.locator('input[name="scenario"][value="contract-fixed-line"]');
  await search.fill("no-matching-scenario-9381");
  await expect(fixed).toBeHidden();
  await expect(fixed).toBeChecked();
  await expect(page.getByText("No matching scenarios. Try another search.")).toBeVisible();
  await page.getByRole("button", { name: "All scenarios" }).click();
  const liveScenarios = scenarios.filter(scenario => scenario.suite !== "contract" && scenario.execution !== "controlled-only");
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(liveScenarios.length + 1);
  await expect(page.getByRole("list", { name: "Selected scenarios" }).getByRole("listitem")).toHaveCount(liveScenarios.length + 1);
  await page.getByRole("button", { name: "All tool tests" }).click();
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(scenarios.filter(scenario => scenario.execution !== "controlled-only").length);
  await search.fill("");
  await fixed.uncheck();
  await expect(fixed).not.toBeChecked();
  const controlled = page.locator('input[name="scenario"][data-controlled="true"]');
  expect(await controlled.count()).toBeGreaterThan(0);
  for (const choice of await controlled.all()) {
    await expect(choice).toBeDisabled();
    await expect(choice).not.toBeChecked();
  }
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(0);
  await expect(page.getByTestId("selection-summary")).toHaveText("0 selected items × 1 repetition = 0 planned Scenario Runs.");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
});

test("behavior filter selects visible cases without clearing an existing selection", async ({ page }) => {
  await page.goto(`${url}/?launch=1&scenario=joinery-full-reconstruction`);
  const fullJob = page.locator('input[name="scenario"][value="joinery-full-reconstruction"]');
  const correction = page.locator('input[name="scenario"][value="joinery-panel-correction"]');
  await page.getByRole("combobox", { name: "Behavior" }).selectOption("correction");
  await expect(fullJob).toBeHidden();
  await expect(fullJob).toBeChecked();
  await expect(correction).toBeVisible();
  await page.getByRole("button", { name: "Select visible" }).click();
  await expect(correction).toBeChecked();
  await page.getByRole("combobox", { name: "Behavior" }).selectOption("safety-recovery");
  const controlled = page.locator('input[name="scenario"][value="joinery-third-failure-discard"]');
  await page.getByRole("button", { name: "Select visible" }).click();
  await expect(controlled).toBeDisabled();
  await expect(controlled).not.toBeChecked();
  await expect(fullJob).toBeChecked();
});

test("launch shows the selected types and per-run call cap without authorization clutter", async ({ page }) => {
  await page.goto(`${url}/?launch=1&scenario=contract-fixed-line`);
  await page.getByRole("checkbox", { name: scenarios.find(scenario => scenario.suite !== "contract" && scenario.execution !== "controlled-only")!.title, exact: true }).check();
  await expect(page.getByRole("list", { name: "Selected scenarios" }).getByRole("listitem")).toHaveText([
    /Tool validation test ·/, /Scenario ·/,
  ]);
  await expect(page.getByLabel("Provider calls per Scenario Run")).toHaveValue("50");
  await page.getByLabel("Session time · minutes").fill("3");
  await expect(page.locator('input[name="maxElapsedMs"]')).toHaveValue("180000");
  await expect(page.getByText("Selected to run")).toBeVisible();
  for (const copy of ["Select scenarios and configure a model.", "Offline-only fault-injection cases cannot run against a provider.", "Only Start authorizes provider calls for these selected inputs. It does not authorize Publication.", "Authorization details"]) {
    await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText("Private local report")).toHaveCount(0);
});
