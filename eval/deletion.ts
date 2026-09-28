import { readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { MissingScenarioRunError, readRunSync, withArtifactLock } from "./artifacts";
import {
  deletedWork, listEvaluationSessions, markScenarioRunDeleted, pendingSessionDeletions, recordSessionDeletion, removeSessionFiles,
} from "./sessions";
import type { EvaluationSessionRecord } from "./types";

/** Locally authored deletion failures. Messages never contain paths or identifiers. */
export class DeletionProblem extends Error {
  constructor(message: string, readonly status: 404 | 409) { super(message); }
}
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const executing = (record: EvaluationSessionRecord) => ["starting", "running"].includes(record.state.status);
const activeProblem = () => new DeletionProblem("This session is executing. Stop it or wait for it to end before deleting its evidence.", 409);

function identifier(id: string) {
  if (!idPattern.test(id)) throw new DeletionProblem("Not found.", 404);
  return id;
}
/** Reviews go before the report: an interrupted deletion never leaves hidden reviews behind a missing run. */
function removeRunEvidence(root: string, id: string) {
  const reviews = join(resolve(root), "reviews", identifier(id));
  const count = (() => { try { return readdirSync(reviews).length; } catch { return 0; } })();
  rmSync(reviews, { recursive: true, force: true });
  rmSync(join(resolve(root), "runs", `${id}.json`), { force: true });
  return count;
}
function ownerOf(sessions: EvaluationSessionRecord[], runId: string, sessionId?: string) {
  return sessions.find(record => record.plan.id === sessionId && record.plan.work.some(work => work.id === runId));
}

/** Finishes deletions a crash interrupted after their durable markers were written. Idempotent. */
export function completePendingDeletions(root: string) {
  withArtifactLock(root, () => {
    for (const pending of pendingSessionDeletions(root)) {
      for (const id of pending.work) {
        const run = readRunSync(root, id);
        if (!run || run.sessionId === pending.id) removeRunEvidence(root, id);
      }
      removeSessionFiles(root, pending.id);
    }
    for (const { sessionId, id } of deletedWork(root)) {
      const run = readRunSync(root, id);
      if (!run || run.sessionId === sessionId) removeRunEvidence(root, id);
    }
  });
}

/**
 * Permanently deletes one Scenario Run and its reviews. A session run leaves a
 * minimal deleted marker so the session keeps its planned-attempt denominator.
 */
export function deleteScenarioRun(root: string, runId: string): { sessionId?: string; removedReviews: number } {
  identifier(runId);
  return withArtifactLock(root, () => {
    const run = readRunSync(root, runId);
    if (!run) throw new DeletionProblem(new MissingScenarioRunError().message, 404);
    const sessions = listEvaluationSessions(root);
    // Any session planning this ID guards it, even before the run is linked.
    if (sessions.some(record => executing(record) && record.plan.work.some(work => work.id === runId))) throw activeProblem();
    const owner = ownerOf(sessions, runId, run.sessionId);
    if (owner) markScenarioRunDeleted(root, owner.plan.id, runId);
    return { sessionId: owner?.plan.id, removedReviews: removeRunEvidence(root, runId) };
  });
}

/** Permanently deletes a session's plan, state, runs and reviews. Its spending ledger is separate and stays. */
export function deleteEvaluationSession(root: string, sessionId: string): { removedRuns: number; removedReviews: number } {
  identifier(sessionId);
  return withArtifactLock(root, () => {
    const record = listEvaluationSessions(root).find(item => item.plan.id === sessionId);
    if (!record) throw new DeletionProblem("Evaluation Session not found. It may have been deleted.", 404);
    if (executing(record)) throw activeProblem();
    recordSessionDeletion(root, record);
    let removedRuns = 0;
    let removedReviews = 0;
    for (const work of record.plan.work) {
      const run = readRunSync(root, work.id);
      if (run && run.sessionId !== sessionId) continue;
      if (run) removedRuns++;
      removedReviews += removeRunEvidence(root, work.id);
    }
    removeSessionFiles(root, sessionId);
    return { removedRuns, removedReviews };
  });
}
