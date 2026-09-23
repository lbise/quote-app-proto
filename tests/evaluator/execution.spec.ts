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
let calls = 0;
let release: (() => void) | undefined;
let immediate = false;
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const originalNow = Date.now;

test.beforeAll(async () => {
  // Fixed review date and fake credentials. No external request can escape this transport.
  Date.now = () => Date.parse("2026-09-23T09:00:00Z");
  Object.assign(process.env, { QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "browser-test-key", QUOTE_AI_TIMEOUT_MS: "45000" });
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (!request.url.startsWith("https://generativelanguage.googleapis.com/")) throw new Error("Unexpected external transport");
    calls++;
    if (!immediate) await new Promise<void>((resolve, reject) => {
      release = resolve;
      const abort = () => reject(new DOMException("Cancelled", "AbortError"));
      if (request.signal.aborted) abort();
      else request.signal.addEventListener("abort", abort, { once: true });
    });
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "No changes." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  root = await mkdtemp(join(tmpdir(), "eval-execution-browser-"));
  server = createEvaluatorServer({ root, scenarios, databaseUrl: process.env.EVAL_DATABASE_URL! });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  release?.();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const key of ["QUOTE_AI_PROVIDER", "QUOTE_AI_MODEL", "GEMINI_API_KEY", "QUOTE_AI_TIMEOUT_MS"]) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
  await rm(root, { recursive: true, force: true });
});

test("Start survives navigation and tab closure, rejects competing tabs, stops, and reuses settings only on a new Start", async ({ page, context }) => {
  await page.goto(`${url}/?launch=1&scenario=contract-fixed-line`);
  await page.getByLabel("Reasoning", { exact: true }).selectOption("high");
  await page.getByLabel("Repetitions").fill("2");
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByLabel("Output-token limit").fill("1024");
  await expect(page.getByRole("checkbox", { name: /approv/i })).toHaveCount(0);
  page.on("dialog", () => { throw new Error("Start must not open a confirmation dialog"); });
  const competing = await context.newPage();
  await competing.goto(`${url}/?launch=1&scenario=contract-fixed-line`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page).toHaveURL(/\?session=/);
  const sessionUrl = page.url();
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByText("Active scenario: contract-fixed-line · repetition 1")).toBeVisible();
  await page.getByRole("link", { name: "All sessions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evaluation sessions" })).toBeVisible();
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto(sessionUrl);
  await expect(reopened.getByText("0 / 2 Scenario Runs completed")).toBeVisible();
  await competing.getByRole("button", { name: "Start", exact: true }).click();
  await expect(competing.getByRole("alert")).toContainText(/already active/i);
  expect(calls).toBe(1);
  await competing.close();

  release!();
  await expect.poll(() => calls).toBe(2);
  await expect(reopened.getByText("1 / 2 Scenario Runs completed")).toBeVisible();
  await reopened.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(reopened.locator("#execution-state")).toHaveText("stopped");
  await expect(reopened.getByText(/Cancellation does not guarantee the provider avoids charging/)).toBeVisible();
  await expect(reopened.locator("#progress-work")).toContainText("interrupted");
  await expect(reopened.getByRole("link", { name: "View result" }).first()).toBeVisible();
  await reopened.reload();
  await expect(reopened.locator("#execution-state")).toHaveText("stopped");

  await reopened.getByRole("link", { name: "Reuse selection and settings" }).click();
  await expect(reopened.getByLabel("Repetitions")).toHaveValue("2");
  await expect(reopened.getByLabel("Reasoning", { exact: true })).toHaveValue("high");
  await expect(reopened.getByLabel("Output-token limit")).toHaveValue("1024");
  await expect(reopened.locator('input[name="scenario"]:checked')).toHaveCount(1);
  expect(calls).toBe(2);
  immediate = true;
  await reopened.getByLabel("Repetitions").fill("1");
  await reopened.getByRole("button", { name: "Start", exact: true }).click();
  await expect(reopened.locator("#execution-state")).toHaveText("completed");
  expect(reopened.url()).not.toBe(sessionUrl);
  expect(calls).toBe(3);
  await expect(reopened.getByText("1 / 1 Scenario Runs completed")).toBeVisible();
});
