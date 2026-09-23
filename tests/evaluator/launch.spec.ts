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
  Object.assign(process.env, { QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "" });
  root = await mkdtemp(join(tmpdir(), "eval-launch-browser-"));
  server = createEvaluatorServer({ root, scenarios, databaseUrl: process.env.EVAL_DATABASE_URL! });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
  for (const key of ["QUOTE_AI_PROVIDER", "QUOTE_AI_MODEL", "GEMINI_API_KEY"]) {
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
  await page.getByLabel("Reasoning", { exact: true }).selectOption("high");
  await expect(page.getByLabel("Reasoning", { exact: true })).toHaveValue("high");
  await expect(page.getByLabel("Reasoning", { exact: true }).locator("option")).toHaveText(["Minimal", "Low", "Medium", "High"]);
  await page.getByLabel("Repetitions").fill("2");
  await expect(page.getByTestId("selection-summary")).toHaveText("1 scenario × 2 repetitions = 2 planned Scenario Runs.");
  await page.getByRole("checkbox", { name: "Quantité et prix unitaire fictifs", exact: true }).check();
  await expect(page.getByTestId("selection-summary")).toHaveText("2 scenarios × 2 repetitions = 4 planned Scenario Runs.");
  await page.getByLabel("Selection", { exact: true }).selectOption("scenario");
  await expect(page.getByText(/This selection includes controlled-only cases/)).toBeVisible();
  await page.getByLabel("Selection", { exact: true }).selectOption("contract");
  await expect(page.getByTestId("selection-summary")).toHaveText("5 scenarios × 2 repetitions = 10 planned Scenario Runs.");
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByLabel("Output-token limit").fill("1024");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await expect(page.getByText(/GEMINI_API_KEY/)).toBeVisible();
});
