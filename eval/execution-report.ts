import { escapeHtml as h } from "./html";
import type { EvaluationRun, EvaluationSessionRecord, Scenario } from "./types";
import type { OpenRouterListing } from "./openrouter-models";

export type ExecutionView = {
  executionEnabled?: boolean;
  launchView?: boolean;
  launchRequestId?: string;
  reuseSession?: EvaluationSessionRecord;
  sessionId?: string;
  providerProblem?: string;
  googleProblem?: string;
  routerProblem?: string;
  modelChoices?: OpenRouterListing;
};

export function launchForm(input: ExecutionView & { scenarios: Scenario[]; scenarioId?: string }): string {
  const prior = input.reuseSession?.plan;
  const selected = prior?.selection.scenarioIds ?? (input.scenarioId ? [input.scenarioId] : []);
  const settings = prior?.model.requested;
  const number = (name: string, label: string, value: unknown, max: number, step = "1", accessibleLabel = label) => `<label>${h(label)}<input type="number" name="${name}" aria-label="${h(accessibleLabel)}" value="${h(value)}" min="${step}" max="${max}" step="${step}" required></label>`;
  const missing = selected.filter(id => !input.scenarios.some(scenario => scenario.id === id));
  const choices = [...input.scenarios].sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || Number(b.suite === "contract") - Number(a.suite === "contract"));
  return `<section class="launch"><div class="page-heading"><div><h1>Start an evaluation</h1><p class="muted">Select scenarios and configure a model.</p></div><a href="/">All sessions</a></div>
    ${prior ? `<p class="notice">Settings reused. Start creates a new session with current scenario versions and a fresh budget. <a href="/?session=${encodeURIComponent(prior.id)}">Source session</a></p>` : ""}
    ${missing.length ? `<p class="failure">Unavailable scenarios: ${h(missing.join(", "))}. Choose a current selection.</p>` : ""}
    ${prior?.model.provider === "openrouter" && !input.modelChoices ? `<p class="notice">The earlier OpenRouter model is unavailable until server credentials and metadata are configured. No substitute was selected.</p>` : ""}
    ${input.providerProblem ? `<p class="failure notice" role="status">${h(input.providerProblem)}</p>` : ""}
    <form id="launch-form" class="launch-layout" method="post" action="/sessions" data-unavailable="${Boolean(input.providerProblem)}">
    <input type="hidden" name="requestId" value="${h(input.launchRequestId)}">
    <fieldset class="selection-pane"><legend>Scenarios</legend>
      <div class="selection-tools"><label for="scenario-search">Search scenarios<input id="scenario-search" type="search" placeholder="Title, trade or scenario ID" autocomplete="off"></label>
      <label for="selection-suite">Selection<select id="selection-suite" name="suite"><option value="">Custom selection</option><option value="contract">Contract suite</option><option value="scenario">Scenario suite</option></select></label></div>
      <div class="selection-actions"><span id="visible-count" class="muted">${choices.length} scenarios</span><div class="toolbar"><button type="button" class="secondary compact" id="select-visible">Select visible</button><button type="button" class="secondary compact" id="clear-selection">Clear</button></div></div>
      <div class="scenario-selection">${choices.map(scenario => `<div class="scenario-choice" data-search="${h(`${scenario.title} ${scenario.id} ${scenario.profession}`.toLowerCase())}"><label><input type="checkbox" name="scenario" value="${h(scenario.id)}" data-suite="${scenario.suite === "contract" ? "contract" : "scenario"}" data-controlled="${scenario.execution === "controlled-only"}"${selected.includes(scenario.id) && scenario.execution !== "controlled-only" ? " checked" : ""}${scenario.execution === "controlled-only" ? " disabled" : ""}><span>${h(scenario.title)}</span></label><div class="scenario-choice-meta"><span>${scenario.suite === "contract" ? "Contract" : h(scenario.profession)}${scenario.execution === "controlled-only" ? " · Offline only" : ""}</span><a href="/?scenario=${encodeURIComponent(scenario.id)}" target="_blank" rel="noopener">Preview<span class="sr-only"> inputs and expectations for ${h(scenario.title)} (new tab)</span></a></div></div>`).join("")}</div>
      <p id="no-scenarios" class="muted" hidden>No matching scenarios. Try another search.</p>
      <p id="selection-warning" class="failure" role="status"></p>
    </fieldset>
    <div class="configuration-pane">
    <fieldset><legend>Model</legend>
      ${input.modelChoices ? `<div class="field-stack"><label for="provider">Provider<select name="provider" id="provider"><option value="openrouter"${prior?.model.provider === "openrouter" || !prior ? " selected" : ""}>OpenRouter</option><option value="google"${prior?.model.provider === "google" ? " selected" : ""}${input.googleProblem ? " disabled" : ""}>Direct Google</option></select></label>
      <label for="model">Model<select name="model" id="model"><option value="">Choose a model</option>${input.modelChoices.models.map(choice => `<option value="${h(choice.id)}"${choice.id === prior?.model.id && prior.model.provider === "openrouter" ? " selected" : ""}${choice.candidate ? "" : " disabled"}>${h(choice.name || choice.id)}${choice.candidate ? "" : ` · unavailable: ${h(choice.reason)}`}</option>`).join("")}</select></label></div>
      ${input.modelChoices.error ? `<p class="failure">OpenRouter metadata unavailable: ${h(input.modelChoices.error)}</p>` : ""}
      ${input.googleProblem ? `<details class="help-details"><summary>Direct Google unavailable</summary><p>${h(input.googleProblem)}</p></details>` : ""}` : `<label for="provider">Provider<select name="provider" id="provider"><option value="openrouter" disabled>OpenRouter unavailable</option><option value="google" selected>Direct Google</option></select></label><p class="model-name">gemini-3.5-flash-lite</p><details class="help-details"><summary>OpenRouter unavailable</summary><p role="status">${h(input.routerProblem ?? "OpenRouter model metadata is unavailable.")}</p></details>`}
      <div class="field-pair"><label for="reasoning">Reasoning<select id="reasoning" name="reasoning">${["off", "minimal", "low", "medium", "high"].filter(level => input.modelChoices || level !== "off").map(level => `<option value="${level}"${level === (settings?.reasoning ?? (input.modelChoices ? "off" : "low")) ? " selected" : ""}>${level[0].toUpperCase() + level.slice(1)}</option>`).join("")}</select></label>
      ${number("repetitions", "Repetitions", prior?.selection.repetitions ?? 1, 1000)}</div>
      <p id="model-status" class="field-hint" role="status">${input.modelChoices ? "Choose a model to verify settings and pricing." : "Google requires reasoning; Off is unavailable."}</p>
      <details class="help-details"><summary>Advanced settings</summary>${number("maxOutputTokens", "Output-token limit", settings?.maxOutputTokens ?? 4096, input.modelChoices ? 65536 : 4096)}<p class="field-hint">Combined output and thinking tokens.</p></details>
    </fieldset>
    <fieldset><legend>Session limits</legend>
      <div class="limits-fields">${number("maxCalls", "Provider calls", prior?.limits?.maxCalls ?? 9, 10000, "1", "Maximum provider calls")}${number("maxElapsedMs", "Time · ms", prior?.limits?.maxElapsedMs ?? 120000, 3600000, "1", "Maximum elapsed time in milliseconds")}${number("maxSpendUsd", "Budget · USD", (prior?.limits?.maxSpendUsd ?? 6).toFixed(9).replace(/\.?0+$/, ""), 1000000, "0.000000001", "Maximum spend in USD")}</div>
      <p class="field-hint">Shared by every scenario and repetition.</p>
      <details class="help-details"><summary>How limits work</summary><p>All selected scenarios and repetitions share these limits and one deadline. Reservations are retained, not refunded after a call. USD limits use conservative documented token rates, not a provider invoice guarantee.</p></details>
    </fieldset>
    <div class="launch-submit">
      <p data-testid="selection-summary" id="selection-summary" role="status"></p>
      <details class="help-details"><summary>Selected scenarios</summary><ul id="selected-scenarios" aria-label="Selected scenarios"></ul></details>
      <p class="field-hint">Start sends the selected scenario inputs to the chosen provider.</p>
      <details class="help-details"><summary>Authorization details</summary><p>Start authorizes sending only the selected adapted scenario inputs to the selected provider and model with these settings and limits. It does not change scenario review flags, copy human approvals or authorize sending original source documents.</p></details>
      <p id="launch-error" class="failure" role="alert"></p><button type="submit"${input.providerProblem ? " disabled" : ""}>Start</button>
    </div>
    <noscript><p>Enable JavaScript to start and monitor an evaluation. Browsing and human reviews still work without it.</p></noscript>
    </div></form></section>`;
}

export function sessionCost(session: EvaluationSessionRecord, runs: EvaluationRun[]) {
  const found = session.plan.work.map(work => runs.find(run => run.id === work.id && run.sessionId === session.plan.id && run.scenarioHash === work.scenarioHash));
  const priced = found.filter(run => run?.cost.estimatedUsd !== null && run?.cost.estimatedUsd !== undefined);
  return { estimatedUsageUsd: priced.reduce((sum, run) => sum + run!.cost.estimatedUsd!, 0), estimateComplete: priced.length === found.length };
}

export function sessionProgress(session: EvaluationSessionRecord, runs: EvaluationRun[] = []): string {
  const { plan, state } = session;
  const active = plan.work.find(work => work.id === state.activeWorkId);
  const running = ["starting", "running"].includes(state.status);
  const cost = sessionCost(session, runs);
  return `<section id="session-progress" data-session-id="${h(plan.id)}"><div class="page-heading"><div><h1>Evaluation progress</h1><p class="muted">${h(plan.model.provider)} / ${h(plan.model.id)}</p></div><a href="/">All sessions</a></div>
    <div class="progress-overview"><div role="status"><p>Execution: <strong id="execution-state" class="status">${h(state.status)}</strong></p><p id="completed-count">${state.work.filter(work => work.status === "completed").length} / ${plan.work.length} Scenario Runs completed</p><p id="active-scenario" class="muted">${active ? `Active scenario: ${h(active.scenarioId)} · repetition ${active.repetition}` : "No active scenario."}</p></div>
    <div class="toolbar"><a class="button secondary" href="/?reuse=${encodeURIComponent(plan.id)}">Reuse selection and settings</a><form id="stop-form" method="post" action="/sessions/${encodeURIComponent(plan.id)}/stop"><button type="submit" class="secondary"${running ? "" : " disabled"}>Stop</button></form></div></div>
    <p id="execution-reason" class="failure">${h(state.reason)}</p>
    <p id="progress-error" class="failure" role="alert"></p>
    <h2>Scenario Runs</h2><ol id="progress-work" class="progress-work">${plan.work.map(work => {
      const result = state.work.find(item => item.id === work.id);
      return `<li><span>${h(work.scenarioId)} <small>Repetition ${work.repetition}</small></span><span class="status">${h(result?.status ?? "missing")}</span>${result?.runId ? `<a href="/?run=${encodeURIComponent(result.runId)}">View result</a>` : ""}</li>`;
    }).join("")}</ol>
    <details class="evidence-panel"><summary>Settings and usage</summary><p>Reasoning: ${h(plan.model.effective.reasoning ?? "not recorded")} · Output-token limit: ${h(plan.model.effective.maxOutputTokens ?? "not recorded")}</p>
    <p id="session-usage">${state.calls} provider calls · USD ${h(state.reservedUsd)} reserved · Estimated usage cost: USD ${h(cost.estimatedUsageUsd)}${cost.estimateComplete ? "" : " (incomplete)"}</p>
    <p>Session limits: ${h(plan.limits?.maxCalls ?? "unavailable")} calls · ${h(plan.limits?.maxElapsedMs ?? "unavailable")} ms · USD ${h(plan.limits?.maxSpendUsd ?? "unavailable")}</p><p class="muted">Session ID: <code>${h(plan.id)}</code></p></details>
    <p id="execution-guidance" class="field-hint">${running ? "Execution continues if you leave this page. Reopen this session to see progress." : "Execution has ended. Saved results remain available in this session."}</p>
    <details class="help-details"><summary>Stopping and recovery</summary><p>Stop attempts to abort ongoing provider work and skips remaining work. Completed evidence and reservations stay saved. Cancellation does not guarantee the provider avoids charging.</p><p>A server restart interrupts unfinished work and never resumes provider calls.</p></details>
    </section>`;
}
