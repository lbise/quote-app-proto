import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { assertAdministrator, businessName } from "./administration.server";
import type { Database } from "./db.server";
import {
  artisanBusiness,
  businessDefaults,
  quote,
  quoteMessage,
  quoteRevision,
  turnTrace,
  user,
  type TurnOutcomeKind,
  type UserStatus,
} from "./db/schema";
import type { QuoteData } from "./quote";
import { turnTraceRetentionMs } from "./turn-traces.server";

/**
 * Read-only views of every Artisan Business for Administrators (#53). Each
 * read refuses anyone who is not an Administrator. Nothing here changes a
 * record.
 */

export type BusinessOverview = {
  id: string;
  name: string;
  owner: { id: string; name: string; email: string; status: UserStatus };
  activeQuotes: number;
  archivedQuotes: number;
  /** The latest Assistant Turn or Quote change; null before the first Quote. */
  lastActivityAt: Date | null;
};

export type AdministeredQuote = {
  id: string;
  reference: string;
  title: string;
  customerName: string;
  archived: boolean;
  hasDraft: boolean;
  /** The latest Published Revision number, 0 before the first Publication. */
  revision: number;
  updatedAt: Date;
};

/** A Turn Trace an Assistant Turn in the conversation links to. */
export type ConversationTrace = { id: string; outcomeKind: TurnOutcomeKind; createdAt: Date };

export type ConversationEntry = {
  id: string;
  role: "artisan" | "assistant" | "note";
  fr: string;
  en: string;
  createdAt: Date;
  /**
   * On the Artisan message that started an Assistant Turn: the turn's retained
   * Turn Traces, usually one. Empty once they expired.
   */
  traces?: ConversationTrace[];
};

export type AdministeredQuoteDetail = {
  id: string;
  reference: string;
  title: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
  business: Omit<BusinessOverview, "activeQuotes" | "archivedQuotes" | "lastActivityAt">;
  draft: QuoteData | null;
  revisions: { number: number; publishedAt: Date }[];
  conversation: ConversationEntry[];
};

const activeQuotes = sql<number>`(select count(*) from ${quote} where ${quote.businessId} = ${artisanBusiness.id} and ${quote.archivedAt} is null)::int`;
const archivedQuotes = sql<number>`(select count(*) from ${quote} where ${quote.businessId} = ${artisanBusiness.id} and ${quote.archivedAt} is not null)::int`;
// greatest() skips nulls; it is null only when both are.
const lastActivityAt = sql<Date | string | null>`greatest(
  (select max(${quote.updatedAt}) from ${quote} where ${quote.businessId} = ${artisanBusiness.id}),
  (select max(${turnTrace.createdAt}) from ${turnTrace} where ${turnTrace.businessId} = ${artisanBusiness.id})
)`;

function businesses(database: Database) {
  return database.select({
    id: artisanBusiness.id,
    createdAt: artisanBusiness.createdAt,
    defaults: businessDefaults.defaults,
    ownerId: user.id,
    ownerName: user.name,
    ownerEmail: user.email,
    ownerStatus: user.status,
    activeQuotes,
    archivedQuotes,
    lastActivityAt,
  }).from(artisanBusiness)
    .innerJoin(user, eq(user.id, artisanBusiness.ownerUserId))
    .leftJoin(businessDefaults, eq(businessDefaults.businessId, artisanBusiness.id));
}

type BusinessRow = Awaited<ReturnType<typeof businesses>>[number];

function overview(row: BusinessRow): BusinessOverview {
  return {
    id: row.id,
    name: businessName(row.defaults),
    owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail, status: row.ownerStatus },
    activeQuotes: row.activeQuotes,
    archivedQuotes: row.archivedQuotes,
    lastActivityAt: row.lastActivityAt === null ? null : new Date(row.lastActivityAt),
  };
}

/** Every Artisan Business, most recently active first; businesses without activity last. */
export async function listArtisanBusinesses(database: Database, viewerUserId: string): Promise<BusinessOverview[]> {
  await assertAdministrator(database, viewerUserId);
  const rows = await businesses(database).orderBy(sql`${lastActivityAt} desc nulls last`, desc(artisanBusiness.createdAt), asc(artisanBusiness.id));
  return rows.map(overview);
}

/** One Artisan Business and all its Quotes, Archived Quotes included, most recently changed first. Null when it does not exist. */
export async function readArtisanBusiness(database: Database, viewerUserId: string, businessId: string): Promise<{ business: BusinessOverview; quotes: AdministeredQuote[] } | null> {
  await assertAdministrator(database, viewerUserId);
  const [row] = await businesses(database).where(eq(artisanBusiness.id, businessId)).limit(1);
  if (!row) return null;
  const records = await database.select().from(quote).where(eq(quote.businessId, businessId)).orderBy(desc(quote.updatedAt), asc(quote.id));
  const revisions = await database.select({ quoteId: quoteRevision.quoteId, number: quoteRevision.number, quote: quoteRevision.quote })
    .from(quoteRevision).where(eq(quoteRevision.businessId, businessId));
  return {
    business: overview(row),
    quotes: records.map((record) => {
      const latest = revisions.filter((revision) => revision.quoteId === record.id).sort((a, b) => b.number - a.number)[0];
      const document = (record.draft ?? latest?.quote ?? {}) as Partial<QuoteData>;
      return {
        id: record.id,
        reference: record.reference,
        title: document.title ?? record.title,
        customerName: document.customerName ?? "",
        archived: record.archivedAt !== null,
        hasDraft: record.draft !== null,
        revision: latest?.number ?? 0,
        updatedAt: record.updatedAt,
      };
    }),
  };
}

/**
 * A Quote, Archived or not, with its Working Draft, Published Revisions and
 * conversation. Each Artisan message that started an Assistant Turn carries
 * the turn's retained Turn Traces. Null when the Quote does not exist.
 */
export async function readQuoteForAdministrator(database: Database, viewerUserId: string, quoteId: string, now = new Date()): Promise<AdministeredQuoteDetail | null> {
  await assertAdministrator(database, viewerUserId);
  const [record] = await database.select().from(quote).where(eq(quote.id, quoteId)).limit(1);
  if (!record) return null;
  const [owner] = await businesses(database).where(eq(artisanBusiness.id, record.businessId)).limit(1);
  const revisions = await database.select({ number: quoteRevision.number, publishedAt: quoteRevision.publishedAt, quote: quoteRevision.quote })
    .from(quoteRevision).where(eq(quoteRevision.quoteId, quoteId)).orderBy(asc(quoteRevision.number));
  const messages = await database.select().from(quoteMessage).where(eq(quoteMessage.quoteId, quoteId)).orderBy(asc(quoteMessage.sequence));
  const turnRequestIds = messages.filter((message) => message.role === "artisan" && message.requestId !== null).map((message) => message.requestId!);
  const traces = turnRequestIds.length ? await database.select({ id: turnTrace.id, requestId: turnTrace.requestId, outcomeKind: turnTrace.outcomeKind, createdAt: turnTrace.createdAt })
    .from(turnTrace)
    .where(and(eq(turnTrace.quoteId, quoteId), inArray(turnTrace.requestId, turnRequestIds), gte(turnTrace.createdAt, new Date(now.getTime() - turnTraceRetentionMs))))
    .orderBy(asc(turnTrace.createdAt), asc(turnTrace.id)) : [];
  const latest = revisions.at(-1);
  const document = (record.draft ?? latest?.quote ?? {}) as Partial<QuoteData>;
  const { activeQuotes: _active, archivedQuotes: _archived, lastActivityAt: _last, ...business } = overview(owner);
  return {
    id: record.id,
    reference: record.reference,
    title: document.title ?? record.title,
    archived: record.archivedAt !== null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    business,
    draft: (record.draft ?? null) as QuoteData | null,
    revisions: revisions.map((revision) => ({ number: revision.number, publishedAt: revision.publishedAt })),
    conversation: messages.map((message) => ({
      id: message.id,
      role: message.role as ConversationEntry["role"],
      fr: message.fr,
      en: message.en,
      createdAt: message.createdAt,
      ...(message.role === "artisan" && message.requestId !== null
        ? { traces: traces.filter((trace) => trace.requestId === message.requestId).map(({ requestId: _requestId, ...trace }) => trace) }
        : {}),
    })),
  };
}
