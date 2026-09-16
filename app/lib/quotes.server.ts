import { createHash } from "node:crypto";

import { and, asc, desc, eq, lte, ne, sql } from "drizzle-orm";

import { hasApprovedAccess, trustedOrigins } from "./auth-config.server";
import { getAuth } from "./auth.server";
import { artisan, businessDefaults, customer, quote, quoteMessage, quoteRequest, quoteRevision } from "./db/schema";
import { type Database, getDatabase } from "./db.server";
import { calculateQuote, emptyQuote, type QuoteData } from "./quote";
import { generateQuoteChange, type QuoteAIInput, type QuoteAIModelBoundary } from "./quote-assistant.server";
import { BodyLimitError, readLimitedBody } from "./limited-body.server";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Store = Database | Transaction;
type Message = { role: "artisan" | "assistant" | "note"; fr: string; en: string; changed?: string[]; changedFields?: string[] };
type Action = "create" | "save" | "publish" | "new-draft" | "undo" | "assistant" | "customer-save" | "customer-apply" | "defaults-save";
type Body = { action?: Action; id?: string; expectedVersion?: number; requestId?: string; quote?: unknown; text?: string; locale?: "fr" | "en"; customer?: unknown; customerId?: unknown; defaults?: unknown };
type SessionAuth = { api: { getSession(input: { headers: Headers }): Promise<{ user: { id: string; email: string; emailVerified: boolean } } | null> } };
type QuoteDetail = Awaited<ReturnType<typeof readDetail>>;

const MAX_HTTP_BYTES = 256_000;
const MAX_REQUEST_ID = 128;
const MAX_TEXT = 8_000;
const MAX_QUOTE_BYTES = 220_000;
const AI_LEASE_MS = 60_000; // Greater than the provider's bounded 45-second timeout.
const defaultFields = ["businessName", "businessAddress", "businessContact", "vatRegistered", "vatId", "terms"] as const;

export type QuoteHandlerDependencies = { database?: Database; auth?: SessionAuth; modelBoundary?: QuoteAIModelBoundary; now?: () => Date };

class RequestFailure extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown) { super(code); }
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function valueRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function identifier(value: unknown, name: string, max = MAX_REQUEST_ID): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new RequestFailure(400, `invalid_${name}`);
  return value;
}

function requestKey(value: unknown): string {
  if (value === undefined) return crypto.randomUUID();
  const key = identifier(value, "request_id");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key)) throw new RequestFailure(400, "invalid_request_id");
  return key;
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RequestFailure(400, "invalid_expected_version");
  return value as number;
}

// Request keys bind to a canonical, key-sorted JSON payload (including the
// expected version), never to object insertion order or transport whitespace.
function stable(value: unknown, depth = 0): string {
  if (depth > 50) throw new RequestFailure(400, "invalid_request");
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stable(item, depth + 1)).join(",")}]`;
  const record = valueRecord(value);
  if (!record) throw new RequestFailure(400, "invalid_request");
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key], depth + 1)}`).join(",")}}`;
}

function payloadHash(body: Body): string {
  return createHash("sha256").update(stable({
    action: body.action, id: body.id, expectedVersion: body.expectedVersion, quote: body.quote,
    text: body.text, locale: body.locale, customer: body.customer, customerId: body.customerId, defaults: body.defaults,
  })).digest("hex");
}

async function readJson(request: Request): Promise<Body> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readLimitedBody(request, MAX_HTTP_BYTES)); }
  catch (error) {
    if (error instanceof BodyLimitError) throw new RequestFailure(413, "request_too_large");
    throw new RequestFailure(400, "invalid_request");
  }
  const body = valueRecord(parsed) as Body | null;
  if (!body || typeof body.action !== "string") throw new RequestFailure(400, "invalid_request");
  return body;
}

function assertQuoteBoundary(draft: QuoteData) {
  if (new TextEncoder().encode(JSON.stringify(draft)).byteLength > MAX_QUOTE_BYTES) throw new RequestFailure(413, "quote_too_large");
  const strings = [draft.reference, draft.title, draft.customerName, draft.customerAddress, draft.customerContact, draft.businessName, draft.businessAddress, draft.businessContact, draft.vatId, draft.issueDate, draft.validUntil, draft.siteAddress, draft.terms, draft.discount];
  if (strings.some((value) => value.length > 20_000) || draft.reference.length > 200) throw new RequestFailure(422, "invalid_draft");
  const safeId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && value.length <= 128;
  if (draft.sections.some((section) => !safeId(section.id) || section.title.length > 4_000)
    || draft.lines.some((line) => !safeId(line.id) || (line.sectionId !== "" && !safeId(line.sectionId)) || line.description.length > 20_000 || line.unit.length > 100)) {
    throw new RequestFailure(422, "invalid_draft");
  }
}

function asQuote(value: unknown, allowMissing: boolean): { draft: QuoteData; calculation: ReturnType<typeof calculateQuote> } {
  const calculation = calculateQuote(value);
  if (!calculation.quote || calculation.errors.length || (!allowMissing && calculation.missing.length)) {
    throw new RequestFailure(422, "invalid_draft", { errors: calculation.errors, missing: calculation.missing });
  }
  assertQuoteBoundary(calculation.quote);
  return { draft: calculation.quote, calculation };
}

function assistantMessage(text: string, changed: string[], changedFields?: string[]): Message {
  return { role: "assistant", fr: text, en: text, changed, ...(changedFields?.length ? { changedFields } : {}) };
}

const lineIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function trustedCapturedLineIds(value: unknown, draft: QuoteData): string[] {
  if (!Array.isArray(value)) return [];
  const lineIds = new Set(draft.lines.map((line) => line.id));
  return [...new Set(value)].filter((id): id is string => typeof id === "string" && lineIdPattern.test(id) && lineIds.has(id));
}

function retainedAfterManualSave(capturedLineIds: unknown, before: QuoteData, after: QuoteData): string[] {
  const previousLines = new Map(before.lines.map((line) => [line.id, line]));
  const nextLines = new Map(after.lines.map((line) => [line.id, line]));
  return trustedCapturedLineIds(capturedLineIds, before).filter((id) => stable(previousLines.get(id)) === stable(nextLines.get(id)));
}

function capturedResultIds(value: unknown, before: QuoteData, after: QuoteData, existing: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !lineIdPattern.test(id)) || new Set(value).size !== value.length) {
    throw new RequestFailure(502, "assistant_invalid_response");
  }
  const previousLineIds = new Set(before.lines.map((line) => line.id));
  const currentLineIds = new Set(after.lines.map((line) => line.id));
  const permitted = new Set([
    ...trustedCapturedLineIds(existing, before),
    ...after.lines.filter((line) => !previousLineIds.has(line.id)).map((line) => line.id),
  ]);
  if (value.some((id) => !currentLineIds.has(id) || !permitted.has(id))) {
    throw new RequestFailure(502, "assistant_invalid_response");
  }
  return [...value];
}

function changedFieldsFrom(value: unknown): string[] | undefined {
  const fields = valueRecord(value)?.changedFields;
  if (fields === undefined) return undefined;
  if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string" || !/^(customer|title|discount|section:[A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.test(field))) {
    throw new RequestFailure(502, "assistant_invalid_response");
  }
  return fields;
}

function messageChanges(value: unknown): { changed?: string[]; changedFields?: string[] } {
  if (Array.isArray(value)) return { changed: value.filter((entry): entry is string => typeof entry === "string") };
  const record = valueRecord(value);
  if (!record || !Array.isArray(record.lines) || !Array.isArray(record.fields)) return {};
  const changed = record.lines.filter((entry): entry is string => typeof entry === "string");
  const changedFields = record.fields.filter((entry): entry is string => typeof entry === "string");
  return { changed, ...(changedFields.length ? { changedFields } : {}) };
}

function storedChanges(changed: string[], changedFields?: string[]): string[] | { lines: string[]; fields: string[] } | undefined {
  if (changedFields?.length) return { lines: changed, fields: changedFields };
  return changed.length ? changed : undefined;
}

async function authorised(request: Request, auth: SessionAuth, database: Database): Promise<string> {
  const current = await auth.api.getSession({ headers: request.headers });
  if (!current) throw new RequestFailure(401, "authentication_required");
  if (!hasApprovedAccess(current.user)) throw new RequestFailure(403, "access_denied");
  const [profile] = await database.select().from(artisan).where(eq(artisan.userId, current.user.id)).limit(1);
  if (!profile) throw new RequestFailure(403, "artisan_business_unavailable");
  return profile.businessId;
}

function assertMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !trustedOrigins().includes(origin)) throw new RequestFailure(403, "untrusted_origin");
}

async function lockQuote(transaction: Transaction, id: string) {
  await transaction.execute(sql`select id from "quote" where id = ${id} for update`);
}

async function lockRequest(transaction: Transaction, businessId: string, requestId: string) {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${businessId}:${requestId}`}))`);
}

async function latestAssistantRequest(database: Store, quoteId: string) {
  const [request] = await database.select().from(quoteRequest)
    .where(and(eq(quoteRequest.quoteId, quoteId), eq(quoteRequest.action, "assistant")))
    .orderBy(desc(quoteRequest.createdAt)).limit(1);
  if (!request) return undefined;
  const [artisanMessage] = await database.select().from(quoteMessage)
    .where(and(eq(quoteMessage.quoteId, quoteId), eq(quoteMessage.requestId, request.requestId)))
    .limit(1);
  const status = request.status;
  if (status !== "pending" && status !== "complete" && status !== "failed" && status !== "stale") return undefined;
  return { requestId: request.requestId, text: artisanMessage?.fr ?? "", status, baseVersion: request.baseVersion ?? 0 };
}

async function readDetail(database: Store, businessId: string, id: string) {
  const [record] = await database.select().from(quote).where(and(eq(quote.id, id), eq(quote.businessId, businessId))).limit(1);
  if (!record) throw new RequestFailure(404, "quote_not_found");
  const revisions = await database.select().from(quoteRevision).where(and(eq(quoteRevision.quoteId, id), eq(quoteRevision.businessId, businessId))).orderBy(asc(quoteRevision.number));
  const messages = await database.select().from(quoteMessage).where(eq(quoteMessage.quoteId, id)).orderBy(asc(quoteMessage.sequence));
  const assistantRequest = await latestAssistantRequest(database, id);
  return {
    id: record.id, version: record.version, draft: (record.draft ?? null) as QuoteData | null,
    revisions: revisions.map((revision) => ({ number: revision.number, publishedAt: revision.publishedAt.toISOString(), quote: revision.quote as QuoteData, calculation: revision.calculation })),
    messages: messages.map((entry) => ({ role: entry.role as Message["role"], fr: entry.fr, en: entry.en, ...messageChanges(entry.changed) })),
    pending: record.pending,
    canUndo: record.undoDraft !== null && record.undoDraft !== undefined,
    ...(assistantRequest ? { assistantRequest } : {}),
  };
}

function defaultsFrom(value: unknown, rejectInvalid: boolean): Partial<QuoteData> {
  const source = valueRecord(value) ?? {};
  if (rejectInvalid && !valueRecord(value)) throw new RequestFailure(400, "invalid_defaults");
  const defaults: Partial<QuoteData> = {};
  for (const field of defaultFields) {
    if (!(field in source)) continue;
    const supplied = source[field];
    if (field === "vatRegistered") {
      if (supplied !== null && typeof supplied !== "boolean") throw new RequestFailure(400, "invalid_defaults");
      defaults.vatRegistered = supplied;
    } else {
      if (typeof supplied !== "string" || supplied.length > 20_000) throw new RequestFailure(400, "invalid_defaults");
      defaults[field] = supplied;
    }
  }
  return defaults;
}

async function readList(database: Store, businessId: string) {
  const records = await database.select().from(quote).where(eq(quote.businessId, businessId)).orderBy(desc(quote.updatedAt));
  const revisions = await database.select().from(quoteRevision).where(eq(quoteRevision.businessId, businessId));
  const customers = await database.select().from(customer).where(eq(customer.businessId, businessId)).orderBy(asc(customer.name));
  const [savedDefaults] = await database.select().from(businessDefaults).where(eq(businessDefaults.businessId, businessId)).limit(1);
  return {
    quotes: records.map((record) => {
      const latest = revisions.filter((revision) => revision.quoteId === record.id).sort((a, b) => b.number - a.number)[0];
      const document = (record.draft ?? latest?.quote ?? {}) as Partial<QuoteData>;
      return { id: record.id, reference: record.reference, title: document.title ?? record.title, customerName: document.customerName ?? "", hasDraft: record.draft !== null, revision: latest?.number ?? 0, updatedAt: record.updatedAt.toISOString() };
    }),
    customers: customers.map((entry) => ({ id: entry.id, name: entry.name, address: entry.address, contact: entry.contact })),
    defaults: defaultsFrom(savedDefaults?.defaults, false),
  };
}

async function findRequest(database: Store, businessId: string, requestId: string) {
  const [record] = await database.select().from(quoteRequest).where(and(eq(quoteRequest.businessId, businessId), eq(quoteRequest.requestId, requestId))).limit(1);
  return record;
}

function assertRequestBinding(record: typeof quoteRequest.$inferSelect, action: Action, id: string | undefined, hash: string) {
  if (record.action !== action || record.payloadHash !== hash || (id !== undefined && record.quoteId !== id)) {
    throw new RequestFailure(409, "request_key_reused");
  }
}

async function recordRequest(transaction: Transaction, values: { businessId: string; quoteId?: string; action: Action; requestId: string; status: "pending" | "complete"; baseVersion?: number; payloadHash: string; now: Date }) {
  const { now, ...request } = values;
  await transaction.insert(quoteRequest).values({ id: crypto.randomUUID(), ...request, updatedAt: now });
}

async function suggestedReference(transaction: Transaction, businessId: string): Promise<string> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${businessId}))`);
  const rows = await transaction.select({ reference: quote.reference }).from(quote).where(eq(quote.businessId, businessId));
  const largest = rows.reduce((max, row) => Math.max(max, /^Q-(\d+)$/.exec(row.reference) ? Number(/^Q-(\d+)$/.exec(row.reference)![1]) : 0), 0);
  return `Q-${largest + 1}`;
}

async function assertReference(transaction: Transaction, businessId: string, id: string, reference: string, published: boolean) {
  if (published) throw new RequestFailure(422, "reference_fixed");
  const duplicate = await transaction.select({ id: quote.id }).from(quote).where(and(eq(quote.businessId, businessId), eq(quote.reference, reference), ne(quote.id, id))).limit(1);
  if (duplicate.length) throw new RequestFailure(409, "reference_in_use");
}

function requireDraft(record: { draft: unknown }): QuoteData {
  if (!record.draft) throw new RequestFailure(409, "working_draft_required");
  return record.draft as QuoteData;
}

function checkVersion(record: { version: number }, body: Body) {
  if (record.version !== expectedVersion(body.expectedVersion)) throw new RequestFailure(409, "stale_version");
}

async function reapExpired(database: Database, businessId: string, now: Date) {
  await database.transaction(async (transaction) => {
    const candidates = await transaction.select().from(quote).where(and(eq(quote.businessId, businessId), eq(quote.pending, true), lte(quote.pendingExpiresAt, now)));
    for (const candidate of candidates) {
      await lockQuote(transaction, candidate.id);
      const [current] = await transaction.select().from(quote).where(and(eq(quote.id, candidate.id), eq(quote.businessId, businessId))).limit(1);
      if (!current || !current.pending || !current.pendingExpiresAt || current.pendingExpiresAt > now) continue;
      await transaction.update(quote).set({ pending: false, pendingVersion: null, pendingRequestId: null, pendingExpiresAt: null, updatedAt: now }).where(eq(quote.id, current.id));
      if (current.pendingRequestId) {
        await transaction.update(quoteRequest).set({ status: "failed", updatedAt: now }).where(and(eq(quoteRequest.businessId, businessId), eq(quoteRequest.requestId, current.pendingRequestId), eq(quoteRequest.status, "pending")));
        await transaction.insert(quoteMessage).values({ id: crypto.randomUUID(), quoteId: current.id, role: "note", fr: "La demande assistant a expiré; le brouillon est inchangé.", en: "The assistant request expired; the Working Draft is unchanged." });
      }
    }
  });
}

/** Authenticated HTTP boundary for Quote lifecycle and reusable-record operations. */
export function createQuoteHandler(dependencies: QuoteHandlerDependencies = {}) {
  const database = dependencies.database ?? getDatabase();
  const auth = dependencies.auth ?? getAuth();
  const now = dependencies.now ?? (() => new Date());

  return async function quoteHandler(request: Request): Promise<Response> {
    try {
      const businessId = await authorised(request, auth, database);
      await reapExpired(database, businessId, now());
      if (request.method === "GET") {
        const id = new URL(request.url).searchParams.get("id");
        return json(id ? await readDetail(database, businessId, id) : await readList(database, businessId));
      }
      if (request.method !== "POST") throw new RequestFailure(405, "method_not_allowed");
      assertMutationOrigin(request);
      const body = await readJson(request);
      if (!["create", "save", "publish", "new-draft", "undo", "assistant", "customer-save", "customer-apply", "defaults-save"].includes(body.action!)) throw new RequestFailure(400, "invalid_action");
      if (body.action === "customer-save") return json(await saveCustomer(database, businessId, body, now()));
      if (body.action === "defaults-save") return json(await saveDefaults(database, businessId, body, now()));
      if (body.action === "assistant") return json(await assistant(database, businessId, body, dependencies.modelBoundary, now()));
      return json(await mutate(database, businessId, body, now()));
    } catch (error) {
      if (error instanceof RequestFailure) return json({ error: error.code, ...(error.details === undefined ? {} : { details: error.details }) }, error.status);
      if (postgresCode(error) === "23505") return json({ error: "conflict" }, 409);
      return json({ error: "request_failed" }, 500);
    }
  };
}

function postgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string") return record.code;
    current = record.cause;
  }
  return undefined;
}

async function saveCustomer(database: Database, businessId: string, body: Body, now: Date) {
  const data = valueRecord(body.customer);
  if (!data) throw new RequestFailure(400, "invalid_customer");
  const name = identifier(data.name, "customer_name", 4_000).trim();
  const address = identifier(data.address, "customer_address", 20_000).trim();
  const contact = typeof data.contact === "string" && data.contact.length <= 4_000 ? data.contact : "";
  const requestId = requestKey(body.requestId);
  // A new Customer ID is derived from the idempotency key so a retry can
  // identify the exact saved record, even if the first response was lost.
  const id = typeof data.id === "string" && data.id
    ? identifier(data.id, "customer_id")
    : createHash("sha256").update(`${businessId}:${requestId}`).digest("hex");
  const hash = payloadHash(body);
  let savedCustomer: { id: string; name: string; address: string; contact: string } | undefined;
  await database.transaction(async (transaction) => {
    await lockRequest(transaction, businessId, requestId);
    const request = await findRequest(transaction, businessId, requestId);
    if (request) {
      assertRequestBinding(request, "customer-save", undefined, hash);
      if (request.status === "complete") {
        const [completed] = await transaction.select({ id: customer.id, name: customer.name, address: customer.address, contact: customer.contact })
          .from(customer).where(and(eq(customer.id, id), eq(customer.businessId, businessId))).limit(1);
        savedCustomer = completed;
        return;
      }
      throw new RequestFailure(409, "request_in_progress");
    }
    const [existing] = await transaction.select().from(customer).where(and(eq(customer.id, id), eq(customer.businessId, businessId))).limit(1);
    if (typeof data.id === "string" && data.id && !existing) throw new RequestFailure(404, "customer_not_found");
    if (existing) await transaction.update(customer).set({ name, address, contact, updatedAt: now }).where(eq(customer.id, id));
    else await transaction.insert(customer).values({ id, businessId, name, address, contact });
    savedCustomer = { id, name, address, contact };
    await recordRequest(transaction, { businessId, action: "customer-save", requestId, status: "complete", payloadHash: hash, now });
  });
  return { ...(await readList(database, businessId)), ...(savedCustomer ? { savedCustomer } : {}) };
}

async function saveDefaults(database: Database, businessId: string, body: Body, now: Date) {
  const defaults = defaultsFrom(body.defaults, true);
  if (defaults.vatRegistered === true && !defaults.vatId?.trim()) {
    throw new RequestFailure(422, "invalid_defaults", { errors: [{ path: "vatId", code: "required" }] });
  }
  await database.insert(businessDefaults).values({ businessId, defaults, updatedAt: now }).onConflictDoUpdate({ target: businessDefaults.businessId, set: { defaults, updatedAt: now } });
  return readList(database, businessId);
}

async function mutate(database: Database, businessId: string, body: Body, now: Date): Promise<QuoteDetail> {
  const action = body.action as Exclude<Action, "assistant" | "customer-save" | "defaults-save">;
  const requestId = requestKey(body.requestId);
  const hash = payloadHash(body);
  const id = action === "create" ? undefined : identifier(body.id, "quote_id");
  let detail: QuoteDetail | undefined;
  await database.transaction(async (transaction) => {
    await lockRequest(transaction, businessId, requestId);
    const existing = await findRequest(transaction, businessId, requestId);
    if (existing) {
      assertRequestBinding(existing, action, id, hash);
      if (existing.status === "complete" && existing.quoteId) { detail = await readDetail(transaction, businessId, existing.quoteId); return; }
      throw new RequestFailure(409, "request_in_progress");
    }
    if (action === "create") {
      const reference = await suggestedReference(transaction, businessId);
      const [storedDefaults] = await transaction.select().from(businessDefaults).where(eq(businessDefaults.businessId, businessId)).limit(1);
      const draft = asQuote(emptyQuote(reference, defaultsFrom(storedDefaults?.defaults, false)), true).draft;
      const quoteId = crypto.randomUUID();
      await transaction.insert(quote).values({ id: quoteId, businessId, reference: draft.reference, title: draft.title, draft, updatedAt: now });
      await recordRequest(transaction, { businessId, quoteId, action, requestId, status: "complete", payloadHash: hash, now });
      detail = await readDetail(transaction, businessId, quoteId);
      return;
    }
    await lockQuote(transaction, id!);
    const [record] = await transaction.select().from(quote).where(and(eq(quote.id, id!), eq(quote.businessId, businessId))).limit(1);
    if (!record) throw new RequestFailure(404, "quote_not_found");
    checkVersion(record, body);
    if (action === "customer-apply") {
      const oldDraft = requireDraft(record);
      const customerId = identifier(body.customerId, "customer_id");
      const [selected] = await transaction.select().from(customer).where(and(eq(customer.id, customerId), eq(customer.businessId, businessId))).limit(1);
      if (!selected) throw new RequestFailure(404, "customer_not_found");
      const preview = valueRecord(body.customer);
      if (preview && (preview.name !== selected.name || preview.address !== selected.address || preview.contact !== selected.contact)) {
        throw new RequestFailure(409, "customer_changed");
      }
      const next = { ...oldDraft, customerName: selected.name, customerAddress: selected.address, customerContact: selected.contact };
      if (stable(next) !== stable(oldDraft)) {
        await transaction.update(quote).set({
          draft: next, undoDraft: oldDraft,
          capturedLineIds: retainedAfterManualSave(record.capturedLineIds, oldDraft, next),
          undoCapturedLineIds: trustedCapturedLineIds(record.capturedLineIds, oldDraft),
          title: next.title, reference: next.reference, version: record.version + 1, updatedAt: now,
        }).where(eq(quote.id, id!));
      }
    } else if (action === "save") {
      const oldDraft = requireDraft(record);
      const next = asQuote(body.quote, true).draft;
      // Both states have passed the canonical Quote calculation boundary, so
      // sorted canonical JSON identifies a semantic no-op without consuming undo.
      if (stable(next) !== stable(oldDraft)) {
        if (next.reference !== record.reference) {
          const published = await transaction.select({ id: quoteRevision.id }).from(quoteRevision).where(eq(quoteRevision.quoteId, id!)).limit(1);
          await assertReference(transaction, businessId, id!, next.reference, published.length > 0);
        }
        await transaction.update(quote).set({
          draft: next, undoDraft: oldDraft,
          capturedLineIds: retainedAfterManualSave(record.capturedLineIds, oldDraft, next),
          undoCapturedLineIds: trustedCapturedLineIds(record.capturedLineIds, oldDraft),
          title: next.title, reference: next.reference, version: record.version + 1, updatedAt: now,
        }).where(eq(quote.id, id!));
      }
    } else if (action === "new-draft") {
      if (record.draft) throw new RequestFailure(409, "working_draft_exists");
      const [latest] = await transaction.select().from(quoteRevision).where(eq(quoteRevision.quoteId, id!)).orderBy(desc(quoteRevision.number)).limit(1);
      if (!latest) throw new RequestFailure(409, "published_revision_required");
      await transaction.update(quote).set({ draft: latest.quote, undoDraft: null, capturedLineIds: [], undoCapturedLineIds: null, version: record.version + 1, updatedAt: now }).where(eq(quote.id, id!));
    } else if (action === "undo") {
      if (!record.draft || record.undoDraft === null || record.undoDraft === undefined) throw new RequestFailure(409, "nothing_to_undo");
      const previous = record.undoDraft as QuoteData;
      if (previous.reference !== record.reference) {
        const published = await transaction.select({ id: quoteRevision.id }).from(quoteRevision).where(eq(quoteRevision.quoteId, id!)).limit(1);
        await assertReference(transaction, businessId, id!, previous.reference, published.length > 0);
      }
      await transaction.update(quote).set({ draft: previous, undoDraft: null, capturedLineIds: trustedCapturedLineIds(record.undoCapturedLineIds, previous), undoCapturedLineIds: null, title: previous.title, reference: previous.reference, version: record.version + 1, updatedAt: now }).where(eq(quote.id, id!));
      await transaction.insert(quoteMessage).values({ id: crypto.randomUUID(), quoteId: id!, role: "note", fr: "Dernière modification annulée.", en: "Latest change undone." });
    } else if (action === "publish") {
      if (record.pending) throw new RequestFailure(409, "assistant_pending");
      const checked = asQuote(requireDraft(record), false);
      if (checked.draft.reference !== record.reference) throw new RequestFailure(422, "reference_fixed");
      if (!checked.calculation.complete) throw new RequestFailure(422, "incomplete_draft", { missing: checked.calculation.missing });
      const [previous] = await transaction.select({ number: quoteRevision.number }).from(quoteRevision).where(eq(quoteRevision.quoteId, id!)).orderBy(desc(quoteRevision.number)).limit(1);
      await transaction.insert(quoteRevision).values({ id: crypto.randomUUID(), quoteId: id!, businessId, number: (previous?.number ?? 0) + 1, quote: checked.draft, calculation: checked.calculation });
      await transaction.update(quote).set({ draft: null, undoDraft: null, capturedLineIds: [], undoCapturedLineIds: null, pending: false, pendingVersion: null, pendingRequestId: null, pendingExpiresAt: null, title: checked.draft.title, version: record.version + 1, updatedAt: now }).where(eq(quote.id, id!));
    }
    await recordRequest(transaction, { businessId, quoteId: id!, action, requestId, status: "complete", baseVersion: record.version, payloadHash: hash, now });
    detail = await readDetail(transaction, businessId, id!);
  });
  if (!detail) throw new RequestFailure(500, "request_failed");
  return detail;
}

async function assistant(database: Database, businessId: string, body: Body, modelBoundary: QuoteAIModelBoundary | undefined, now: Date): Promise<QuoteDetail & { reviewPublication?: boolean }> {
  const id = identifier(body.id, "quote_id");
  const requestId = requestKey(body.requestId);
  const hash = payloadHash(body);
  const locale = body.locale === "en" ? "en" : "fr";
  const text = identifier(body.text, "text", MAX_TEXT).trim();
  let input: QuoteAIInput | undefined;
  let baseVersion = 0;
  let completed: QuoteDetail | undefined;

  await database.transaction(async (transaction) => {
    await lockRequest(transaction, businessId, requestId);
    const existing = await findRequest(transaction, businessId, requestId);
    if (existing) {
      assertRequestBinding(existing, "assistant", id, hash);
      if (existing.status === "complete") { completed = await readDetail(transaction, businessId, id); return; }
      if (existing.status === "pending") throw new RequestFailure(409, "assistant_pending");
    }
    await lockQuote(transaction, id);
    const [record] = await transaction.select().from(quote).where(and(eq(quote.id, id), eq(quote.businessId, businessId))).limit(1);
    if (!record) throw new RequestFailure(404, "quote_not_found");
    checkVersion(record, body);
    if (record.pending) throw new RequestFailure(409, "assistant_pending");
    const draft = requireDraft(record);
    const messages = await transaction.select().from(quoteMessage).where(eq(quoteMessage.quoteId, id)).orderBy(asc(quoteMessage.sequence));
    if (existing) await transaction.update(quoteRequest).set({ status: "pending", baseVersion: record.version, updatedAt: now }).where(eq(quoteRequest.id, existing.id));
    else await recordRequest(transaction, { businessId, quoteId: id, action: "assistant", requestId, status: "pending", baseVersion: record.version, payloadHash: hash, now });
    if (!existing) await transaction.insert(quoteMessage).values({ id: crypto.randomUUID(), quoteId: id, role: "artisan", fr: text, en: text, requestId });
    await transaction.update(quote).set({ pending: true, pendingVersion: record.version, pendingRequestId: requestId, pendingExpiresAt: new Date(now.getTime() + AI_LEASE_MS), updatedAt: now }).where(eq(quote.id, id));
    baseVersion = record.version;
    input = {
      quote: draft,
      messages: messages.map((entry) => ({ role: entry.role as Message["role"], fr: entry.fr, en: entry.en })),
      text,
      locale,
      capturedLineIds: trustedCapturedLineIds(record.capturedLineIds, draft),
    };
  });
  if (completed) return completed;
  if (!input) throw new RequestFailure(500, "request_failed");

  let result: Awaited<ReturnType<typeof generateQuoteChange>>;
  try { result = await generateQuoteChange(input, modelBoundary); } catch {
    await failAssistant(database, businessId, id, requestId, now);
    throw new RequestFailure(502, "assistant_unavailable");
  }
  let next: QuoteData | null;
  let changedFields: string[] | undefined;
  let resultCapturedLineIds: string[] | undefined;
  try {
    next = result.quote ? asQuote(result.quote, true).draft : null;
    changedFields = changedFieldsFrom(result);
    if (next) resultCapturedLineIds = capturedResultIds(result.capturedLineIds, input.quote, next, input.capturedLineIds);
  } catch {
    await failAssistant(database, businessId, id, requestId, now);
    throw new RequestFailure(502, "assistant_invalid_response");
  }

  let detail: QuoteDetail | undefined;
  let stale = false;
  await database.transaction(async (transaction) => {
    await lockRequest(transaction, businessId, requestId);
    await lockQuote(transaction, id);
    const request = await findRequest(transaction, businessId, requestId);
    const [record] = await transaction.select().from(quote).where(and(eq(quote.id, id), eq(quote.businessId, businessId))).limit(1);
    if (!request || !record) throw new RequestFailure(404, "quote_not_found");
    if (request.status !== "pending" || record.pendingRequestId !== requestId || record.version !== baseVersion) {
      if (request.status === "pending") await transaction.update(quoteRequest).set({ status: "stale", updatedAt: now }).where(eq(quoteRequest.id, request.id));
      if (record.pendingRequestId === requestId) await transaction.update(quote).set({ pending: false, pendingVersion: null, pendingRequestId: null, pendingExpiresAt: null, updatedAt: now }).where(eq(quote.id, id));
      await transaction.insert(quoteMessage).values({ id: crypto.randomUUID(), quoteId: id, role: "note", fr: "Réponse devenue obsolète; le brouillon a changé.", en: "Response was stale; the Working Draft changed." });
      stale = true;
      return;
    }
    if (next?.reference !== undefined && next.reference !== record.reference) {
      const published = await transaction.select({ id: quoteRevision.id }).from(quoteRevision).where(eq(quoteRevision.quoteId, id)).limit(1);
      await assertReference(transaction, businessId, id, next.reference, published.length > 0);
    }
    const nextCapturedLineIds = next
      ? resultCapturedLineIds!
      : trustedCapturedLineIds(record.capturedLineIds, record.draft as QuoteData);
    await transaction.update(quote).set({
      draft: next ?? record.draft,
      undoDraft: next ? record.draft : record.undoDraft,
      capturedLineIds: nextCapturedLineIds,
      undoCapturedLineIds: next ? trustedCapturedLineIds(record.capturedLineIds, record.draft as QuoteData) : record.undoCapturedLineIds,
      title: next?.title ?? record.title,
      reference: next?.reference ?? record.reference,
      version: next ? record.version + 1 : record.version,
      pending: false, pendingVersion: null, pendingRequestId: null, pendingExpiresAt: null, updatedAt: now,
    }).where(eq(quote.id, id));
    const message = assistantMessage(result.message, result.changed, changedFields);
    await transaction.insert(quoteMessage).values({ id: crypto.randomUUID(), quoteId: id, role: message.role, fr: message.fr, en: message.en, changed: storedChanges(result.changed, changedFields) });
    await transaction.update(quoteRequest).set({ status: "complete", updatedAt: now }).where(eq(quoteRequest.id, request.id));
    detail = await readDetail(transaction, businessId, id);
  });
  if (stale) throw new RequestFailure(409, "assistant_stale");
  if (!detail) throw new RequestFailure(500, "request_failed");
  return { ...detail, ...(result.reviewPublication ? { reviewPublication: true } : {}) };
}

async function failAssistant(database: Database, businessId: string, id: string, requestId: string, now: Date) {
  await database.transaction(async (transaction) => {
    await lockRequest(transaction, businessId, requestId);
    await lockQuote(transaction, id);
    await transaction.update(quote).set({ pending: false, pendingVersion: null, pendingRequestId: null, pendingExpiresAt: null, updatedAt: now }).where(and(eq(quote.id, id), eq(quote.businessId, businessId), eq(quote.pendingRequestId, requestId)));
    await transaction.update(quoteRequest).set({ status: "failed", updatedAt: now }).where(and(eq(quoteRequest.businessId, businessId), eq(quoteRequest.requestId, requestId), eq(quoteRequest.status, "pending")));
  });
}
