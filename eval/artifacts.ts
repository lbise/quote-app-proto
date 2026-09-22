import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvaluationRun, HumanReview } from "./types";

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
function withoutCredentials(key: string, value: unknown): unknown {
  return /^(api[-_]?key|authorization|cookie|set-cookie|password|secret|access[-_]?token|refresh[-_]?token|credential[s]?)$/i.test(key) ? "[redacted]" : value;
}
export async function saveRun(root: string, run: EvaluationRun): Promise<void> {
  const path = join(await directory(root, "runs"), `${identifier(run.id)}.json`);
  await writeFile(path, JSON.stringify(run, withoutCredentials, 2) + "\n", { flag: "wx", mode: 0o600 });
}
export async function readRun(root: string, id: string): Promise<EvaluationRun> {
  return JSON.parse(await readFile(join(root, "runs", `${identifier(id)}.json`), "utf8"));
}
export async function listRuns(root: string): Promise<EvaluationRun[]> {
  return Promise.all((await names(join(root, "runs"))).map(name => readRun(root, name.slice(0, -5))));
}
export async function readReviews(root: string, runId: string): Promise<HumanReview[]> {
  const path = join(root, "reviews", identifier(runId));
  const reviews: HumanReview[] = await Promise.all((await names(path)).map(async name => JSON.parse(await readFile(join(path, name), "utf8"))));
  return reviews.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export type ReviewInput = Pick<HumanReview, "scenarioHash" | "reviewer" | "wording" | "inventedFacts" | "clarification" | "notes">;
export async function saveReview(root: string, runId: string, input: ReviewInput): Promise<HumanReview> {
  const run = await readRun(root, runId);
  if (input.scenarioHash !== run.scenarioHash) throw new Error("Review belongs to a different scenario version.");
  if (typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 200
    || typeof input.notes !== "string" || input.notes.length > 10_000
    || ![input.wording, input.inventedFacts, input.clarification].every(value => ["pass", "fail", "pending"].includes(value))) {
    throw new Error("Invalid human review.");
  }
  const review: HumanReview = { format: "quote-evaluation-review/v1", id: randomUUID(), runId,
    scenarioHash: run.scenarioHash, createdAt: new Date().toISOString(), reviewer: input.reviewer.trim(),
    wording: input.wording, inventedFacts: input.inventedFacts, clarification: input.clarification, notes: input.notes };
  const path = join(await directory(root, `reviews/${identifier(runId)}`), `${review.id}.json`);
  await writeFile(path, JSON.stringify(review, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return review;
}
