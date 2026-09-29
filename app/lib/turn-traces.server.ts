import { and, desc, eq, gte, lt } from "drizzle-orm";

import { AdministrationRefusal } from "./administration.server";
import { isAdministrator } from "./auth-config.server";
import type { Database } from "./db.server";
import { turnTrace, user, type TurnTraceOutcome } from "./db/schema";
import { registeredProviders } from "./quote-ai-providers.server";
import type { AssistantTurnRecord, TurnTraceDetail } from "./turn-trace";

/** Turn Traces are deleted this long after their turn (ADR 0007). */
export const turnTraceRetentionMs = 30 * 24 * 60 * 60_000;

/** Everything recorded about one Assistant Turn. */
export type TurnTraceInput = {
  quoteId: string;
  businessId: string;
  userId: string;
  requestId: string;
  locale: "en" | "fr";
  /** The Artisan's message. */
  text: string;
  outcome: TurnTraceOutcome;
  /** Why the turn was discarded. */
  reason?: string;
  /** Working Draft version before and after the turn. */
  baseVersion?: number;
  resultVersion?: number;
  message?: TurnTraceDetail["message"];
  diagnostic?: TurnTraceDetail["diagnostic"];
  turn: AssistantTurnRecord;
};

export type StoredTurnTrace = Omit<typeof turnTrace.$inferSelect, "detail"> & { detail: TurnTraceDetail };

const redacted = "[redacted]";
const credentialFields = new Set(["apikey", "api_key", "api-key", "x-api-key", "x-goog-api-key", "authorization", "proxy-authorization", "cookie", "set-cookie"]);

function credentials(): string[] {
  return Object.values(registeredProviders)
    .map((provider) => process.env[provider.credential]?.trim())
    .filter((value): value is string => !!value && value.length >= 8);
}

/** A copy without credential fields or configured credential values. Credentials are never stored. */
function withoutCredentials(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return secrets.reduce((text, secret) => text.replaceAll(secret, redacted), value);
  if (Array.isArray(value)) return value.map((entry) => withoutCredentials(entry, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, credentialFields.has(key.toLowerCase()) && entry !== undefined && entry !== null ? redacted : withoutCredentials(entry, secrets)]));
  }
  return value;
}

/**
 * Store one Turn Trace, then delete expired ones. Throws when storage fails;
 * the caller decides that the turn itself is unaffected. Nothing here is
 * logged.
 */
export async function recordTurnTrace(database: Database, trace: TurnTraceInput, now = new Date()): Promise<void> {
  const { turn } = trace;
  // A JSON round trip gives the stored form: undefined fields go, as they would when sent.
  const detail = withoutCredentials(JSON.parse(JSON.stringify({
    text: trace.text,
    locale: trace.locale,
    ...turn,
    ...(trace.message ? { message: trace.message } : {}),
    ...(trace.diagnostic ? { diagnostic: trace.diagnostic } : {}),
  } satisfies TurnTraceDetail)), credentials()) as TurnTraceDetail;
  const usage = turn.modelCalls.map((call) => call.usage).filter((entry) => entry !== undefined);
  const firstCall = turn.modelCalls[0];
  await database.insert(turnTrace).values({
    id: crypto.randomUUID(),
    quoteId: trace.quoteId,
    businessId: trace.businessId,
    userId: trace.userId,
    requestId: trace.requestId,
    locale: trace.locale,
    outcome: trace.outcome,
    reason: trace.outcome === "discarded" ? trace.reason ?? "unknown" : null,
    baseVersion: trace.baseVersion ?? null,
    resultVersion: trace.resultVersion ?? null,
    messageId: trace.message?.id ?? null,
    provider: turn.provider ?? firstCall?.provider ?? null,
    model: turn.model ?? firstCall?.model ?? null,
    modelCallCount: turn.modelCalls.length,
    inputTokens: usage.reduce((sum, entry) => sum + entry.input + entry.cacheRead + entry.cacheWrite, 0),
    outputTokens: usage.reduce((sum, entry) => sum + entry.output, 0),
    costUsd: usage.reduce((sum, entry) => sum + entry.costUsd, 0),
    detail,
    createdAt: now,
  });
  // A failed purge is not a failed recording; the scheduled deletion retries it.
  await deleteExpiredTurnTraces(database, now).catch(() => {});
}

/** Delete every Turn Trace older than 30 days. Returns how many were deleted. */
export async function deleteExpiredTurnTraces(database: Database, now = new Date()): Promise<number> {
  const deleted = await database.delete(turnTrace).where(lt(turnTrace.createdAt, new Date(now.getTime() - turnTraceRetentionMs))).returning({ id: turnTrace.id });
  return deleted.length;
}

/**
 * A Quote's Turn Traces, newest first, for an Administrator. Anyone else is
 * refused. Traces past their 30 days are never returned, even before the
 * scheduled deletion has run.
 */
export async function readTurnTraces(database: Database, viewerUserId: string, filter: { quoteId: string }, now = new Date()): Promise<StoredTurnTrace[]> {
  const [viewer] = await database.select().from(user).where(eq(user.id, viewerUserId)).limit(1);
  if (!viewer || !isAdministrator(viewer)) throw new AdministrationRefusal("not_administrator");
  const rows = await database.select().from(turnTrace)
    .where(and(eq(turnTrace.quoteId, filter.quoteId), gte(turnTrace.createdAt, new Date(now.getTime() - turnTraceRetentionMs))))
    .orderBy(desc(turnTrace.createdAt), desc(turnTrace.id));
  return rows.map((row) => ({ ...row, detail: row.detail as TurnTraceDetail }));
}

const hourMs = 60 * 60_000;
const scheduled = Symbol.for("easy-quote.turn-trace-retention");

/**
 * Delete expired Turn Traces shortly after start and then once an hour in
 * this server process, without manual action. Recording a trace also deletes
 * expired ones. A failed run is retried at the next interval. Scheduling twice
 * in one process keeps the first schedule. Returns a function that stops it.
 */
export function scheduleTurnTraceRetention(database: () => Database, timing: { firstRunMs?: number; intervalMs?: number } = {}): () => void {
  const registry = globalThis as { [scheduled]?: () => void };
  const existing = registry[scheduled];
  if (existing) return existing;
  const run = () => {
    let target: Database;
    try { target = database(); } catch { return; }
    deleteExpiredTurnTraces(target).catch(() => console.error("Expired Turn Traces could not be deleted."));
  };
  const first = setTimeout(run, timing.firstRunMs ?? 60_000);
  const repeat = setInterval(run, timing.intervalMs ?? hourMs);
  first.unref();
  repeat.unref();
  const stop = () => {
    clearTimeout(first);
    clearInterval(repeat);
    if (registry[scheduled] === stop) delete registry[scheduled];
  };
  registry[scheduled] = stop;
  return stop;
}
