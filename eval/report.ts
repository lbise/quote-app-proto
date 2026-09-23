import { calculateQuote, money, type QuoteData } from "../app/lib/quote";
import { withoutCredentials } from "./artifacts";
import type { EvaluationRun, EvaluationSessionRecord, ExpectedCalculation, HumanReview, Scenario, TurnResult } from "./types";
export type DashboardStatus = { database: "ready" | "unavailable"; provider: "available" | "unavailable" };

function scenarioSuite(scenario: Scenario): NonNullable<Scenario["suite"]> {
  return scenario.suite === "contract" ? "contract" : "scenario";
}

function checksFor(run: EvaluationRun): EvaluationRun["checks"] {
  const value = run.checks;
  if (!value || typeof value !== "object" || !("contract" in value) || !("commercial" in value)) return undefined;
  const { contract, commercial } = value;
  return [contract, commercial].every(status => status === "passed" || status === "failed" || status === "invalid")
    ? value
    : undefined;
}

function suiteLabel(scenario: Scenario): string {
  return scenarioSuite(scenario) === "contract" ? "Contract check" : "Scenario case";
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
const h = escapeHtml;
const json = (value: unknown) => {
  const text = value === undefined ? "[missing]" : JSON.stringify(value, withoutCredentials, 2);
  return `<pre${text.length > 1000 ? ' tabindex="0"' : ""}>${h(text)}</pre>`;
};
const list = (values: string[]) => values.length ? `<ul>${values.map(value => `<li>${h(value)}</li>`).join("")}</ul>` : "<p>None specified.</p>";
function quoteView(quote: QuoteData, expected = false, expectations?: ExpectedCalculation): string {
  const calculation = expected ? expectations : calculateQuote(quote);
  const groups = [{ id: "", title: "Unsectioned work" }, ...quote.sections];
  return `<article class="quote" lang="fr"><header><p>${h(quote.reference)}</p><h3>${h(quote.title || "Devis sans titre")}</h3>
    <div class="comparison"><p>${h(quote.businessName)}<br>${h(quote.businessAddress)}<br>${h(quote.businessContact)}</p><p>${h(quote.customerName)}<br>${h(quote.customerAddress)}<br>${h(quote.customerContact)}</p></div>
    <p>Date : ${h(quote.issueDate || "manquante")} · Validité : ${h(quote.validUntil || "non précisée")}</p><p>${h(quote.siteAddress)}</p></header>
    ${groups.filter(group => group.id || quote.lines.some(line => !line.sectionId)).map(group => `<section><h4>${h(group.title)}</h4>
    <ol>${quote.lines.filter(line => line.sectionId === group.id).map(line => {
      const amount = calculation?.lines[quote.lines.indexOf(line)]?.amount;
      return `<li><p>${h(line.description || "Description manquante")}</p><p class="figures">${line.mode === "fixed" ? `Forfait CHF ${h(line.amount || "?")}` : `${h(line.quantity || "?")} ${h(line.unit || "?")} × CHF ${h(line.unitPrice || "?")}`}${calculation ? ` = ${amount == null ? "incomplet" : money(amount)}` : ""}</p></li>`;
    }).join("")}</ol></section>`).join("")}
    ${!quote.lines.length ? "<p>Aucune ligne.</p>" : ""}
    <dl class="totals">${["subtotal", "discount", "net", "vat", "total"].map(key => {
      const value = calculation?.[key as "subtotal"];
      return `<div><dt>${h(key)}</dt><dd>${typeof value === "number" ? money(value) : "Not specified"}</dd></div>`;
    }).join("")}</dl><p>Remise : ${h(quote.discountMode)} ${h(quote.discount)}</p><p>TVA : ${quote.vatRegistered === null ? "à préciser" : quote.vatRegistered ? "8,1 %" : "non assujetti"} ${h(quote.vatId)}</p><p class="multiline">${h(quote.terms)}</p>
    ${calculation?.missing.length ? `<details><summary>${expected ? "Expected missing information" : "Missing information"} (${calculation.missing.length})</summary>${list(calculation.missing.map(item => `${item.path}: ${item.code}`))}</details>` : ""}
    ${calculation?.errors.length ? `<p class="failure">Invalid commercial state</p>${json(calculation.errors)}` : ""}</article>`;
}
function assertions(turn: TurnResult): string {
  const failed = turn.assertions.filter(assertion => !assertion.passed).length;
  return `<details><summary>Assertions: ${turn.assertions.length - failed} passed, ${failed} failed</summary><ul class="assertions">${turn.assertions.map(assertion => {
    const category = assertion.category;
    const categoryLabel = category === "contract" || category === "commercial" ? ` <small>${h(category)} check</small>` : "";
    return `<li class="${assertion.passed ? "pass" : "failure"}"><strong>${assertion.passed ? "PASS" : "FAIL"}</strong> ${h(assertion.label)} <code>${h(assertion.path)}</code>${categoryLabel}${!assertion.passed ? `<div class="comparison"><div>Expected${json(assertion.expected)}</div><div>Actual${json(assertion.actual)}</div></div>` : ""}</li>`;
  }).join("")}</ul></details>`;
}
function changedFields(before: QuoteData, after: QuoteData): string {
  const changes = Object.keys(before).filter(key => JSON.stringify(before[key as keyof QuoteData]) !== JSON.stringify(after[key as keyof QuoteData]));
  return changes.length ? changes.map(key => `<details><summary>${h(key)}</summary><div class="comparison"><div>Before${json(before[key as keyof QuoteData])}</div><div>After${json(after[key as keyof QuoteData])}</div></div></details>`).join("") : "<p>No commercial fields changed.</p>";
}
function turnView(turn: TurnResult): string {
  const trace = turn.debug ?? turn.diagnostic;
  return `<section class="turn" id="turn-${turn.step}"><h3>Step ${turn.step + 1} · ${h(turn.kind === "manual" ? "Manual UI save" : "Artisan message")}</h3><p class="multiline">${h(turn.input)}</p>
    <p><strong>${h(turn.outcome)}</strong> · ${turn.failedCalls} failed calls · ${turn.elapsedMs} ms</p>
    ${turn.error ? `<p class="failure">${h(turn.error)}</p>` : ""}<p class="multiline">${h(turn.message)}</p>${assertions(turn)}
    <details><summary>Changed fields</summary>${changedFields(turn.before, turn.after)}</details>
    <details><summary>Working Draft after this step</summary>${quoteView(turn.after)}</details>
    <details><summary>Tool attempts (${trace?.attempts?.length ?? 0})</summary>${trace?.attempts?.map(attempt => `<section><h4>${h(attempt.name)} · ${h(attempt.outcome)}</h4><p>Failure count ${attempt.failedCalls}/${attempt.failureLimit} · ${h(attempt.errorCode ?? "accepted")}</p><h5>Arguments</h5>${json(attempt.arguments)}<h5>Result</h5>${json(attempt.result)}</section>`).join("") || "<p>No tool attempts recorded.</p>"}</details>
    <details><summary>Model requests, tool results and diagnostics</summary>${json(trace ?? { note: "No model trace for this step." })}</details></section>`;
}
function liveStatus(run: EvaluationRun): string {
  if (!run.live) return "";
  const { calls, limits, sessionCalls, sessionReservedUsd, stopReason } = run.live;
  return `<p>Provider transmission authorized at launch for the selected scenarios in this invocation. Library approval and human review remain separate.</p>
    ${stopReason ? `<p class="failure">Live session stopped: ${h(stopReason)}</p>` : ""}
    <p>Invocation budget: ${sessionCalls} / ${limits.maxCalls} calls; USD ${h(sessionReservedUsd)} reserved / ${h(limits.maxSpendUsd)} cap; ${limits.maxElapsedMs} ms deadline.</p>
    <details open><summary>Provider calls (${calls.length})</summary>${calls.length ? `<ol>${calls.map(call => `<li><strong>Call ${call.number}</strong> · ${h(call.status)} · USD ${h(call.reservedUsd)} reserved${call.estimatedUsd === null ? "" : ` · USD ${h(call.estimatedUsd)} estimated`}<br>SDK stop reason: ${h(call.stopReason ?? "not recorded")} · Provider finish reason: ${h(call.rawStopReason ?? "not recorded")}</li>`).join("")}</ol>` : "<p>No provider calls were recorded.</p>"}</details>
    <p>${run.cost.estimatedUsd === null ? "No reliable complete usage estimate" : `This run's reported usage estimate: USD ${h(run.cost.estimatedUsd)}`}. Reservations are conservative upper bounds, not actual charges.</p>
    <p>${h(run.cost.assumptions)}</p>`;
}
function reviewForm(run: EvaluationRun, reviews: HumanReview[]): string {
  const last = reviews.at(-1);
  const choices = (name: string, label: string) => `<label>${label}<select name="${name}">${["pending", "pass", "fail"].map(value => `<option${last?.[name as "wording"] === value ? " selected" : ""}>${value}</option>`).join("")}</select></label>`;
  return `<section id="human-review"><h2>Human review</h2><p>Automated checks do not establish faithful wording or useful clarification. Reviews apply only to this run and scenario hash.</p>
    <form method="post" action="/reviews"><input type="hidden" name="runId" value="${h(run.id)}"><input type="hidden" name="scenarioHash" value="${h(run.scenarioHash)}">
    <label>Reviewer<input name="reviewer" maxlength="200" required value="${h(last?.reviewer ?? "")}"></label>
    <div class="review-fields">${choices("wording", "Faithful French wording and reply language")}${choices("inventedFacts", "No invented facts or commitments")}${choices("clarification", "Useful clarification")}</div>
    <label>Review notes<textarea name="notes" maxlength="10000" rows="5">${h(last?.notes ?? "")}</textarea></label><button type="submit">Save a new review</button></form>
    <h3>Saved review history</h3>${reviews.length ? reviews.map(review => `<details><summary>${h(review.createdAt)} · ${h(review.reviewer)}</summary><p>Wording: ${h(review.wording)} · Facts: ${h(review.inventedFacts)} · Clarification: ${h(review.clarification)}</p><p class="multiline">${h(review.notes)}</p></details>`).join("") : "<p>Pending human review. No approval recorded.</p>"}</section>`;
}
function runMode(run: EvaluationRun): "live" | "offline-smoke" | "unknown" {
  if (run.live) return "live";
  return run.model.provider === "faux" ? "offline-smoke" : "unknown";
}
function automatedStatus(session: EvaluationSessionRecord, status: EvaluationSessionRecord["state"]["work"][number]["status"] | undefined, run?: EvaluationRun): string {
  if (run) return run.automated;
  return ["starting", "running"].includes(session.state.status) && ["missing", "running"].includes(status ?? "") ? "pending" : "unavailable";
}
function reviewStatus(reviews: HumanReview[]): string {
  const last = reviews.at(-1);
  if (!last || [last.wording, last.inventedFacts, last.clarification].includes("pending")) return "pending";
  return [last.wording, last.inventedFacts, last.clarification].includes("fail") ? "changes requested" : "approved";
}
function executionStatus(session: EvaluationSessionRecord | undefined, run: EvaluationRun): string {
  if (!session) return "unavailable (older run without a session)";
  return session.state.work.find(work => work.runId === run.id && session.plan.work.some(item => item.id === work.id && item.scenarioHash === run.scenarioHash))?.status ?? "unavailable";
}
function sessionFor(sessions: EvaluationSessionRecord[], run: EvaluationRun): EvaluationSessionRecord | undefined {
  return sessions.find(session => session.plan.id === run.sessionId && session.plan.work.some(work => work.id === run.id && work.scenarioHash === run.scenarioHash));
}
function history(input: { sessions: EvaluationSessionRecord[]; runs: EvaluationRun[]; reviewsByRun?: Record<string, HumanReview[]>; scenarioId?: string; outcome?: string; mode?: string; dashboardStatus?: DashboardStatus }): string {
  const { sessions, runs } = input;
  const outcome = ["passed", "failed", "invalid", "pending"].includes(input.outcome ?? "") ? input.outcome! : "";
  const mode = ["live", "offline-smoke"].includes(input.mode ?? "") ? input.mode! : "";
  const scenario = input.scenarioId ?? "";
  const query = (values: Record<string, string>) => `/?${new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString()}`;
  const select = (name: string, label: string, options: [string, string][], value: string) => `<label>${label}<select name="${name}">${options.map(([key, text]) => `<option value="${h(key)}"${key === value ? " selected" : ""}>${h(text)}</option>`).join("")}</select></label>`;
  const linked = new Set(sessions.flatMap(session => session.plan.work.map(work => `${session.plan.id}:${work.id}:${work.scenarioHash}`)));
  const older = runs.filter(run => !run.sessionId || !linked.has(`${run.sessionId}:${run.id}:${run.scenarioHash}`))
    .filter(run => (!scenario || run.scenario.id === scenario) && (!outcome || run.automated === outcome) && (!mode || runMode(run) === mode))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id));
  const sessionCards = sessions.map(session => {
    const entries = session.plan.work.map(work => ({ work, state: session.state.work.find(item => item.id === work.id), run: runs.find(run => run.id === work.id && run.sessionId === session.plan.id && run.scenarioHash === work.scenarioHash) }));
    const visible = entries.filter(({ work, state, run }) => (!scenario || work.scenarioId === scenario) && (!outcome || automatedStatus(session, state?.status, run) === outcome));
    if ((mode && session.plan.mode !== mode) || !visible.length) return "";
    const completed = entries.map(entry => entry.run).filter((run): run is EvaluationRun => Boolean(run));
    const estimated = completed.length === entries.length && completed.every(run => run.cost?.estimatedUsd != null)
      ? `USD ${completed.reduce((sum, run) => sum + run.cost.estimatedUsd!, 0).toFixed(6)}` : completed.length === entries.length || !["starting", "running"].includes(session.state.status) ? "unavailable" : "pending";
    const duration = session.state.startedAt && session.state.finishedAt ? `${Math.max(0, Date.parse(session.state.finishedAt) - Date.parse(session.state.startedAt))} ms` : "pending";
    return `<details class="session"${scenario || outcome ? " open" : ""}><summary><strong>${h(session.plan.id)}</strong> · ${h(session.plan.createdAt)} · ${h(session.plan.mode === "live" ? "Live model" : "Offline smoke")} · Execution: ${h(session.state.status)}</summary>
      <p>Provider/model: ${h(session.plan.model.provider)} / ${h(session.plan.model.id)} · Started: ${h(session.state.startedAt ?? "pending")} · Duration: ${h(duration)}</p>
      <p>Calls: ${h(session.state.calls)} · Estimated usage cost: ${h(estimated)} · Reservations: ${session.plan.mode === "live" ? `USD ${h(session.state.reservedUsd)}` : "not applicable"}</p>
      <p>Automated checks and human review belong to each Scenario Run. A completed session does not mean either passed.</p>
      <ol>${visible.map(({ work, state, run }) => `<li>Scenario ${h(work.scenarioId)} · repetition ${h(work.repetition)} · ${run ? `<a href="/?run=${encodeURIComponent(run.id)}">${h(run.id)}</a>` : h(work.id)}<br>Execution: ${h(state?.status ?? "unavailable")} · Automated: ${h(automatedStatus(session, state?.status, run))} · Human review: ${run ? h(reviewStatus(input.reviewsByRun?.[run.id] ?? [])) : "unavailable"}</li>`).join("")}</ol></details>`;
  }).join("");
  return `<section class="dashboard"><h1>Evaluation sessions</h1><p>Database: <strong>${h(input.dashboardStatus?.database ?? "unavailable")}</strong> · Configured provider: <strong>${h(input.dashboardStatus?.provider ?? "unavailable")}</strong>. Credentials and connection details are not shown.</p>
    <form class="filters" method="get" action="/"><input type="hidden" name="view" value="history">${select("scenario", "Scenario", [["", "All scenarios"], ...input.sessions.flatMap(session => session.plan.work.map(work => work.scenarioId)).concat(runs.map(run => run.scenario.id)).filter((id, index, ids) => ids.indexOf(id) === index).map(id => [id, id] as [string, string])], scenario)}${select("outcome", "Automated outcome", [["", "All outcomes"], ["passed", "Passed"], ["failed", "Failed"], ["invalid", "Invalid"], ["pending", "Pending"]], outcome)}${select("mode", "Mode", [["", "All modes"], ["live", "Live model"], ["offline-smoke", "Offline smoke"]], mode)}<button type="submit">Filter</button></form>
    ${sessionCards || "<p>No saved sessions match.</p>"}
    <h2>Older runs without a saved session</h2>${older.length ? `<ol>${older.map(run => `<li><a href="/?run=${encodeURIComponent(run.id)}">${h(run.id)}</a> · ${h(run.scenario.title)} · ${h(run.startedAt)} · ${h(runMode(run) === "live" ? "Live model" : runMode(run) === "offline-smoke" ? "Offline smoke" : "Mode unavailable")} · Automated: ${h(run.automated)} · Execution: unavailable · Human review: ${h(reviewStatus(input.reviewsByRun?.[run.id] ?? []))} · Cost: ${run.cost?.estimatedUsd == null ? "unavailable" : `USD ${h(run.cost.estimatedUsd)}`}</li>`).join("")}</ol>` : "<p>No older runs match.</p>"}</section>`;
}
export function renderReport(input: { scenarios: Scenario[]; runs: EvaluationRun[]; sessions?: EvaluationSessionRecord[]; dashboardStatus?: DashboardStatus; outcome?: string; mode?: string; scenarioId?: string; runId?: string; historyView?: boolean; reviewsByRun?: Record<string, HumanReview[]>; reviews: HumanReview[] }): string {
  const run = input.runs.find(item => item.id === input.runId);
  const sessions = input.sessions ?? [];
  const session = run && sessionFor(sessions, run);
  const scenario = run?.scenario ?? input.scenarios.find(item => item.id === input.scenarioId) ?? input.scenarios[0];
  const human = reviewStatus(input.reviews);
  const contractCases = input.scenarios.filter(item => scenarioSuite(item) === "contract");
  const scenarioCases = input.scenarios.filter(item => scenarioSuite(item) === "scenario");
  const scenarioLinks = (items: Scenario[], label: string) => items.length ? `<nav aria-label="${h(label)}">${items.map(item => `<a ${item.id === scenario?.id ? 'aria-current="page"' : ""} href="/?scenario=${encodeURIComponent(item.id)}"><small>${h(item.profession)} · v${item.version}</small>${h(item.title)}</a>`).join("")}</nav>` : "<p>None available.</p>";
  const checks = run ? checksFor(run) : undefined;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Quote evaluation review</title><link rel="stylesheet" href="/report.css"></head><body>
    <header class="masthead"><a href="/">Easy Quote / evaluation</a><p>Private local report. Retained commercial prices and technical details. No provider calls from this browser.</p></header>
    <div class="workbench"><aside><h2>Contract checks</h2><p>Fictional fixtures that check the edit contract; they are not Artisan work.</p>${scenarioLinks(contractCases, "Contract checks")}<h2>Scenario cases</h2>${scenarioLinks(scenarioCases, "Scenario cases")}<h2>History</h2><p><a href="/">Recent sessions and older runs</a></p>${run ? `<small>${h(suiteLabel(run.scenario))}</small>` : ""}</aside>
    <main>${input.historyView ? `${!scenario ? "<p>No scenarios available</p>" : ""}${history({ sessions, runs: input.runs, scenarioId: input.scenarioId, outcome: input.outcome, mode: input.mode, dashboardStatus: input.dashboardStatus, reviewsByRun: input.reviewsByRun })}` : scenario ? `<header><p>${h(scenario.provenance.kind)} · ${h(scenario.profession)} · v${scenario.version} · ${h(scenario.locale)}${scenario.execution === "controlled-only" ? " · Controlled fault injection only" : ""}</p><h1>${h(scenario.title)}</h1>${scenarioSuite(scenario) === "contract" ? "<p class=notice>Fictional contract check for edit behavior; it is not a commercial or Artisan-work example.</p>" : ""}<p>${run?.live ? "Library defaults. " : ""}Provider use: ${h(scenario.review.provider)} · Inputs: ${h(scenario.review.inputs)} · Expectations: ${h(scenario.review.expectations)}</p><p>${h(scenario.review.note)}</p></header>
    ${run ? `<section class="run-status"><h2>Run results</h2><nav aria-label="Report navigation"><a href="#comparison">Quote comparison</a> · <a href="#script">Scenario script</a> · <a href="#execution">Execution</a> · <a href="#human-review">Human review</a></nav>${checks ? `<p>Contract checks: <strong>${h(checks.contract)}</strong> · Commercial checks: <strong>${h(checks.commercial)}</strong> · Human review: <strong>${human}</strong></p>` : `<p>Automated: <strong>${h(run.automated)}</strong> · Human review: <strong>${human}</strong></p>`}<p>Execution: <strong>${h(executionStatus(session, run))}</strong> · Started: ${h(run.startedAt)} · Duration: ${h(run.elapsedMs)} ms</p><p>${h(runMode(run) === "live" ? "Live model" : runMode(run) === "offline-smoke" ? "Offline smoke" : "Mode unavailable")} · ${h(run.model.provider)} / ${h(run.model.id)} · ${h(run.modelCalls)} model calls · Estimated usage cost: ${run.cost?.estimatedUsd == null ? "unavailable" : `USD ${h(run.cost.estimatedUsd)}`} · Reservations: ${run.live ? `USD ${h(run.cost?.reservedUsd ?? "unavailable")}` : "not applicable"}</p>${!checks ? "<p>Contract checks: unavailable · Commercial checks: unavailable (not recorded)</p>" : ""}${liveStatus(run)}<details><summary>Run identity, revisions, usage and cost assumptions</summary>${json({ id: run.id, scenarioHash: run.scenarioHash, revision: run.revision, model: run.model, repetition: run.repetition, usage: run.usage, cost: run.cost, live: run.live })}</details></section>` : "<p class=notice>The expected Quote is an authored reference, not a model-generated result. Browse and review inputs before making any provider calls.</p>"}
    <section><h2>Source and adaptations</h2><p>${h(scenario.provenance.alias)}</p>${list(scenario.provenance.notes)}</section>
    ${run ? `<details><summary>Starting Working Draft</summary>${quoteView(scenario.startingQuote)}</details>` : `<div class="comparison"><section><h2>Starting Working Draft</h2>${quoteView(scenario.startingQuote)}</section><section><h2>Expected commercial state</h2>${scenario.expectedQuote ? quoteView(scenario.expectedQuote, true, scenario.expectedCalculation) : "<p>Defined by the step assertions below, not a complete expected Quote.</p>"}</section></div>`}
    <p>Expected amounts and missing fields are independently established scenario data. No expected amount is generated by the application calculator.</p>
    ${run?.turns.length ? `<section id="comparison"><h2>Expected / actual final Quote</h2><div class="comparison"><section><h3>Expected</h3>${scenario.expectedQuote ? quoteView(scenario.expectedQuote, true, scenario.expectedCalculation) : json(scenario.steps.at(-1)?.assertions)}</section><section><h3>Actual</h3>${quoteView(run.turns.at(-1)!.after)}</section></div></section>` : ""}
    <section id="script"><h2>Script and assertion definitions</h2>${scenario.history.length ? `<details><summary>Permitted conversation history</summary>${json(scenario.history)}</details>` : "<p>Starts without prior conversation. The runner supplies the current Working Draft, calculation and real assistant prompt/tools.</p>"}${scenario.steps.map((step, index) => `<details open><summary>Step ${index + 1} · ${h(step.kind)}</summary><p class="multiline">${h(step.kind === "artisan" ? step.text : step.note)}</p>${step.kind === "manual" ? quoteView(step.quote) : step.concurrentManualQuote ? `<h3>Concurrent manual save</h3>${quoteView(step.concurrentManualQuote)}` : ""}${json(step.assertions)}</details>`).join("")}</section>
    <section><h2>Required clarification</h2>${list(scenario.requiredClarification)}<h2>Forbidden mutations</h2>${list(scenario.forbiddenMutations)}<h2>Human checks</h2>${list(scenario.humanReview)}</section>
    ${run ? `<section id="execution"><h2>Conversation and execution</h2><nav aria-label="Turn navigation">${run.turns.map(turn => `<a href="#turn-${turn.step}">Step ${turn.step + 1}</a>`).join(" · ")}</nav>${run.turns.map(turnView).join("")}</section>${reviewForm(run, input.reviews)}` : ""}` : "<h1>No scenarios available</h1>"}</main></div><footer>Evaluation artifacts stay on this computer. Human approval does not authorize provider use or Publication.</footer></body></html>`;
}
