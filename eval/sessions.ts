import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EvaluationSessionDeletion, EvaluationSessionPlan, EvaluationSessionRecord, EvaluationSessionState } from "./types";
import { withoutCredentials } from "./artifacts";

export class ActiveEvaluationSessionError extends Error {
  constructor() { super("An evaluation session is already active."); }
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const unfinished = new Set<EvaluationSessionState["status"]>(["starting", "running"]);
function safe(id: string) { if (!idPattern.test(id)) throw new Error("Invalid session identifier."); return id; }
function flush(path: string) { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function location(root: string) { const dir = join(resolve(root), "sessions"); mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }
function file(dir: string, id: string, kind: "plan" | "state" | "deleted") { return join(dir, `${safe(id)}.${kind}.json`); }
function deletedIds(dir: string) { return new Set(readdirSync(dir).filter(name => name.endsWith(".deleted.json")).map(name => name.slice(0, -13))); }
/** Plans of permanently deleted sessions are ignored even if a crash left files behind. */
function planIds(dir: string) {
  const deleted = deletedIds(dir);
  return readdirSync(dir).filter(name => name.endsWith(".plan.json")).map(name => name.slice(0, -10)).filter(id => idPattern.test(id) && !deleted.has(id));
}
function saveState(dir: string, id: string, state: EvaluationSessionState) {
  const destination = file(dir, id, "state");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(state, withoutCredentials, 2) + "\n", { mode: 0o600, flag: "wx", flush: true });
    renameSync(temporary, destination);
    flush(dir);
  } finally { rmSync(temporary, { force: true }); }
}
function read(dir: string, id: string): EvaluationSessionRecord {
  const plan = JSON.parse(readFileSync(file(dir, id, "plan"), "utf8")) as EvaluationSessionPlan;
  try { return { plan, state: JSON.parse(readFileSync(file(dir, id, "state"), "utf8")) }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { plan, state: { status: "starting", startedAt: null, finishedAt: null, calls: 0, reservedUsd: 0,
      work: plan.work.map(item => ({ id: item.id, status: "missing" })) } };
  }
}
function acquire(root: string) {
  mkdirSync(resolve(root), { recursive: true, mode: 0o700 });
  const lock = join(resolve(root), ".evaluation-active.lock");
  // flock holds an open-file-description lock. The child acquires it on the
  // parent's inherited fd; it survives child exit and the OS releases it on a crash.
  // Never unlink this file: a new inode would allow two separate locks.
  const fd = openSync(lock, "a", 0o600);
  try {
    execFileSync("flock", ["-n", "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
    flush(resolve(root));
    return () => closeSync(fd);
  } catch (error) {
    closeSync(fd);
    if ((error as { status?: number }).status === 1) throw new ActiveEvaluationSessionError();
    throw error;
  }
}
function interrupt(dir: string) {
  for (const id of planIds(dir)) {
    let record: EvaluationSessionRecord;
    try { record = read(dir, id); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (!unfinished.has(record.state.status)) continue;
    const state = record.state;
    if (record.plan.mode === "live") {
      try {
        const entries = readFileSync(join(dir, "..", "live-sessions", `${safe(id)}.jsonl`), "utf8").trim().split("\n");
        const reservations = new Map<number, number>();
        for (const line of entries.slice(1)) {
          let event: { scenarioHash?: string; call?: { number?: number; reservedUsd?: number } };
          try { event = JSON.parse(line); } catch { break; }
          if (event.scenarioHash && Number.isSafeInteger(event.call?.number) && typeof event.call?.reservedUsd === "number") {
            reservations.set(event.call.number!, event.call.reservedUsd);
          }
        }
        state.calls = Math.max(state.calls, reservations.size);
        state.reservedUsd = Math.max(state.reservedUsd, [...reservations.values()].reduce((sum, amount) => sum + amount, 0));
      } catch { /* Keep the persisted state; a damaged ledger must never start new work. */ }
    }
    state.status = "interrupted";
    state.reason = "process_interrupted";
    state.finishedAt = new Date().toISOString();
    state.activeWorkId = undefined;
    state.work = state.work.map(item => {
      if (item.status === "completed") return item;
      const planned = record.plan.work.find(work => work.id === item.id);
      try {
        const run = JSON.parse(readFileSync(join(dir, "..", "runs", `${safe(item.id)}.json`), "utf8")) as { format?: string; id?: string; sessionId?: string; scenarioHash?: string; repetition?: number; automated?: string; live?: { stopReason?: string } };
        if (planned && run.format === "quote-evaluation/v1" && ["passed", "failed", "invalid"].includes(run.automated ?? "") && run.id === item.id && run.sessionId === id && run.scenarioHash === planned.scenarioHash && run.repetition === planned.repetition) {
          return { ...item, status: run.live?.stopReason ? "interrupted" as const : "completed" as const, runId: item.id };
        }
      } catch { /* No complete artifact for this planned Scenario Run. */ }
      return { ...item, status: item.status === "running" ? "interrupted" as const : "skipped" as const };
    });
    saveState(dir, id, state);
  }
}
/** Reopening never launches work; it only marks unfinished evidence interrupted. */
export function reconcileEvaluationSessions(root: string): EvaluationSessionRecord[] {
  const release = acquire(root);
  try { interrupt(location(root)); return storedSessions(root); }
  finally { release(); }
}
/** Opening persisted sessions reconciles crash evidence without starting work. */
export function listEvaluationSessions(root: string): EvaluationSessionRecord[] {
  try { return reconcileEvaluationSessions(root); }
  catch (error) {
    // A running evaluator owns transitions. Its last flushed state is safe to read.
    if (error instanceof ActiveEvaluationSessionError) return storedSessions(root);
    throw error;
  }
}
function storedSessions(root: string): EvaluationSessionRecord[] {
  const dir = location(root);
  return planIds(dir).flatMap(id => {
    try { return [read(dir, id)]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }).sort((a, b) => Date.parse(b.plan.createdAt) - Date.parse(a.plan.createdAt) || a.plan.id.localeCompare(b.plan.id));
}

/** A request already has durable evidence. Matching retries may return its ID. */
export class ExistingEvaluationRequest extends Error {
  constructor(readonly record: EvaluationSessionRecord) { super("This browser request already has a session."); }
}

/** A retried launch request whose session was permanently deleted must not start again. */
export class DeletedEvaluationRequest extends Error {
  constructor() { super("This launch request belongs to a deleted session. Reload the launch form to start a new evaluation."); }
}

export function deletedEvaluationSessions(root: string): EvaluationSessionDeletion[] {
  const dir = location(root);
  return [...deletedIds(dir)].filter(id => idPattern.test(id)).flatMap(id => {
    try { return [JSON.parse(readFileSync(file(dir, id, "deleted"), "utf8")) as EvaluationSessionDeletion]; }
    catch { return [{ format: "quote-evaluation-session-deletion/v1" as const, id, deletedAt: "unknown" }]; }
  });
}

/**
 * Deletion helpers. Callers hold the artifact lock and have verified the session
 * is not executing. Finished sessions have no other state writer.
 */
export function markScenarioRunDeleted(root: string, sessionId: string, workId: string) {
  const dir = location(root);
  const { state } = read(dir, sessionId);
  if (unfinished.has(state.status)) throw new ActiveEvaluationSessionError();
  // Keep call and reservation totals: deleting evidence never refunds spend.
  state.work = state.work.map(item => item.id === workId ? { id: item.id, status: "deleted", deletedAt: new Date().toISOString() } : item);
  saveState(dir, sessionId, state);
}
/** Durable before any file removal, so a crash finishes the deletion on reopening. */
export function recordSessionDeletion(root: string, record: EvaluationSessionRecord) {
  const dir = location(root);
  const destination = file(dir, record.plan.id, "deleted");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const deletion: EvaluationSessionDeletion = { format: "quote-evaluation-session-deletion/v1", id: record.plan.id, deletedAt: new Date().toISOString(),
    ...(record.plan.browserRequest ? { browserRequest: record.plan.browserRequest } : {}) };
  try {
    writeFileSync(temporary, JSON.stringify(deletion, null, 2) + "\n", { mode: 0o600, flag: "wx", flush: true });
    renameSync(temporary, destination);
    flush(dir);
  } finally { rmSync(temporary, { force: true }); }
}
/** The plan goes first: a state file without a plan is never listed or reconciled. */
export function removeSessionFiles(root: string, id: string) {
  const dir = location(root);
  rmSync(file(dir, id, "plan"), { force: true });
  rmSync(file(dir, id, "state"), { force: true });
  flush(dir);
}
/** Reads plans of deleted sessions whose removal a crash interrupted. */
export function pendingSessionDeletions(root: string): { id: string; work: string[] }[] {
  const dir = location(root);
  return [...deletedIds(dir)].filter(id => idPattern.test(id)).map(id => {
    try { return { id, work: (JSON.parse(readFileSync(file(dir, id, "plan"), "utf8")) as EvaluationSessionPlan).work.map(item => item.id) }; }
    catch { return { id, work: [] }; }
  });
}
export function deletedWork(root: string): { sessionId: string; id: string }[] {
  return storedSessions(root).flatMap(record => record.state.work.filter(item => item.status === "deleted").map(item => ({ sessionId: record.plan.id, id: item.id })));
}

/** Owns the cross-process lock until the session finishes. All state writes are atomic and flushed. */
export function beginEvaluationSession(root: string, plan: EvaluationSessionPlan) {
  const release = acquire(root);
  try {
    const dir = location(root);
    interrupt(dir);
    if (plan.browserRequest) {
      const existing = storedSessions(root).find(record => record.plan.browserRequest?.id === plan.browserRequest!.id);
      if (existing) throw new ExistingEvaluationRequest(existing);
      if (deletedEvaluationSessions(root).some(deletion => deletion.browserRequest?.id === plan.browserRequest!.id)) throw new DeletedEvaluationRequest();
    }
    const state: EvaluationSessionState = { status: "starting", startedAt: null, finishedAt: null,
      work: plan.work.map(item => ({ id: item.id, status: "missing" })), calls: 0, reservedUsd: 0 };
    const path = file(dir, plan.id, "plan");
    writeFileSync(path, JSON.stringify(plan, withoutCredentials, 2) + "\n", { flag: "wx", mode: 0o600, flush: true });
    flush(dir);
    saveState(dir, plan.id, state);
    let closed = false;
    const persist = () => saveState(dir, plan.id, state);
    const finish = (status: "completed" | "failed-to-start" | "stopped" | "interrupted", reason?: string) => {
      if (closed) return;
      closed = true;
      state.status = status;
      state.reason = reason ? String(withoutCredentials("reason", reason.replace(/\b(?:postgres(?:ql)?|https?):\/\/\S+/gi, "[redacted URL]"))).slice(0, 400) : undefined;
      state.finishedAt = new Date().toISOString();
      state.activeWorkId = undefined;
      state.work = state.work.map(item => ({ ...item, status: item.status === "running" ? "interrupted" : item.status === "missing" ? "skipped" : item.status }));
      try { persist(); } finally { release(); }
    };
    return {
      start() { state.status = "running"; state.startedAt = new Date().toISOString(); persist(); },
      running(id: string) {
        if (state.status === "starting") { state.status = "running"; state.startedAt = new Date().toISOString(); }
        const item = state.work.find(value => value.id === id && value.status === "missing");
        if (!item || closed) throw new Error("Scenario Run was not planned or was already started.");
        item.status = "running"; state.activeWorkId = id; persist();
      },
      completed(id: string, runId: string, usage?: { calls: number; reservedUsd: number }, interrupted = false) {
        const item = state.work.find(value => value.id === id && value.status === "running");
        if (!item || closed) throw new Error("Scenario Run is not running.");
        item.status = interrupted ? "interrupted" : "completed"; item.runId = runId; state.activeWorkId = undefined;
        if (usage) { state.calls = usage.calls; state.reservedUsd = usage.reservedUsd; }
        persist();
      },
      progress(calls: number, reservedUsd: number) { state.calls = calls; state.reservedUsd = reservedUsd; persist(); },
      finish() { finish("completed"); },
      fail(reason: string) { finish(state.work.every(item => item.status !== "completed") && state.calls === 0 ? "failed-to-start" : "interrupted", reason); },
      stop(reason: string) { finish("stopped", reason); },
      interrupt(reason: string) { finish("interrupted", reason); },
      cancel(reason: string) { finish("stopped", reason); },
    };
  } catch (error) { release(); throw error; }
}
