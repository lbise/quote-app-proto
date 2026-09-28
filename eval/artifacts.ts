import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EvaluationRun, HumanReview } from "./types";

/** The Scenario Run does not exist, possibly because it was deleted. Safe to show. */
export class MissingScenarioRunError extends Error {
  constructor() { super("Scenario Run not found. It may have been deleted."); }
}
/**
 * Serializes review writes and deletions across processes. The callback must be
 * synchronous: an await inside it could interleave another same-process request.
 */
export function withArtifactLock<T>(root: string, critical: () => T): T {
  mkdirSync(resolve(root), { recursive: true, mode: 0o700 });
  const fd = openSync(join(resolve(root), ".artifacts.lock"), "a", 0o600);
  try {
    // Like the session lock, flock locks the inherited open file description.
    execFileSync("flock", ["-w", "10", "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
    return critical();
  } finally { closeSync(fd); }
}
function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
function identifier(id: string) {
  if (!safeId.test(id)) throw new Error("Invalid artifact identifier.");
  return id;
}
async function directory(root: string, name: string) {
  const path = join(root, name);
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}
async function names(path: string): Promise<string[]> {
  try { return (await readdir(path)).filter(name => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
/** Defense in depth for provider metadata. Commercial text is intentionally retained locally. */
export function withoutCredentials(key: string, value: unknown): unknown {
  if (/^(api[-_]?key|authorization|cookie|set-cookie|password|secret|access[-_]?token|refresh[-_]?token|credential[s]?)$/i.test(key)) return "[redacted]";
  if (typeof value !== "string") return value;
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:[A-Z_]*API[_-]?KEY|password|secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?[^\s"',;]+/gi, "[redacted credential]")
    .replace(/\bAIza[\w-]{35}\b|\bsk-[\w-]{20,}\b|\bAKIA[A-Z0-9]{16}\b/g, "[redacted credential]");
}
export async function saveRun(root: string, run: EvaluationRun): Promise<void> {
  const path = join(await directory(root, "runs"), `${identifier(run.id)}.json`);
  await writeFile(path, JSON.stringify(run, withoutCredentials, 2) + "\n", { flag: "wx", mode: 0o600 });
}
export async function readRun(root: string, id: string): Promise<EvaluationRun> {
  return JSON.parse(await readFile(join(root, "runs", `${identifier(id)}.json`), "utf8"));
}
export function readRunSync(root: string, id: string): EvaluationRun | undefined {
  try { return JSON.parse(readFileSync(join(root, "runs", `${identifier(id)}.json`), "utf8")); }
  catch (error) { if (missing(error)) return undefined; throw error; }
}
/** A run deleted between listing and reading is omitted rather than failing the page. */
export async function listRuns(root: string): Promise<EvaluationRun[]> {
  const runs = await Promise.all((await names(join(root, "runs"))).map(name => readRun(root, name.slice(0, -5)).catch(error => { if (missing(error)) return undefined; throw error; })));
  return runs.filter((run): run is EvaluationRun => Boolean(run));
}
export async function readReviews(root: string, runId: string): Promise<HumanReview[]> {
  const path = join(root, "reviews", identifier(runId));
  const reviews = await Promise.all((await names(path)).map(async name => {
    try { return JSON.parse(await readFile(join(path, name), "utf8")) as HumanReview; }
    catch (error) { if (missing(error)) return undefined; throw error; }
  }));
  return reviews.filter((review): review is HumanReview => Boolean(review)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export type ReviewInput = Pick<HumanReview, "scenarioHash" | "reviewer" | "wording" | "inventedFacts" | "clarification" | "notes">;
/** The run check and write share the deletion lock, so a stale submission cannot recreate deleted reviews. */
export async function saveReview(root: string, runId: string, input: ReviewInput): Promise<HumanReview> {
  identifier(runId);
  return withArtifactLock(root, () => {
    const run = readRunSync(root, runId);
    if (!run) throw new MissingScenarioRunError();
    if (input.scenarioHash !== run.scenarioHash) throw new Error("Review belongs to a different scenario version.");
    if (typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 200
      || typeof input.notes !== "string" || input.notes.length > 10_000
      || ![input.wording, input.inventedFacts, input.clarification].every(value => ["pass", "fail", "pending"].includes(value))) {
      throw new Error("Invalid human review.");
    }
    const review: HumanReview = { format: "quote-evaluation-review/v1", id: randomUUID(), runId,
      scenarioHash: run.scenarioHash, createdAt: new Date().toISOString(), reviewer: input.reviewer.trim(),
      wording: input.wording, inventedFacts: input.inventedFacts, clarification: input.clarification, notes: input.notes };
    const path = join(root, "reviews", runId);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(join(path, `${review.id}.json`), JSON.stringify(review, withoutCredentials, 2) + "\n", { flag: "wx", mode: 0o600 });
    return JSON.parse(JSON.stringify(review, withoutCredentials)) as HumanReview;
  });
}
