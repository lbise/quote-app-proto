import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { get } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createEvaluatorServer } from "./server";
import { readReviews, saveReview, saveRun } from "./artifacts";
import { beginEvaluationSession } from "./sessions";
import { scenarios as library } from "./scenarios";
import { emptyQuote } from "../app/lib/quote";
import type { EvaluationRun, EvaluationSessionPlan, EvaluationSessionRecord, EvaluationSessionState, Scenario } from "./types";

const controlUrl = "postgres://quote_evaluation@localhost/quote_evaluation";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

const hash = "d".repeat(64);
const scenario: Scenario = {
  id: "delete-case", title: "Deletion case", version: 1, profession: "joinery", locale: "fr",
  provenance: { kind: "synthetic-edge", alias: "test-only", notes: [] },
  review: { inputs: "pending", expectations: "pending", provider: "blocked", note: "" },
  startingQuote: emptyQuote("EVAL-DELETE"), history: [], steps: [], requiredClarification: [], forbiddenMutations: [], humanReview: [],
};
function run(id: string, sessionId?: string, estimatedUsd: number | null = 0.25): EvaluationRun {
  return {
    format: "quote-evaluation/v1", id, sessionId, scenario, scenarioHash: hash, startedAt: "2026-09-22T10:00:00Z",
    revision: { application: "test", promptTools: "test", dirty: false }, model: { provider: "openrouter", id: "example/model", settings: {} },
    repetition: Number(/\d$/.exec(id)?.[0] ?? 1), elapsedMs: 10, usage: null, cost: { estimatedUsd, assumptions: "Fixture", ceilingEnforceable: true, reservedUsd: 0.5 },
    modelCalls: 1, turns: [], automated: "passed", human: "pending",
  };
}
function plan(id: string, work: string[]): EvaluationSessionPlan {
  return {
    format: "quote-evaluation-session/v1", id, createdAt: "2026-09-22T10:00:00Z", mode: "live",
    browserRequest: { id: `00000000-0000-4000-8000-${Buffer.from(id).toString("hex").padStart(12, "0").slice(-12)}`, fingerprint: "f".repeat(64) },
    selection: { scenarioIds: [scenario.id], repetitions: work.length },
    model: { provider: "openrouter", id: "example/model", requested: { reasoning: "off" }, effective: { reasoning: "off" } },
    launchAuthorization: { method: "browser-start", at: "2026-09-22T10:00:00Z", scenarioHashes: [hash] },
    limits: { maxCalls: 10, callsPerRun: 5, maxElapsedMs: 60000, maxSpendUsd: 5 }, pricing: null,
    work: work.map((workId, index) => ({ id: workId, scenarioId: scenario.id, scenarioHash: hash, repetition: index + 1 })),
  };
}
function finished(work: string[]): EvaluationSessionState {
  return { status: "completed", startedAt: "2026-09-22T10:00:00Z", finishedAt: "2026-09-22T10:01:00Z", calls: work.length, reservedUsd: 0.5 * work.length,
    work: work.map(id => ({ id, status: "completed", runId: id })) };
}
async function storeSession(root: string, sessionPlan: EvaluationSessionPlan, state: EvaluationSessionState) {
  await mkdir(join(root, "sessions"), { recursive: true });
  await writeFile(join(root, "sessions", `${sessionPlan.id}.plan.json`), JSON.stringify(sessionPlan));
  await writeFile(join(root, "sessions", `${sessionPlan.id}.state.json`), JSON.stringify(state));
  await mkdir(join(root, "live-sessions"), { recursive: true });
  await writeFile(join(root, "live-sessions", `${sessionPlan.id}.jsonl`), `{"sessionId":"${sessionPlan.id}"}\n{"scenarioHash":"${hash}","call":{"number":1,"reservedUsd":0.5,"status":"reserved"}}\n`);
}
async function review(root: string, id: string, notes = "Reviewed wording") {
  await saveReview(root, id, { scenarioHash: hash, reviewer: "Maintainer", wording: "pass", inventedFacts: "pass", clarification: "pass", notes });
}
/** Two finished sessions, one with siblings, and one older run, each reviewed. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "eval-delete-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await storeSession(root, plan("session-a", ["run-a1", "run-a2", "run-a3"]), finished(["run-a1", "run-a2", "run-a3"]));
  await storeSession(root, plan("session-b", ["run-b1"]), finished(["run-b1"]));
  for (const [id, sessionId] of [["run-a1", "session-a"], ["run-a2", "session-a"], ["run-a3", "session-a"], ["run-b1", "session-b"], ["legacy-run", undefined]] as const) {
    await saveRun(root, run(id, sessionId));
    await review(root, id);
  }
  return root;
}
async function open(root: string) {
  const server = createEvaluatorServer({ root, scenarios: [scenario], databaseUrl: controlUrl, providerEnvironment: {} });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let closed = false;
  const close = () => new Promise<void>((resolve, reject) => { if (closed) return resolve(); closed = true; server.close(error => error ? reject(error) : resolve()); });
  cleanup.push(close);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url, close,
    get: (path: string) => fetch(`${url}${path}`),
    post: (path: string, body: Record<string, string> = {}, origin = url) => fetch(`${url}${path}`, { method: "POST", redirect: "manual",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }),
    record: async (id: string) => await (await fetch(`${url}/sessions/${id}`)).json() as EvaluationSessionRecord & { evidence: unknown; estimateComplete: boolean },
  };
}
const ledger = (root: string, id: string) => readFile(join(root, "live-sessions", `${id}.jsonl`), "utf8");

it("confirms and deletes one Scenario Run and its reviews while preserving siblings, ledgers and planned denominators across reopening", async () => {
  const root = await fixture();
  const beforeLedger = await ledger(root, "session-a");
  const app = await open(root);
  const confirmation = await app.get("/runs/run-a2/delete");
  expect(confirmation.status).toBe(200);
  const page = await confirmation.text();
  expect(page).toContain("Deletion case");
  expect(page).toContain("run-a2");
  expect(page).toContain("Repetition 2");
  expect(page).toContain("1 human review");
  expect(page).toMatch(/permanently/i);
  expect(page).toMatch(/spending records remain/i);
  expect(page).toMatch(/does not refund/i);
  expect(page).not.toContain(root);

  expect((await app.post("/runs/run-a2/delete")).status).toBe(400);
  expect(existsSync(join(root, "runs", "run-a2.json"))).toBe(true);
  const deleted = await app.post("/runs/run-a2/delete", { confirm: "run-a2" });
  expect(deleted.status).toBe(303);
  expect(deleted.headers.get("location")).toBe("/?session=session-a&deleted=run");

  expect(existsSync(join(root, "runs", "run-a2.json"))).toBe(false);
  expect(existsSync(join(root, "reviews", "run-a2"))).toBe(false);
  for (const sibling of ["run-a1", "run-a3", "run-b1", "legacy-run"]) {
    expect(existsSync(join(root, "runs", `${sibling}.json`))).toBe(true);
    expect(await readReviews(root, sibling)).toHaveLength(1);
  }
  expect(await ledger(root, "session-a")).toBe(beforeLedger);
  const record = await app.record("session-a");
  expect(record.plan.work).toHaveLength(3);
  expect(record.state).toMatchObject({ status: "completed", calls: 3, reservedUsd: 1.5 });
  expect(record.state.work[1]).toEqual({ id: "run-a2", status: "deleted", deletedAt: expect.any(String) });
  expect(record.evidence).toEqual({ plannedRuns: 3, savedRuns: 2, deletedRuns: 1, incomplete: true });
  expect(record.estimateComplete).toBe(false);
  const state = await readFile(join(root, "sessions", "session-a.state.json"), "utf8");
  expect(state).not.toContain("Reviewed wording");
  expect((await stat(join(root, "sessions", "session-a.state.json"))).mode & 0o777).toBe(0o600);

  expect((await app.get("/?run=run-a2")).status).toBe(404);
  expect((await app.post("/runs/run-a2/delete", { confirm: "run-a2" })).status).toBe(404);
  const history = await (await app.get("/")).text();
  expect(history).toContain("1 of 3 planned Scenario Runs deleted");
  expect(history).toContain("Execution: deleted");
  const progress = await (await app.get("/?session=session-a&deleted=run")).text();
  expect(progress).toContain("Scenario Run permanently deleted");

  await app.close();
  const reopened = await open(root);
  expect((await reopened.record("session-a")).evidence).toEqual({ plannedRuns: 3, savedRuns: 2, deletedRuns: 1, incomplete: true });
  expect((await reopened.get("/?run=run-a2")).status).toBe(404);
  expect((await reopened.get("/?run=run-a1")).status).toBe(200);
});

it("confirms and deletes a whole session, its runs and reviews without touching its ledger or other evidence", async () => {
  const root = await fixture();
  const beforeLedger = await ledger(root, "session-a");
  const app = await open(root);
  const page = await (await app.get("/sessions/session-a/delete")).text();
  expect(page).toContain("session-a");
  expect(page).toContain("example/model");
  expect(page).toContain("3 saved Scenario Runs");
  expect(page).toContain("3 human reviews");
  expect(page).toMatch(/spending records remain/i);
  expect(page).toMatch(/does not refund/i);

  const deleted = await app.post("/sessions/session-a/delete", { confirm: "session-a" });
  expect(deleted.status).toBe(303);
  expect(deleted.headers.get("location")).toBe("/?deleted=session");
  for (const id of ["run-a1", "run-a2", "run-a3"]) {
    expect(existsSync(join(root, "runs", `${id}.json`))).toBe(false);
    expect(existsSync(join(root, "reviews", id))).toBe(false);
  }
  expect((await readdir(join(root, "sessions"))).filter(name => name.startsWith("session-a."))).toEqual(["session-a.deleted.json"]);
  const tombstone = await readFile(join(root, "sessions", "session-a.deleted.json"), "utf8");
  expect(Object.keys(JSON.parse(tombstone)).sort()).toEqual(["browserRequest", "deletedAt", "format", "id"]);
  expect((await stat(join(root, "sessions", "session-a.deleted.json"))).mode & 0o777).toBe(0o600);
  expect(await ledger(root, "session-a")).toBe(beforeLedger);
  expect(existsSync(join(root, "runs", "run-b1.json"))).toBe(true);
  expect(await readReviews(root, "run-b1")).toHaveLength(1);
  expect(existsSync(join(root, "runs", "legacy-run.json"))).toBe(true);

  expect((await app.get("/sessions/session-a")).status).toBe(404);
  expect((await app.get("/?session=session-a")).status).toBe(404);
  expect((await app.post("/sessions/session-a/delete", { confirm: "session-a" })).status).toBe(404);
  const history = await (await app.get("/?deleted=session")).text();
  expect(history).toContain("Evaluation Session permanently deleted");
  expect(history).not.toContain("run-a1");
  expect(history).toContain("session-b");
  await app.close();
  const reopened = await open(root);
  expect((await reopened.get("/sessions/session-a")).status).toBe(404);
  expect((await reopened.get("/sessions/session-b")).status).toBe(200);
});

it("deletes a legacy run without session metadata", async () => {
  const root = await fixture();
  const app = await open(root);
  const page = await (await app.get("/runs/legacy-run/delete")).text();
  expect(page).toContain("Older run without a saved session");
  const deleted = await app.post("/runs/legacy-run/delete", { confirm: "legacy-run" });
  expect(deleted.status).toBe(303);
  expect(deleted.headers.get("location")).toBe("/?deleted=run");
  expect(existsSync(join(root, "runs", "legacy-run.json"))).toBe(false);
  expect(existsSync(join(root, "reviews", "legacy-run"))).toBe(false);
  expect(existsSync(join(root, "runs", "run-a1.json"))).toBe(true);
});

it("rejects deleting an actively executing session or any of its runs", async () => {
  const root = await fixture();
  const active = beginEvaluationSession(root, { ...plan("session-live", ["run-l1", "run-l2"]), browserRequest: undefined });
  cleanup.push(async () => active.stop("test_cleanup"));
  active.running("run-l1");
  await saveRun(root, run("run-l1", "session-live"));
  active.completed("run-l1", "run-l1");
  active.running("run-l2");
  const app = await open(root);
  expect(await (await app.get("/")).text()).not.toContain("/sessions/session-live/delete");
  expect((await app.post("/sessions/session-live/delete", { confirm: "session-live" })).status).toBe(409);
  expect((await app.post("/runs/run-l1/delete", { confirm: "run-l1" })).status).toBe(409);
  expect(existsSync(join(root, "runs", "run-l1.json"))).toBe(true);
  expect(existsSync(join(root, "sessions", "session-live.plan.json"))).toBe(true);
  // Other finished evidence stays deletable while a session runs.
  expect((await app.post("/runs/run-b1/delete", { confirm: "run-b1" })).status).toBe(303);
});

it("rejects cross-origin, hostile-host, malformed and traversal deletion requests without disclosing paths", async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "eval-outside-"));
  cleanup.push(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "victim.json"), "{}");
  const app = await open(root);
  expect((await app.post("/runs/run-a1/delete", { confirm: "run-a1" }, "https://attacker.example")).status).toBe(403);
  expect((await app.post("/sessions/session-a/delete", { confirm: "session-a" }, "null")).status).toBe(403);
  const hostile = await new Promise<number | undefined>((resolve, reject) => {
    get(`${app.url}/runs/run-a1/delete`, { headers: { host: "attacker.example" } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject);
  });
  expect(hostile).toBe(403);
  for (const path of ["/runs/..%2F..%2Fvictim/delete", "/runs/%2e%2e/delete", "/runs/run-a1.json/delete", "/sessions/..%2Fsessions%2Fsession-a/delete", "/runs/-bad/delete", `/runs/${"a".repeat(129)}/delete`]) {
    const response = await app.post(path, { confirm: "x" });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(root);
  }
  for (const path of ["/runs/missing-run/delete", "/sessions/missing-session/delete"]) {
    const response = await app.get(path);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(root);
    expect(body).not.toContain("ENOENT");
  }
  expect((await app.post("/runs/run-a1/delete", { confirm: "run-a1", path: "/etc/passwd" })).status).toBe(400);
  expect(existsSync(join(outside, "victim.json"))).toBe(true);
  expect(existsSync(join(root, "runs", "run-a1.json"))).toBe(true);
  expect(existsSync(join(root, "sessions", "session-a.plan.json"))).toBe(true);
});

it("never lets stale or racing review submissions recreate deleted reviews", async () => {
  const root = await fixture();
  const app = await open(root);
  const submit = (id: string) => app.post("/reviews", { runId: id, scenarioHash: hash, reviewer: "Racer", wording: "pass", inventedFacts: "pass", clarification: "pass", notes: "stale" });
  const results = await Promise.all([
    ...Array.from({ length: 10 }, () => submit("run-a1")),
    app.post("/runs/run-a1/delete", { confirm: "run-a1" }),
    ...Array.from({ length: 10 }, () => submit("run-a1")),
    app.post("/sessions/session-b/delete", { confirm: "session-b" }),
    ...Array.from({ length: 10 }, () => submit("run-b1")),
  ]);
  expect(results.every(response => [303, 404].includes(response.status))).toBe(true);
  expect(existsSync(join(root, "reviews", "run-a1"))).toBe(false);
  expect(existsSync(join(root, "reviews", "run-b1"))).toBe(false);
  const stale = await submit("run-a1");
  expect(stale.status).toBe(404);
  expect(await stale.text()).not.toContain(root);
  expect(existsSync(join(root, "reviews", "run-a1"))).toBe(false);
  expect(await readReviews(root, "run-a3")).toHaveLength(1);
});

it("finishes an interrupted deletion on reopening and keeps a deleted launch request from starting again", async () => {
  const root = await fixture();
  // Simulate a crash after the durable deletion markers but before files were removed.
  await writeFile(join(root, "sessions", "session-b.deleted.json"), JSON.stringify({ format: "quote-evaluation-session-deletion/v1", id: "session-b", deletedAt: "2026-09-23T00:00:00Z", browserRequest: plan("session-b", ["run-b1"]).browserRequest }), { mode: 0o600 });
  const state = finished(["run-a1", "run-a2", "run-a3"]);
  state.work[0] = { id: "run-a1", status: "deleted", deletedAt: "2026-09-23T00:00:00Z" };
  await writeFile(join(root, "sessions", "session-a.state.json"), JSON.stringify(state));
  const app = await open(root);
  expect(existsSync(join(root, "runs", "run-b1.json"))).toBe(false);
  expect(existsSync(join(root, "reviews", "run-b1"))).toBe(false);
  expect(existsSync(join(root, "sessions", "session-b.plan.json"))).toBe(false);
  expect(existsSync(join(root, "runs", "run-a1.json"))).toBe(false);
  expect(existsSync(join(root, "reviews", "run-a1"))).toBe(false);
  expect(existsSync(join(root, "runs", "run-a2.json"))).toBe(true);
  expect(existsSync(join(root, "live-sessions", "session-b.jsonl"))).toBe(true);
  const example = library.find(item => item.suite === "contract" && item.execution !== "controlled-only")!;
  const retry = { requestId: plan("session-b", ["run-b1"]).browserRequest!.id, scenario: example.id, repetitions: "1", reasoning: "minimal",
    maxOutputTokens: "1024", callsPerRun: "10", maxElapsedMs: "30000", maxSpendUsd: "10" };
  const response = await app.post("/sessions", retry);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: expect.stringContaining("deleted") });
  expect((await readdir(join(root, "sessions"))).filter(name => name.endsWith(".plan.json")).sort()).toEqual(["session-a.plan.json"]);
});
