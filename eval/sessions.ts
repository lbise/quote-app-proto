import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EvaluationSessionPlan, EvaluationSessionRecord, EvaluationSessionState } from "./types";
import { withoutCredentials } from "./artifacts";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const unfinished = new Set<EvaluationSessionState["status"]>(["starting", "running"]);
function safe(id: string) { if (!idPattern.test(id)) throw new Error("Invalid session identifier."); return id; }
function flush(path: string) { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function location(root: string) { const dir = join(resolve(root), "sessions"); mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }
function file(dir: string, id: string, kind: "plan" | "state") { return join(dir, `${safe(id)}.${kind}.json`); }
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
  return { plan: JSON.parse(readFileSync(file(dir, id, "plan"), "utf8")), state: JSON.parse(readFileSync(file(dir, id, "state"), "utf8")) };
}
function activePid(lock: string): boolean {
  try {
    const pid = Number(readFileSync(join(lock, "pid"), "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    // A concurrent launcher may be between mkdir and flushing its PID.
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && Date.now() - statSync(lock).mtimeMs < 5_000) return true;
    return false;
  }
}
function acquire(root: string) {
  mkdirSync(resolve(root), { recursive: true, mode: 0o700 });
  const lock = join(resolve(root), ".evaluation-active");
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (activePid(lock)) throw new Error("An evaluation session is already active.");
    rmSync(lock, { recursive: true, force: true });
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch { throw new Error("An evaluation session is already active."); }
  }
  writeFileSync(join(lock, "pid"), String(process.pid), { flag: "wx", mode: 0o600, flush: true });
  flush(resolve(root));
  return () => rmSync(lock, { recursive: true, force: true });
}
function interrupt(dir: string) {
  for (const name of readdirSync(dir).filter(item => item.endsWith(".plan.json"))) {
    const id = name.slice(0, -10);
    const record = read(dir, id);
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
    state.work = state.work.map(item => ({ ...item, status: item.status === "running" ? "interrupted" : item.status === "missing" ? "skipped" : item.status }));
    saveState(dir, id, state);
  }
}
/** Reopening never launches work; it only marks unfinished evidence interrupted. */
export function reconcileEvaluationSessions(root: string): EvaluationSessionRecord[] {
  const release = acquire(root);
  try { interrupt(location(root)); return listEvaluationSessions(root); }
  finally { release(); }
}
export function listEvaluationSessions(root: string): EvaluationSessionRecord[] {
  const dir = location(root);
  return readdirSync(dir).filter(name => name.endsWith(".plan.json"))
    .map(name => read(dir, name.slice(0, -10)))
    .sort((a, b) => b.plan.createdAt.localeCompare(a.plan.createdAt));
}

/** Owns the cross-process lock until the session finishes. All state writes are atomic and flushed. */
export function beginEvaluationSession(root: string, plan: EvaluationSessionPlan) {
  const release = acquire(root);
  try {
    const dir = location(root);
    interrupt(dir);
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
      completed(id: string, runId: string, usage?: { calls: number; reservedUsd: number }) {
        const item = state.work.find(value => value.id === id && value.status === "running");
        if (!item || closed) throw new Error("Scenario Run is not running.");
        item.status = "completed"; item.runId = runId; state.activeWorkId = undefined;
        if (usage) { state.calls = usage.calls; state.reservedUsd = usage.reservedUsd; }
        persist();
      },
      progress(calls: number, reservedUsd: number) { state.calls = calls; state.reservedUsd = reservedUsd; persist(); },
      finish() { finish("completed"); },
      fail(reason: string) { finish(state.work.every(item => item.status !== "completed") && state.calls === 0 ? "failed-to-start" : "interrupted", reason); },
      stop(reason: string) { finish("stopped", reason); },
      cancel(reason: string) { finish("stopped", reason); },
    };
  } catch (error) { release(); throw error; }
}
