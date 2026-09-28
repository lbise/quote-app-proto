import { escapeHtml as h } from "./html";
import type { EvaluationRun, EvaluationSessionRecord } from "./types";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const executing = (record?: EvaluationSessionRecord) => Boolean(record && ["starting", "running"].includes(record.state.status));
const row = (label: string, value: string) => `<div><dt>${h(label)}</dt><dd>${value}</dd></div>`;
const spending = (session: boolean) => `<p><strong>Spending records remain.</strong> ${session
  ? "The session's separate reservation ledger, recorded provider calls and reserved USD stay unchanged."
  : "Any separate spending ledger for this run stays unchanged."} Deletion does not refund budget, reset a limit or change what the provider may charge.</p>`;
const authorization = '<p class="field-hint">This confirmation only deletes saved evidence. It does not start, stop or authorize an evaluation.</p>';
const activeNotice = '<p class="failure notice" role="alert">This session is executing. Stop it or wait for it to end before deleting its evidence.</p>';

/** Identifies one Scenario Run and states exactly what deletion removes and keeps. */
export function runDeletionConfirmation({ run, session, reviews, date }: { run: EvaluationRun; session?: EvaluationSessionRecord; reviews: number; date: (value: string) => string }): string {
  const planned = session?.plan.work.length ?? 0;
  const blocked = executing(session);
  return `<section class="confirmation" aria-labelledby="delete-heading"><div class="page-heading"><div><h1 id="delete-heading">Delete this Scenario Run permanently?</h1><p class="muted">Check that this is the evidence you mean to remove.</p></div></div>
    <dl class="deletion-evidence">${row("Scenario", `${h(run.scenario.title)} <code>${h(run.scenario.id)}</code>`)}${row("Repetition", `Repetition ${h(run.repetition)}`)}${row("Model", `${h(run.model.provider)} / ${h(run.model.id)}`)}${row("Started", date(run.startedAt))}${row("Automated outcome", h(run.automated))}${row("Human reviews", h(plural(reviews, "human review")))}${row("Evaluation Session", session ? `<code>${h(session.plan.id)}</code>` : "Older run without a saved session")}${row("Scenario Run ID", `<code>${h(run.id)}</code>`)}</dl>
    ${blocked ? activeNotice : `<div class="deletion-warning"><p><strong>This permanently deletes the saved report and its ${h(plural(reviews, "human review"))}.</strong> There is no trash, backup or recovery.</p>
    ${spending(Boolean(session))}
    ${session ? `<p>Other Scenario Runs in this session are kept. The session keeps a minimal deleted marker, so it still counts ${h(plural(planned, "planned Scenario Run"))} and is shown as incomplete.</p>` : ""}</div>
    <form method="post" action="/runs/${encodeURIComponent(run.id)}/delete"><input type="hidden" name="confirm" value="${h(run.id)}"><div class="toolbar"><button type="submit" class="danger">Permanently delete Scenario Run</button><a href="/?run=${encodeURIComponent(run.id)}">Cancel</a></div></form>${authorization}`}</section>`;
}

/** Identifies a whole session, its saved runs and reviews, and what deletion keeps. */
export function sessionDeletionConfirmation({ session, savedRuns, reviews, date }: { session: EvaluationSessionRecord; savedRuns: number; reviews: number; date: (value: string) => string }): string {
  const { plan, state } = session;
  return `<section class="confirmation" aria-labelledby="delete-heading"><div class="page-heading"><div><h1 id="delete-heading">Delete this Evaluation Session permanently?</h1><p class="muted">Check that this is the evidence you mean to remove.</p></div></div>
    <dl class="deletion-evidence">${row("Model", `${h(plan.model.provider)} / ${h(plan.model.id)}`)}${row("Created", date(plan.createdAt))}${row("Mode", plan.mode === "live" ? "Live model" : "Offline smoke")}${row("Execution", h(state.status))}${row("Scenario Runs", `${h(plural(plan.work.length, "planned Scenario Run"))} · ${h(plural(savedRuns, "saved Scenario Run"))}`)}${row("Human reviews", h(plural(reviews, "human review")))}${row("Session ID", `<code>${h(plan.id)}</code>`)}</dl>
    ${executing(session) ? activeNotice : `<div class="deletion-warning"><p><strong>This permanently deletes the session's plan, progress, ${h(plural(savedRuns, "saved Scenario Run"))} and their ${h(plural(reviews, "human review"))}.</strong> There is no trash, backup or recovery.</p>
    ${spending(true)}<p>Other sessions and older runs are kept.</p></div>
    <form method="post" action="/sessions/${encodeURIComponent(plan.id)}/delete"><input type="hidden" name="confirm" value="${h(plan.id)}"><div class="toolbar"><button type="submit" class="danger">Permanently delete Evaluation Session</button><a href="/?session=${encodeURIComponent(plan.id)}">Cancel</a></div></form>${authorization}`}</section>`;
}

export function deletionFailure(message: string): string {
  return `<section class="confirmation"><h1>Deletion not completed</h1><p class="failure" role="alert">${h(message)}</p><p><a href="/">All sessions</a></p></section>`;
}

export const deletedNotices = {
  run: "Scenario Run permanently deleted with its human reviews. Spending records remain unchanged and no budget was refunded.",
  session: "Evaluation Session permanently deleted with its Scenario Runs and human reviews. Spending records remain unchanged and no budget was refunded.",
} as const;
