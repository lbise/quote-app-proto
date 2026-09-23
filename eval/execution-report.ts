import { escapeHtml as h } from "./html";
import type { EvaluationSessionRecord, Scenario } from "./types";

export type ExecutionView = {
  executionEnabled?: boolean;
  launchView?: boolean;
  launchRequestId?: string;
  reuseSession?: EvaluationSessionRecord;
  sessionId?: string;
  providerProblem?: string;
};

export function launchForm(input: ExecutionView & { scenarios: Scenario[]; scenarioId?: string }): string {
  const prior = input.reuseSession?.plan;
  const selected = prior?.selection.scenarioIds ?? (input.scenarioId ? [input.scenarioId] : []);
  const settings = prior?.model.requested;
  const number = (name: string, label: string, value: unknown, max: number, step = "1") => `<label>${h(label)}<input type="number" name="${name}" value="${h(value)}" min="${step}" max="${max}" step="${step}" required></label>`;
  const missing = selected.filter(id => !input.scenarios.some(scenario => scenario.id === id));
  const choices = [...input.scenarios].sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || Number(b.suite === "contract") - Number(a.suite === "contract"));
  return `<section class="launch"><h1>Start an evaluation</h1>
    <p>Browse each scenario's inputs and expectations before selecting it. Preview links open in a new tab so your selection stays here.</p>
    ${prior ? `<p>Settings copied from <a href="/?session=${encodeURIComponent(prior.id)}">${h(prior.id)}</a>. Start creates a new session with a fresh budget and current scenario versions. No human approvals are copied.</p>` : ""}
    ${missing.length ? `<p class="failure">Unavailable scenarios: ${h(missing.join(", "))}. Choose a current selection.</p>` : ""}
    ${prior && (prior.model.provider !== "google" || prior.model.id !== "gemini-3.5-flash-lite") ? `<p class="notice">The previous model is not supported for browser execution. This launch uses the Google model shown below; check all settings before Start.</p>` : ""}
    ${input.providerProblem ? `<p class="failure" role="status">${h(input.providerProblem)}</p>` : ""}
    <form id="launch-form" method="post" action="/sessions" data-unavailable="${Boolean(input.providerProblem)}">
    <input type="hidden" name="requestId" value="${h(input.launchRequestId)}">
    <fieldset><legend>Selection</legend>
      <label for="selection-suite">Selection</label><select id="selection-suite" name="suite"><option value="">One scenario or custom subset</option><option value="contract">Contract suite</option><option value="scenario">Scenario suite</option></select>
      <div class="scenario-selection">${choices.map(scenario => `<div class="scenario-choice"><label><input type="checkbox" name="scenario" value="${h(scenario.id)}" data-suite="${scenario.suite === "contract" ? "contract" : "scenario"}" data-controlled="${scenario.execution === "controlled-only"}"${selected.includes(scenario.id) && scenario.execution !== "controlled-only" ? " checked" : ""}${scenario.execution === "controlled-only" ? " disabled" : ""}>${h(scenario.title)}${scenario.execution === "controlled-only" ? " · controlled-only, unavailable live" : ""}</label><a href="/?scenario=${encodeURIComponent(scenario.id)}" target="_blank" rel="noopener">Preview inputs and expectations<span class="sr-only"> for ${h(scenario.title)}</span></a></div>`).join("")}</div>
      ${number("repetitions", "Repetitions", prior?.selection.repetitions ?? 1, 1000)}
      <p data-testid="selection-summary" id="selection-summary" role="status"></p><ul id="selected-scenarios" aria-label="Selected scenarios"></ul><p id="selection-warning" class="failure"></p>
    </fieldset>
    <fieldset><legend>Model and reasoning</legend><p>Direct Google · <strong>gemini-3.5-flash-lite</strong></p>
      <label for="reasoning">Reasoning</label><select id="reasoning" name="reasoning">${["minimal", "low", "medium", "high"].map(level => `<option value="${level}"${level === (settings?.reasoning ?? "low") ? " selected" : ""}>${level[0].toUpperCase() + level.slice(1)}</option>`).join("")}</select>
      <p>This model requires reasoning. Off is not supported.</p>
      <details><summary>Advanced settings</summary>${number("maxOutputTokens", "Output-token limit", settings?.maxOutputTokens ?? 4096, 4096)}<p>Combined output and thinking tokens, from 1 to 4096.</p></details>
    </fieldset>
    <fieldset><legend>Session-wide limits</legend><p>All selected scenarios and repetitions share these limits and one deadline. Reservations are retained, not refunded after a call.</p>
      <div class="review-fields">${number("maxCalls", "Maximum provider calls", prior?.limits?.maxCalls ?? 9, 10000)}${number("maxElapsedMs", "Maximum elapsed time in milliseconds", prior?.limits?.maxElapsedMs ?? 120000, 3600000)}${number("maxSpendUsd", "Maximum spend in USD", (prior?.limits?.maxSpendUsd ?? 6).toFixed(9).replace(/\.?0+$/, ""), 1000000, "0.000000001")}</div>
      <p>USD limits use conservative documented token rates, not a provider invoice guarantee.</p>
    </fieldset>
    <p>Start authorizes sending only the selected adapted scenario inputs to this Google model with the settings and limits above. It does not change scenario review flags or authorize sending original source documents.</p>
    <p id="launch-error" class="failure" role="alert"></p><button type="submit"${input.providerProblem ? " disabled" : ""}>Start</button>
    <noscript><p>Enable JavaScript to start and monitor an evaluation. Browsing and human reviews still work without it.</p></noscript>
    </form></section>`;
}

export function sessionProgress(session: EvaluationSessionRecord): string {
  const { plan, state } = session;
  const active = plan.work.find(work => work.id === state.activeWorkId);
  const running = ["starting", "running"].includes(state.status);
  return `<section id="session-progress" data-session-id="${h(plan.id)}"><h1>Evaluation progress</h1><p>${h(plan.id)}</p>
    <p>${h(plan.model.provider)} / ${h(plan.model.id)} · Reasoning: ${h(plan.model.effective.reasoning ?? "not recorded")} · Output-token limit: ${h(plan.model.effective.maxOutputTokens ?? "not recorded")}</p>
    <div role="status"><p>Execution: <strong id="execution-state">${h(state.status)}</strong></p><p id="completed-count">${state.work.filter(work => work.status === "completed").length} / ${plan.work.length} Scenario Runs completed</p><p id="active-scenario">${active ? `Active scenario: ${h(active.scenarioId)} · repetition ${active.repetition}` : "No active scenario."}</p></div>
    <p id="session-usage">${state.calls} provider calls · USD ${h(state.reservedUsd)} reserved</p>
    <p>Session limits: ${h(plan.limits?.maxCalls ?? "unavailable")} calls · ${h(plan.limits?.maxElapsedMs ?? "unavailable")} ms · USD ${h(plan.limits?.maxSpendUsd ?? "unavailable")}</p>
    <p id="execution-reason" class="failure">${h(state.reason)}</p>
    <p>The server owns this work. You can navigate away or close this tab, then reopen this session from history. A server restart interrupts unfinished work and never resumes provider calls.</p>
    <form id="stop-form" method="post" action="/sessions/${encodeURIComponent(plan.id)}/stop"><button type="submit"${running ? "" : " disabled"}>Stop</button></form>
    <p>Stop attempts to abort ongoing provider work and skips remaining work. Completed evidence and reservations stay saved. Cancellation does not guarantee the provider avoids charging.</p>
    <p id="progress-error" class="failure" role="alert"></p><p><a href="/?reuse=${encodeURIComponent(plan.id)}">Reuse selection and settings</a> · <a href="/">All sessions</a></p>
    <h2>Planned Scenario Runs</h2><ol id="progress-work">${plan.work.map(work => {
      const result = state.work.find(item => item.id === work.id);
      return `<li>${h(work.scenarioId)} · repetition ${work.repetition} · ${h(result?.status ?? "missing")}${result?.runId ? ` · <a href="/?run=${encodeURIComponent(result.runId)}">View result</a>` : ""}</li>`;
    }).join("")}</ol></section>`;
}
