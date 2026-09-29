import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  check,
  customType,
  integer,
  index,
  json,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { turnOutcomeKinds, type TurnOutcomeKind } from "../turn-trace";

// A single installation marker proves migrations ran and storage survives redeploys.
// This is infrastructure state, not a customer or quote model.
export const appInstallation = pgTable(
  "app_installation",
  {
    id: integer("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("single_installation", sql`${table.id} = 1`)],
);

// Better Auth's PostgreSQL adapter uses these four tables. Keep their names and
// columns aligned with its documented Drizzle schema so direct API requests and
// server-side calls share the same session store.
export const userStatuses = ["invited", "active", "blocked"] as const;
export type UserStatus = typeof userStatuses[number];

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    // Only an active User may sign in. Blocking keeps the User's business records.
    status: text("status").$type<UserStatus>().default("active").notNull(),
    // The Administrator role granted in the admin area. ADMIN_EMAILS
    // Administrators come from configuration and are not stored.
    administrator: boolean("administrator").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("user_status", sql`${table.status} in ('invited', 'active', 'blocked')`)],
);

export const administratorActions = ["block", "unblock", "grant_administrator", "remove_administrator"] as const;
export type AdministratorActionKind = typeof administratorActions[number];

// Every Administrator change to a User, kept indefinitely. Emails are copied so
// a record stays readable if either User is later deleted.
export const administratorAction = pgTable(
  "administrator_action",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorEmail: text("actor_email").notNull(),
    targetUserId: text("target_user_id").references(() => user.id, { onDelete: "set null" }),
    targetEmail: text("target_email").notNull(),
    action: text("action").$type<AdministratorActionKind>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("administrator_action_created_idx").on(table.createdAt),
    check("administrator_action_action", sql`${table.action} in ('block', 'unblock', 'grant_administrator', 'remove_administrator')`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("session_token_idx").on(table.token)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Marks accounts created by `npm run seed:demo`. The seeder only resets or
// skips marked accounts, so a real Artisan sharing an email is never touched.
export const demoAccount = pgTable("demo_account", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// The initial domain relationship is deliberately small: one Artisan belongs to
// one Artisan Business. Customers and Quotes will reference businessId later.
export const artisanBusiness = pgTable(
  "artisan_business",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    // The next automatic `Q-<n>` reference. It only goes up, so a deleted
    // Quote's reference is never given to another Quote (ADR 0006).
    nextQuoteNumber: bigint("next_quote_number", { mode: "number" }).default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("artisan_business_owner_idx").on(table.ownerUserId),
    check("artisan_business_next_quote_number_positive", sql`${table.nextQuoteNumber} >= 1`),
  ],
);

export const artisan = pgTable(
  "artisan",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    businessId: text("business_id").notNull().references(() => artisanBusiness.id, { onDelete: "cascade" }),
    interfaceLanguage: text("interface_language").default("fr").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("artisan_user_idx").on(table.userId),
    uniqueIndex("artisan_business_idx").on(table.businessId),
    check("artisan_interface_language", sql`${table.interfaceLanguage} in ('en', 'fr')`),
  ],
);

// Quote documents are snapshots. Reusable Customer and default records never
// join into an existing Working Draft or Published Revision at read time.
export const businessDefaults = pgTable("business_defaults", {
  businessId: text("business_id").primaryKey().references(() => artisanBusiness.id, { onDelete: "cascade" }),
  defaults: jsonb("defaults").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

// Logos are immutable. Replacing a logo adds a row, and Working Drafts and
// Published Revisions keep pointing at the logo they copied (ADR 0003).
export const businessLogo = pgTable(
  "business_logo",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").notNull().references(() => artisanBusiness.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("business_logo_business_idx").on(table.businessId),
    check("business_logo_content_type", sql`${table.contentType} in ('image/png', 'image/jpeg')`),
  ],
);

export const customer = pgTable(
  "customer",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").notNull().references(() => artisanBusiness.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address").notNull(),
    contact: text("contact").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("customer_business_idx").on(table.businessId)],
);

export const quote = pgTable(
  "quote",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").notNull().references(() => artisanBusiness.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    title: text("title").default("").notNull(),
    draft: jsonb("draft").$type<unknown>(),
    version: integer("version").default(0).notNull(),
    undoDraft: jsonb("undo_draft").$type<unknown>(),
    // Assistant capture eligibility is server-owned provenance, never part of
    // the editable Working Draft JSON received from a browser.
    capturedLineIds: jsonb("captured_line_ids").$type<string[]>().default([]).notNull(),
    undoCapturedLineIds: jsonb("undo_captured_line_ids").$type<string[]>(),
    pending: boolean("pending").default(false).notNull(),
    pendingVersion: integer("pending_version"),
    pendingRequestId: text("pending_request_id"),
    pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
    // Set while the Quote is an Archived Quote: read-only until restored.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("quote_business_reference_idx").on(table.businessId, table.reference),
    index("quote_business_updated_idx").on(table.businessId, table.updatedAt),
    check("quote_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const quoteRevision = pgTable(
  "quote_revision",
  {
    id: text("id").primaryKey(),
    quoteId: text("quote_id").notNull().references(() => quote.id, { onDelete: "cascade" }),
    businessId: text("business_id").notNull().references(() => artisanBusiness.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
    quote: jsonb("quote").$type<unknown>().notNull(),
    calculation: jsonb("calculation").$type<unknown>().notNull(),
    // The Quote Layout this revision was published with (ADR 0004).
    layoutId: text("layout_id").default("standard").notNull(),
    layoutVersion: integer("layout_version").default(1).notNull(),
  },
  (table) => [uniqueIndex("quote_revision_quote_number_idx").on(table.quoteId, table.number)],
);

export const quoteMessage = pgTable(
  "quote_message",
  {
    id: text("id").primaryKey(),
    quoteId: text("quote_id").notNull().references(() => quote.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    fr: text("fr").notNull(),
    en: text("en").notNull(),
    changed: jsonb("changed").$type<string[] | { lines: string[]; fields: string[] }>(),
    requestId: text("request_id"),
    // Whether an Artisan message was entered by dictation, and the character
    // edit ratio between the returned transcript and the sent text. Measures
    // transcript quality; no audio or transcript text is stored.
    dictated: boolean("dictated").default(false).notNull(),
    dictationEditRatio: doublePrecision("dictation_edit_ratio"),
    // Timestamps can tie. This identity gives the persisted conversation a
    // durable order without relying on UUID ordering.
    sequence: integer("sequence").generatedAlwaysAsIdentity().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("quote_message_quote_sequence_idx").on(table.quoteId, table.sequence),
    check("quote_message_dictation_edit_ratio", sql`(${table.dictated} AND ${table.dictationEditRatio} BETWEEN 0 AND 1) OR (NOT ${table.dictated} AND ${table.dictationEditRatio} IS NULL)`),
  ],
);

export const quoteRequest = pgTable(
  "quote_request",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").notNull().references(() => artisanBusiness.id, { onDelete: "cascade" }),
    quoteId: text("quote_id").references(() => quote.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    requestId: text("request_id").notNull(),
    status: text("status").default("complete").notNull(),
    baseVersion: integer("base_version"),
    payloadHash: text("payload_hash").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("quote_request_business_request_idx").on(table.businessId, table.requestId)],
);

export const turnTraceOutcomes = ["committed", "unchanged", "discarded"] as const;
export type TurnTraceOutcome = typeof turnTraceOutcomes[number];

export { turnOutcomeKinds, type TurnOutcomeKind };

// A Turn Trace: what one Assistant Turn sent to and received from the model
// (ADR 0007). Only Administrators read it. It goes with its Quote, or after 30
// days. `detail` is `json`, not `jsonb`, so payloads keep their exact key order.
export const turnTrace = pgTable(
  "turn_trace",
  {
    id: text("id").primaryKey(),
    quoteId: text("quote_id").notNull().references(() => quote.id, { onDelete: "cascade" }),
    businessId: text("business_id").notNull().references(() => artisanBusiness.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    requestId: text("request_id").notNull(),
    locale: text("locale").$type<"en" | "fr">().notNull(),
    outcome: text("outcome").$type<TurnTraceOutcome>().notNull(),
    outcomeKind: text("outcome_kind").$type<TurnOutcomeKind>().notNull(),
    // Why the turn was discarded, as a bounded code.
    reason: text("reason"),
    baseVersion: integer("base_version"),
    resultVersion: integer("result_version"),
    // The assistant message or note the turn left in the conversation.
    messageId: text("message_id"),
    provider: text("provider"),
    model: text("model"),
    modelCallCount: integer("model_call_count").default(0).notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    costUsd: doublePrecision("cost_usd").default(0).notNull(),
    detail: json("detail").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("turn_trace_quote_created_idx").on(table.quoteId, table.createdAt),
    index("turn_trace_created_idx").on(table.createdAt),
    index("turn_trace_user_created_idx").on(table.userId, table.createdAt),
    check("turn_trace_outcome", sql`${table.outcome} in ('committed', 'unchanged', 'discarded')`),
    check("turn_trace_outcome_kind", sql`${table.outcomeKind} in ('committed', 'committed_with_failed_calls', 'unchanged', 'discarded', 'provider_error', 'failed_before_model_call')`),
    check("turn_trace_locale", sql`${table.locale} in ('en', 'fr')`),
  ],
);

// One cumulative Quote AI spending allowance per deployment database, shared by
// every Artisan and server process. Reservations are integer nanodollars and
// never reset automatically; the operator raises the configured ceiling.
export const quoteAISpend = pgTable(
  "quote_ai_spend",
  {
    scope: text("scope").primaryKey(),
    reservedNanoUsd: bigint("reserved_nano_usd", { mode: "number" }).default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("quote_ai_spend_non_negative", sql`${table.reservedNanoUsd} >= 0`)],
);
