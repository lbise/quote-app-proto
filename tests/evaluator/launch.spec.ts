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

test("browse inputs, select scenarios or a suite, and configure an explicit launch", async ({ page }) => {
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
  await expect(page.getByTestId("selection-summary")).toHaveText("1 scenario × 2 repetitions = 2 planned Scenario Runs.");
  await page.getByRole("checkbox", { name: "Quantité et prix unitaire fictifs", exact: true }).check();
  await expect(page.getByTestId("selection-summary")).toHaveText("2 scenarios × 2 repetitions = 4 planned Scenario Runs.");
  await page.getByRole("combobox", { name: "Selection", exact: true }).selectOption("scenario");
  await expect(page.getByText(/This selection includes controlled-only cases/)).toBeVisible();
  await page.getByRole("combobox", { name: "Selection", exact: true }).selectOption("contract");
  await expect(page.getByTestId("selection-summary")).toHaveText("5 scenarios × 2 repetitions = 10 planned Scenario Runs.");
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByLabel("Output-token limit").fill("1024");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await expect(page.getByText(/GEMINI_API_KEY/)).toBeVisible();
  await page.locator("summary").filter({ hasText: /^OpenRouter unavailable$/ }).click();
  await expect(page.getByText(/Set OPENROUTER_API_KEY/)).toBeVisible();
});

test("search retains hidden checked scenarios and Select visible excludes hidden and controlled-only cases", async ({ page }) => {
  await page.goto(`${url}/?launch=1&scenario=contract-fixed-line`);
  const search = page.getByRole("searchbox", { name: "Search scenarios" });
  const fixed = page.locator('input[name="scenario"][value="contract-fixed-line"]');
  const quantityScenario = scenarios.find(scenario => scenario.title === "Quantité et prix unitaire fictifs")!;
  const quantity = page.getByRole("checkbox", { name: quantityScenario.title, exact: true });
  await search.fill(quantityScenario.id.toUpperCase());
  await expect(fixed).toBeHidden();
  await expect(fixed).toBeChecked();
  await expect(quantity).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page.getByRole("button", { name: "Select visible", exact: true }).click();
  await expect(quantity).toBeChecked();
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(2);
  await expect(page.getByTestId("selection-summary")).toHaveText("2 scenarios × 1 repetition = 2 planned Scenario Runs.");
  await page.getByText("Selected scenarios", { exact: true }).click();
  await expect(page.getByRole("list", { name: "Selected scenarios" }).getByRole("listitem")).toHaveCount(2);
  await search.fill("no-matching-scenario-9381");
  await expect(page.getByText("No matching scenarios. Try another search.")).toBeVisible();
  await page.getByRole("button", { name: "Select visible", exact: true }).click();
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(2);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(0);
  await expect(page.getByTestId("selection-summary")).toHaveText("0 scenarios × 1 repetition = 0 planned Scenario Runs.");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await search.fill("");
  await expect(fixed).not.toBeChecked();
  await expect(quantity).not.toBeChecked();
  await page.getByRole("button", { name: "Select visible", exact: true }).click();
  await expect(page.locator('input[name="scenario"]:checked')).toHaveCount(scenarios.filter(scenario => scenario.execution !== "controlled-only").length);
  const controlled = page.locator('input[name="scenario"][data-controlled="true"]');
  expect(await controlled.count()).toBeGreaterThan(0);
  for (const choice of await controlled.all()) {
    await expect(choice).toBeDisabled();
    await expect(choice).not.toBeChecked();
  }
});

test("switching suites restores the prior custom selection even while it is hidden by search", async ({ page }) => {
  await page.goto(`${url}/?launch=1&scenario=contract-fixed-line`);
  await page.getByRole("checkbox", { name: "Quantité et prix unitaire fictifs", exact: true }).check();
  const checked = page.locator('input[name="scenario"]:checked');
  const initialIds = await checked.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).sort());
  expect(initialIds).toHaveLength(2);
  await page.getByRole("searchbox", { name: "Search scenarios" }).fill("no-matching-scenario-9381");
  const suite = page.getByRole("combobox", { name: "Selection", exact: true });
  await suite.selectOption("scenario");
  await expect(page.getByText(/This selection includes controlled-only cases/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Select visible", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
  await suite.selectOption("contract");
  await expect(checked).toHaveCount(scenarios.filter(scenario => scenario.suite === "contract").length);
  await suite.selectOption("");
  await expect(checked).toHaveCount(2);
  expect(await checked.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).sort())).toEqual(initialIds);
  await expect(page.getByText(/This selection includes controlled-only cases/)).toBeHidden();
  await expect(page.getByRole("button", { name: "Select visible", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeEnabled();
  await page.getByRole("searchbox", { name: "Search scenarios" }).fill("");
  for (const choice of await checked.all()) await expect(choice).toBeEnabled();
  // A later custom edit becomes the selection restored by the next suite round trip.
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await suite.selectOption("contract");
  await suite.selectOption("");
  await expect(checked).toHaveCount(0);
});
