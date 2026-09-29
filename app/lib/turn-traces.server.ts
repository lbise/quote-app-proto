import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";

import { assertAdministrator, businessName } from "./administration.server";
import type { Database } from "./db.server";
import { businessDefaults, quote, turnTrace, user, type TurnOutcomeKind, type TurnTraceOutcome } from "./db/schema";
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
 * The outcome Administrators filter by. A model call counts as sent once the
 * provider built its payload or answered; a turn discarded with no sent call
 * failed before any model call. A discarded turn whose last sent call failed
 * or ended in a provider error failed at the provider.
 */
export function turnOutcomeKind(outcome: TurnTraceOutcome, turn: Pick<AssistantTurnRecord, "modelCalls" | "toolCalls" | "assistantOutcome">): TurnOutcomeKind {
  if (outcome === "committed") {
    return turn.assistantOutcome === "committed_with_failed_calls" || turn.toolCalls.some((call) => call.outcome === "rejected")
      ? "committed_with_failed_calls" : "committed";
  }
  if (outcome === "unchanged") return "unchanged";
  const sent = (call: AssistantTurnRecord["modelCalls"][number]) => call.payload !== undefined || call.response !== undefined;
  if (!turn.modelCalls.some(sent)) return "failed_before_model_call";
  const last = turn.modelCalls.at(-1)!;
  const stopReason = (last.response as { stopReason?: unknown } | undefined)?.stopReason;
  return sent(last) && (last.error !== undefined || stopReason === "error" || stopReason === "aborted") ? "provider_error" : "discarded";
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
    outcomeKind: turnOutcomeKind(trace.outcome, turn),
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

function retained(now: Date): SQL {
  return gte(turnTrace.createdAt, new Date(now.getTime() - turnTraceRetentionMs));
}

/**
 * A Quote's Turn Traces, newest first, for an Administrator. Anyone else is
 * refused. Traces past their 30 days are never returned, even before the
 * scheduled deletion has run.
 */
export async function readTurnTraces(database: Database, viewerUserId: string, filter: { quoteId: string }, now = new Date()): Promise<StoredTurnTrace[]> {
  await assertAdministrator(database, viewerUserId);
  const rows = await database.select().from(turnTrace)
    .where(and(eq(turnTrace.quoteId, filter.quoteId), retained(now)))
    .orderBy(desc(turnTrace.createdAt), desc(turnTrace.id));
  return rows.map((row) => ({ ...row, detail: row.detail as TurnTraceDetail }));
}

/** Where a Turn Trace belongs. The User is null once deleted. */
export type TurnTraceContext = {
  user: { id: string; name: string; email: string } | null;
  business: { id: string; name: string };
  quote: { id: string; reference: string; title: string };
};

/** One Assistant Turn in the admin list: its summary columns, never its payloads. */
export type TurnTraceSummary = TurnTraceContext & Pick<StoredTurnTrace,
  "id" | "createdAt" | "requestId" | "outcome" | "outcomeKind" | "reason" | "provider" | "model" | "modelCallCount" | "inputTokens" | "outputTokens" | "costUsd">;

/** Dates are `YYYY-MM-DD` days in Switzerland, both inclusive. */
export type TurnTraceFilter = { outcomeKind?: TurnOutcomeKind; userId?: string; quoteId?: string; from?: string; to?: string };

/** The time zone of the admin area's days. */
export const adminTimeZone = "Europe/Zurich";

const day = /^\d{4}-\d{2}-\d{2}$/;

const summaryColumns = {
  id: turnTrace.id,
  createdAt: turnTrace.createdAt,
  requestId: turnTrace.requestId,
  outcome: turnTrace.outcome,
  outcomeKind: turnTrace.outcomeKind,
  reason: turnTrace.reason,
  provider: turnTrace.provider,
  model: turnTrace.model,
  modelCallCount: turnTrace.modelCallCount,
  inputTokens: turnTrace.inputTokens,
  outputTokens: turnTrace.outputTokens,
  costUsd: turnTrace.costUsd,
  userId: user.id,
  userName: user.name,
  userEmail: user.email,
  businessId: turnTrace.businessId,
  defaults: businessDefaults.defaults,
  quoteId: quote.id,
  quoteReference: quote.reference,
  quoteTitle: quote.title,
};

function summarise(database: Database) {
  return database.select(summaryColumns).from(turnTrace)
    .innerJoin(quote, eq(quote.id, turnTrace.quoteId))
    .leftJoin(user, eq(user.id, turnTrace.userId))
    .leftJoin(businessDefaults, eq(businessDefaults.businessId, turnTrace.businessId));
}

type SummaryRow = Awaited<ReturnType<typeof summarise>>[number];

function context(row: SummaryRow): TurnTraceContext {
  return {
    user: row.userId ? { id: row.userId, name: row.userName ?? "", email: row.userEmail ?? "" } : null,
    business: { id: row.businessId, name: businessName(row.defaults) },
    quote: { id: row.quoteId, reference: row.quoteReference, title: row.quoteTitle },
  };
}

function summary(row: SummaryRow): TurnTraceSummary {
  const { userId: _userId, userName: _userName, userEmail: _userEmail, businessId: _businessId, defaults: _defaults, quoteId: _quoteId, quoteReference: _reference, quoteTitle: _title, ...columns } = row;
  return { ...columns, ...context(row) };
}

/**
 * Every retained Assistant Turn, newest first, a page at a time, for an
 * Administrator. Anyone else is refused. Payloads are not read.
 */
export async function listTurnTraces(
  database: Database,
  viewerUserId: string,
  filter: TurnTraceFilter,
  { page = 1, pageSize = 50, now = new Date() }: { page?: number; pageSize?: number; now?: Date } = {},
): Promise<{ traces: TurnTraceSummary[]; hasMore: boolean }> {
  await assertAdministrator(database, viewerUserId);
  const conditions: SQL[] = [retained(now)];
  if (filter.outcomeKind) conditions.push(eq(turnTrace.outcomeKind, filter.outcomeKind));
  if (filter.userId) conditions.push(eq(turnTrace.userId, filter.userId));
  if (filter.quoteId) conditions.push(eq(turnTrace.quoteId, filter.quoteId));
  if (filter.from && day.test(filter.from)) conditions.push(sql`${turnTrace.createdAt} >= (${filter.from}::date)::timestamp at time zone ${adminTimeZone}`);
  if (filter.to && day.test(filter.to)) conditions.push(sql`${turnTrace.createdAt} < (${filter.to}::date + 1)::timestamp at time zone ${adminTimeZone}`);
  const offset = (Math.max(1, Math.floor(page)) - 1) * pageSize;
  const rows = await summarise(database).where(and(...conditions))
    .orderBy(desc(turnTrace.createdAt), desc(turnTrace.id))
    .limit(pageSize + 1).offset(offset);
  return { traces: rows.slice(0, pageSize).map(summary), hasMore: rows.length > pageSize };
}

/**
 * One Turn Trace with everything it recorded, for an Administrator. Anyone
 * else is refused. Null when it expired, its Quote was deleted, or it never
 * existed.
 */
export async function readTurnTrace(database: Database, viewerUserId: string, id: string, now = new Date()): Promise<(StoredTurnTrace & TurnTraceContext) | null> {
  await assertAdministrator(database, viewerUserId);
  const [found] = await summarise(database).where(and(eq(turnTrace.id, id), retained(now))).limit(1);
  if (!found) return null;
  const [trace] = await database.select().from(turnTrace).where(eq(turnTrace.id, id)).limit(1);
  // Deleted between the two reads.
  if (!trace) return null;
  return { ...trace, detail: trace.detail as TurnTraceDetail, ...context(found) };
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
