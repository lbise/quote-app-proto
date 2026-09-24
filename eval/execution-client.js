// The browser only submits authorization and displays persisted server state.
// Closing this page never cancels server-owned work.
async function post(path, body) {
  const response = await fetch(path, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  const type = response.headers.get("content-type") ?? "";
  const result = type.includes("application/json") ? await response.json() : { error: await response.text() };
  if (!response.ok) throw new Error(result.error || "The request was rejected. Check your settings and try again.");
  return result;
}

const launch = document.querySelector("#launch-form");
if (launch) {
  const button = launch.querySelector("button[type=submit]");
  const choices = [...launch.querySelectorAll("input[name=scenario]")];
  const repetitions = launch.elements.namedItem("repetitions");
  const callsPerRun = launch.elements.namedItem("callsPerRun");
  const sessionMinutes = launch.elements.namedItem("sessionMinutes");
  const elapsedMs = launch.elements.namedItem("maxElapsedMs");
  sessionMinutes.addEventListener("input", () => { elapsedMs.value = String(Number(sessionMinutes.value) * 60000); });
  const error = document.querySelector("#launch-error");
  let submitting = false;
  const search = document.querySelector("#scenario-search");
  const behavior = document.querySelector("#behavior-filter");
  const clearSelection = document.querySelector("#clear-selection");
  function filterScenarios() {
    const query = search.value.trim().toLowerCase();
    const rows = choices.map(choice => choice.closest(".scenario-choice"));
    for (const row of rows) row.hidden = !row.dataset.search.includes(query) || Boolean(behavior.value && !row.dataset.groups.split(" ").includes(behavior.value));
    const visible = rows.filter(row => !row.hidden).length;
    document.querySelector("#visible-count").textContent = `${visible} of ${rows.length} items`;
    document.querySelector("#no-scenarios").hidden = visible > 0;
  }
  search.addEventListener("input", filterScenarios);
  behavior.addEventListener("change", filterScenarios);
  document.querySelector("#select-visible").addEventListener("click", () => {
    for (const choice of choices) if (!choice.disabled && !choice.closest(".scenario-choice").hidden) choice.checked = true;
    selection();
  });
  for (const [buttonId, kind] of [["#select-scenarios", "scenario"], ["#select-tool-tests", "contract"]]) {
    document.querySelector(buttonId).addEventListener("click", () => {
      for (const choice of choices) if (!choice.disabled && choice.dataset.suite === kind) choice.checked = true;
      selection();
    });
  }
  clearSelection.addEventListener("click", () => {
    for (const choice of choices) choice.checked = false;
    selection();
  });
  const provider = launch.elements.namedItem("provider");
  const model = launch.elements.namedItem("model");
  const reasoning = launch.elements.namedItem("reasoning");
  const output = launch.elements.namedItem("maxOutputTokens");
  const modelStatus = document.querySelector("#model-status");
  const routerOptions = model ? [...model.options].map(option => option.cloneNode(true)) : [];
  let verified = !model;
  let checkVersion = 0;
  async function checkModel() {
    if (!model) return;
    const version = ++checkVersion;
    verified = false;
    if (provider.value === "google") {
      model.replaceChildren(new Option("gemini-3.5-flash-lite", "gemini-3.5-flash-lite"));
      const previous = reasoning.value;
      reasoning.replaceChildren(...["minimal", "low", "medium", "high"].map(level => new Option(level, level)));
      reasoning.value = ["minimal", "low", "medium", "high"].includes(previous) ? previous : "low";
      output.max = "4096";
      if (Number(output.value) > 4096) output.value = "4096";
      modelStatus.textContent = "Direct Google requires reasoning. Off is unavailable.";
      verified = true;
      selection();
      return;
    }
    if (!model.dataset.routerVisible) {
      model.replaceChildren(...routerOptions.map(option => option.cloneNode(true)));
      model.dataset.routerVisible = "true";
    }
    if (!model.value) { modelStatus.textContent = "Choose an OpenRouter model."; selection(); return; }
    modelStatus.textContent = "Checking current endpoint capabilities and prices…";
    selection();
    try {
      const response = await fetch(`/models?id=${encodeURIComponent(model.value)}`);
      if (!response.ok) throw new Error("Model metadata request failed.");
      const details = await response.json();
      if (version !== checkVersion) return;
      if (!details.available) { modelStatus.textContent = `Unavailable: ${details.reason || "Model metadata or pricing cannot establish a safe bound."}`; selection(); return; }
      const levels = details.reasoning?.supportedLevels ?? [];
      const choices = [...(details.reasoning?.offEstablished ? ["off"] : []), ...levels];
      const previous = reasoning.value;
      reasoning.replaceChildren(...(!details.reasoning?.offEstablished ? [new Option("Choose a supported setting", "")] : []),
        ...choices.map(level => new Option(level === "off" ? "Off" : level, level)));
      reasoning.value = choices.includes(previous) ? previous : details.reasoning?.offEstablished ? "off" : "";
      output.max = String(details.maxOutputTokens);
      if (Number(output.value) > details.maxOutputTokens) output.value = String(details.maxOutputTokens);
      modelStatus.textContent = details.reasoning?.offEstablished ? "Off is available. Endpoint and price checks passed for this model." : "Choose a supported reasoning setting. Endpoint and price checks passed for this model.";
      verified = true;
      selection();
    } catch {
      if (version !== checkVersion) return;
      modelStatus.textContent = "Model metadata is unavailable. No provider request will be sent.";
      selection();
    }
  }
  provider?.addEventListener("change", () => { if (provider.value === "openrouter") model.dataset.routerVisible = ""; void checkModel(); });
  model?.addEventListener("change", () => { void checkModel(); });
  void checkModel();
  function selection() {
    for (const choice of choices) choice.closest(".scenario-choice").dataset.selected = String(choice.checked);
    const selected = choices.filter(choice => choice.checked);
    const count = selected.length;
    const repeat = Number(repetitions.value);
    document.querySelector("#selection-summary").textContent = `${count} ${count === 1 ? "selected item" : "selected items"} × ${repeat} ${repeat === 1 ? "repetition" : "repetitions"} = ${count * repeat} planned Scenario Runs.`;
    document.querySelector("#selected-scenarios").replaceChildren(...selected.map(choice => {
      const item = document.createElement("li");
      const kind = choice.dataset.suite === "contract" ? "Tool validation test" : "Scenario";
      item.textContent = `${kind} · ${choice.closest("label").textContent}`;
      return item;
    }));
    document.querySelector("#selection-empty").hidden = count > 0;
    const tooManyCalls = count * repeat * Number(callsPerRun.value) > 10000;
    document.querySelector("#selection-warning").textContent = tooManyCalls ? "Reduce repetitions, selected items or calls per run. The session can allow at most 10,000 provider calls." : "";
    button.disabled = submitting || launch.dataset.unavailable === "true" || !count || tooManyCalls || !verified || (model && !model.value) || !reasoning.value;
  }
  launch.addEventListener("input", selection);
  launch.addEventListener("change", selection);
  selection();
  launch.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    selection();
    button.textContent = "Starting…";
    error.textContent = "";
    try {
      const body = new URLSearchParams(new FormData(launch));
      body.delete("sessionMinutes");
      const result = await post(launch.action, body);
      location.assign(`/?session=${encodeURIComponent(result.id)}`);
    } catch (failure) {
      error.textContent = `${failure.message} If the response was lost, retry with these same settings or check session history before starting a different evaluation.`;
      submitting = false;
      button.textContent = "Start";
      selection();
    }
  });
}

const progress = document.querySelector("#session-progress");
if (progress) {
  const id = progress.dataset.sessionId;
  const stop = document.querySelector("#stop-form");
  const button = stop.querySelector("button");
  const error = document.querySelector("#progress-error");
  let stopPending = false;
  let timer;
  function display({ plan, state, estimatedUsageUsd, estimateComplete }) {
    const running = ["starting", "running"].includes(state.status);
    document.querySelector("#execution-state").textContent = state.status;
    document.querySelector("#completed-count").textContent = `${state.work.filter(work => work.status === "completed").length} / ${plan.work.length} Scenario Runs completed`;
    const active = plan.work.find(work => work.id === state.activeWorkId);
    document.querySelector("#active-scenario").textContent = active ? `Active scenario: ${active.scenarioId} · repetition ${active.repetition}` : "No active scenario.";
    document.querySelector("#session-usage").textContent = `${state.calls} provider calls · USD ${state.reservedUsd} reserved · Estimated usage cost: USD ${estimatedUsageUsd ?? 0}${estimateComplete ? "" : " (incomplete)"}`;
    document.querySelector("#execution-reason").textContent = state.reason ?? "";
    document.querySelector("#execution-guidance").textContent = running
      ? "Execution continues if you leave this page. Reopen this session to see progress."
      : "Execution has ended. Saved results remain available in this session.";
    button.disabled = !running || stopPending;
    button.textContent = running && stopPending ? "Stopping…" : "Stop";
    const rows = plan.work.map(work => {
      const result = state.work.find(item => item.id === work.id);
      const row = document.createElement("li");
      const title = document.createElement("span");
      title.textContent = work.scenarioId;
      const repetition = document.createElement("small");
      repetition.textContent = `Repetition ${work.repetition}`;
      title.append(repetition);
      const status = document.createElement("span");
      status.className = "status";
      status.textContent = result?.status ?? "missing";
      row.append(title, status);
      if (result?.runId) {
        const link = document.createElement("a");
        link.href = `/?run=${encodeURIComponent(result.runId)}`;
        link.textContent = "View result";
        row.append(link);
      }
      return row;
    });
    document.querySelector("#progress-work").replaceChildren(...rows);
    return running;
  }
  async function poll() {
    clearTimeout(timer);
    try {
      const response = await fetch(`/sessions/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error("Progress is unavailable. Check that the evaluator server is running.");
      const running = display(await response.json());
      error.textContent = "";
      if (running) timer = setTimeout(poll, 1000);
    } catch {
      error.textContent = "Progress could not refresh. Reconnecting; saved evidence remains on the server.";
      timer = setTimeout(poll, 3000);
    }
  }
  stop.addEventListener("submit", async event => {
    event.preventDefault();
    if (stopPending) return;
    stopPending = true;
    button.disabled = true;
    button.textContent = "Stopping…";
    try {
      await post(stop.action, new URLSearchParams());
      await poll();
    } catch (failure) {
      error.textContent = `${failure.message} You can retry Stop safely.`;
      stopPending = false;
      button.disabled = false;
      button.textContent = "Stop";
    }
  });
  poll();
}
