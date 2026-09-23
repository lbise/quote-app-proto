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
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
const id = "example/browser-tool-model";
const unusable = "example/no-tools";
const entry = { id, name: "Browser tool model", context_length: 65536,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools", "max_tokens", "reasoning"],
  reasoning: { mandatory: false, supported_efforts: ["none", "low"] } };

test.beforeAll(async () => {
  process.env.OPENROUTER_API_KEY = "browser-test-secret";
  globalThis.fetch = async input => {
    const path = String(input);
    if (path === "https://openrouter.ai/api/v1/models") return Response.json({ data: [entry,
      { ...entry, id: unusable, name: "No tools", supported_parameters: [] }] });
    if (path === `https://openrouter.ai/api/v1/models/${id}/endpoints`) return Response.json({ data: { id, endpoints: [{
      model_id: id, name: "Provider endpoint", provider_name: "Provider", status: 0,
      context_length: 65536, max_completion_tokens: 2048,
      supported_parameters: ["tools", "max_tokens", "reasoning"], supports_implicit_caching: false,
      pricing: { prompt: "0.000001", completion: "0.000002", request: "0.0001" },
    }] } });
    throw new Error("No generation request is expected in this browser test.");
  };
  root = await mkdtemp(join(tmpdir(), "eval-openrouter-browser-"));
  server = createEvaluatorServer({ root, scenarios, databaseUrl: process.env.EVAL_DATABASE_URL! });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  await rm(root, { recursive: true, force: true });
});

test("shows unavailable models and verifies reasoning Off before enabling Start", async ({ page }) => {
  await page.goto(`${url}/?launch=1&scenario=contract-fixed-line`);
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  // Playwright's disabled check retargets options inside a label to their enabled select.
  await expect(model.locator(`option[value="${unusable}"]`)).toHaveJSProperty("disabled", true);
  await expect(model.locator(`option[value="${unusable}"]`)).toContainText(/unavailable.*tools/i);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await model.selectOption(id);
  await expect(page.getByRole("status").filter({ hasText: "Off is available" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Reasoning", exact: true }).locator("option")).toHaveText(["Off", "low"]);
  await expect(page.getByRole("combobox", { name: "Reasoning", exact: true })).toHaveValue("off");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "Reasoning", exact: true }).selectOption("low");
  await expect(page.getByRole("combobox", { name: "Reasoning", exact: true })).toHaveValue("low");
});
