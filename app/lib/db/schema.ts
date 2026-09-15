import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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

// The initial domain relationship is deliberately small: one Artisan belongs to
// one Artisan Business. Customers and Quotes will reference businessId later.
export const artisanBusiness = pgTable(
  "artisan_business",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("artisan_business_owner_idx").on(table.ownerUserId)],
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
    // Timestamps can tie. This identity gives the persisted conversation a
    // durable order without relying on UUID ordering.
    sequence: integer("sequence").generatedAlwaysAsIdentity().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("quote_message_quote_sequence_idx").on(table.quoteId, table.sequence)],
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
