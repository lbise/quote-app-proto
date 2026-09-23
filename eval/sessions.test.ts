import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { beginEvaluationSession, listEvaluationSessions, reconcileEvaluationSessions } from "./sessions";
import type { EvaluationSessionPlan } from "./types";

const roots: string[] = [];
function root() { const path = mkdtempSync(join(tmpdir(), "eval-session-")); roots.push(path); return path; }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function plan(): EvaluationSessionPlan {
  return { format: "quote-evaluation-session/v1", id: "test-session", createdAt: new Date().toISOString(), mode: "offline-smoke",
    selection: { scenarioIds: ["case"], repetitions: 2 },
    model: { provider: "faux", id: "controlled", requested: { reasoning: "off" }, effective: { reasoning: "off" } },
    authorization: { method: "explicit-cli-launch", at: new Date().toISOString(), scenarioHashes: ["abc"] },
    limits: { maxCalls: 2, maxElapsedMs: 1000, maxSpendUsd: 1 }, pricing: null,
    work: [1, 2].map(repetition => ({ id: `work-${repetition}`, scenarioId: "case", scenarioHash: "abc", repetition })),
  };
}
it("persists an immutable plan before execution and serializes competing launches", () => {
  const path = root(); const first = beginEvaluationSession(path, plan());
  expect(statSync(join(path, "sessions", "test-session.plan.json")).mode & 0o777).toBe(0o600);
  expect(() => beginEvaluationSession(path, { ...plan(), id: "second" })).toThrow(/active/i);
  first.running("work-1"); first.completed("work-1", "run-1"); first.running("work-2"); first.stop("user_stop");
  expect(listEvaluationSessions(path)[0].state.work).toEqual([
    { id: "work-1", status: "completed", runId: "run-1" }, { id: "work-2", status: "interrupted" },
  ]);
  expect(listEvaluationSessions(path)[0].state.status).toBe("stopped");
  expect(readFileSync(join(path, "sessions", "test-session.plan.json"), "utf8")).toContain('"repetitions": 2');
  const second = beginEvaluationSession(path, { ...plan(), id: "second" }); second.fail("setup_failed");
});
it("reopening an unfinished live session retains a durable reservation without launching provider work", () => {
  const path = root(); const manifest = { ...plan(), mode: "live" as const };
  const first = beginEvaluationSession(path, manifest);
  first.running("work-1");
  const ledger = join(path, "live-sessions"); mkdirSync(ledger);
  writeFileSync(join(ledger, "test-session.jsonl"), '{"sessionId":"test-session"}\n{"scenarioHash":"abc","call":{"number":1,"reservedUsd":0.58466304,"status":"reserved"}}\n');
  rmSync(join(path, ".evaluation-active"), { recursive: true });
  const [reopened] = reconcileEvaluationSessions(path);
  expect(reopened.state).toMatchObject({ status: "interrupted", calls: 1, reservedUsd: 0.58466304 });
  expect(reopened.state.work[0].status).toBe("interrupted");
  expect(reconcileEvaluationSessions(path)[0]).toEqual(reopened);
});

it("reopening after a dead process marks running work interrupted and never resets saved progress", () => {
  const path = root(); const first = beginEvaluationSession(path, plan());
  first.running("work-1"); first.completed("work-1", "run-1"); first.running("work-2");
  rmSync(join(path, ".evaluation-active"), { recursive: true }); // Simulate process death without a final transition.
  const reopened = reconcileEvaluationSessions(path);
  expect(reopened[0].state).toMatchObject({ status: "interrupted", reason: "process_interrupted", work: [
    { status: "completed", runId: "run-1" }, { status: "interrupted" },
  ] });
  expect(listEvaluationSessions(path)[0]).toEqual(reopened[0]);
});
