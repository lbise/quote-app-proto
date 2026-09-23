import { randomUUID } from "node:crypto";
import type { QuoteAIModelBoundary } from "../app/lib/quote-assistant.server";
import { saveRun } from "./artifacts";
import type { LiveSession } from "./live";
import { runScenario } from "./runner";
import { scenarioHash } from "./scenario-hash";
import { scenarios as library } from "./scenarios";
import { beginEvaluationSession } from "./sessions";
import type { EvaluationSessionPlan, Scenario } from "./types";

export function selectEvaluationScenarios(ids: string[], suite?: "contract" | "scenario", live = false): Scenario[] {
  if (new Set(ids).size !== ids.length) throw new Error("Each scenario ID may be selected once.");
  for (const id of ids) {
    const scenario = library.find(candidate => candidate.id === id);
    if (!scenario) throw new Error(`Unknown scenario ID: ${id}.`);
    if (suite && (scenario.suite === "contract" ? "contract" : "scenario") !== suite) throw new Error(`Scenario ID ${id} is not in the ${suite} suite.`);
  }
  const selected = library.filter(scenario => (!suite || (scenario.suite === "contract" ? "contract" : "scenario") === suite) && (!ids.length || ids.includes(scenario.id)));
  if (!selected.length) throw new Error(`No scenarios are selected${suite ? ` in the ${suite} suite` : ""}.`);
  const controlledOnly = selected.filter(scenario => scenario.execution === "controlled-only");
  if (live && controlledOnly.length) throw new Error(`--live cannot run controlled-only scenarios: ${controlledOnly.map(scenario => scenario.id).join(", ")}.`);
  return selected;
}

export type EvaluationLaunch = {
  artifactRoot: string;
  databaseUrl: string;
  scenarios: Scenario[];
  repetitions: number;
  boundary: QuoteAIModelBoundary;
  mode: EvaluationSessionPlan["mode"];
  settings: { requested: Record<string, unknown>; effective: Record<string, unknown> };
  limits?: EvaluationSessionPlan["limits"];
  pricing?: EvaluationSessionPlan["pricing"];
  authorization?: EvaluationSessionPlan["launchAuthorization"]["method"];
  live?: LiveSession;
  onRun?: (id: string, scenario: Scenario, repetition: number, automated: string) => void;
};

/** CLI and local server share this supervisor. A start returns immediately; the work outlives its caller. */
export function startEvaluation(options: EvaluationLaunch) {
  if (!options.scenarios.length || !Number.isSafeInteger(options.repetitions) || options.repetitions < 1 || options.repetitions > 1000) throw new Error("Select scenarios and 1–1000 repetitions.");
  if (options.mode === "live" && options.scenarios.some(scenario => scenario.execution === "controlled-only" || !library.some(candidate => candidate.id === scenario.id && scenarioHash(candidate) === scenarioHash(scenario)))) {
    throw new Error("Live selection requires known non-controlled scenario versions.");
  }
  if (options.mode === "live" && !options.live || options.mode !== "live" && options.live) throw new Error("Live transport requires a bounded live session.");
  if (options.mode === "live" && !options.live?.pricing) throw new Error("Live execution requires limits and usable pricing.");
  if (options.live && (options.boundary.model.provider !== options.live.modelProvider || options.boundary.model.id !== options.live.modelId)) throw new Error("Live model differs from the approved session.");
  if (options.live && (options.settings.requested.reasoning !== options.live.effectiveGeneration.reasoning
    || options.settings.requested.maxOutputTokens !== undefined && options.settings.requested.maxOutputTokens !== options.live.effectiveGeneration.maxOutputTokens)) {
    throw new Error("Requested live generation differs from validated effective settings.");
  }
  const id = options.live?.id ?? randomUUID();
  const hashes = options.scenarios.map(scenarioHash);
  const plan: EvaluationSessionPlan = {
    format: "quote-evaluation-session/v1", id, createdAt: new Date().toISOString(), mode: options.mode,
    selection: { scenarioIds: options.scenarios.map(scenario => scenario.id), repetitions: options.repetitions },
    model: { provider: options.boundary.model.provider, id: options.boundary.model.id,
      requested: options.settings.requested,
      effective: options.live ? { ...options.live.effectiveGeneration } : options.settings.effective },
    launchAuthorization: { method: options.authorization ?? "explicit-cli-launch", at: new Date().toISOString(), scenarioHashes: hashes },
    limits: options.live ? { ...options.live.limits } : options.limits ?? null,
    pricing: options.live ? { ...options.live.pricing, units: "nanodollars per token", assumptions: "Highest published text rate; full context plus configured output reserved before each request, never refunded." } : options.pricing ?? null,
    work: Array.from({ length: options.repetitions }, (_, index) => options.scenarios.map(scenario => ({
      id: randomUUID(), scenarioId: scenario.id, scenarioHash: scenarioHash(scenario), repetition: index + 1,
    }))).flat(),
  };
  const state = beginEvaluationSession(options.artifactRoot, plan);
  options.live?.onProgress((calls, reservedUsd) => state.progress(calls, reservedUsd));
  let cancelRequested = false;
  const completion = (async () => {
    try {
      state.start();
      for (const work of plan.work) {
        if (cancelRequested || options.live?.stopped) break;
        state.running(work.id);
        const scenario = options.scenarios.find(candidate => candidate.id === work.scenarioId)!;
        const run = await runScenario(scenario, {
          databaseUrl: options.databaseUrl, modelBoundary: options.boundary, repetition: work.repetition,
          sessionId: id, runId: work.id, live: options.live,
          ...(!options.live ? { modelSettings: { transport: "faux-controlled", mode: "offline-smoke", providerCalls: false, intentionallyNoop: true } } : {}),
        });
        await saveRun(options.artifactRoot, run);
        state.completed(work.id, run.id, { calls: run.live?.sessionCalls ?? 0, reservedUsd: run.live?.sessionReservedUsd ?? 0 });
        options.onRun?.(run.id, scenario, work.repetition, run.automated);
      }
      options.live?.close();
      if (cancelRequested || options.live?.stopped) state.stop(options.live?.stopped ?? "user_stop");
      else state.finish();
    } catch (error) {
      if (options.live) state.progress(options.live.calls.length, options.live.calls.reduce((sum, call) => sum + call.reservedUsd, 0));
      state.fail(error instanceof Error ? error.message : "execution_failed");
      throw error;
    } finally { options.live?.close(); }
  })();
  return { id, plan, completion, cancel() { cancelRequested = true; options.live?.cancel("user_stop"); } };
}
