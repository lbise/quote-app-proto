CREATE TABLE IF NOT EXISTS "business_defaults" (
  "business_id" text PRIMARY KEY NOT NULL REFERENCES "artisan_business"("id") ON DELETE CASCADE,
  "defaults" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer" (
  "id" text PRIMARY KEY NOT NULL,
  "business_id" text NOT NULL REFERENCES "artisan_business"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "address" text NOT NULL,
  "contact" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_business_idx" ON "customer" ("business_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote" (
  "id" text PRIMARY KEY NOT NULL,
  "business_id" text NOT NULL REFERENCES "artisan_business"("id") ON DELETE CASCADE,
  "reference" text NOT NULL,
  "title" text NOT NULL DEFAULT '',
  "draft" jsonb,
  "version" integer NOT NULL DEFAULT 0,
  "undo_draft" jsonb,
  "pending" boolean NOT NULL DEFAULT false,
  "pending_version" integer,
  "pending_request_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_version_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_business_reference_idx" ON "quote" ("business_id", "reference");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_business_updated_idx" ON "quote" ("business_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "quote_id" text NOT NULL REFERENCES "quote"("id") ON DELETE CASCADE,
  "business_id" text NOT NULL REFERENCES "artisan_business"("id") ON DELETE CASCADE,
  "number" integer NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "quote" jsonb NOT NULL,
  "calculation" jsonb NOT NULL,
  CONSTRAINT "quote_revision_number_positive" CHECK ("number" > 0),
  CONSTRAINT "quote_revision_quote_number_idx" UNIQUE ("quote_id", "number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_revision_business_idx" ON "quote_revision" ("business_id", "quote_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_message" (
  "id" text PRIMARY KEY NOT NULL,
  "quote_id" text NOT NULL REFERENCES "quote"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "fr" text NOT NULL,
  "en" text NOT NULL,
  "changed" jsonb,
  "request_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_message_role" CHECK ("role" in ('artisan', 'assistant', 'note'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_message_quote_idx" ON "quote_message" ("quote_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_message_request_idx" ON "quote_message" ("quote_id", "request_id") WHERE "request_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_request" (
  "id" text PRIMARY KEY NOT NULL,
  "business_id" text NOT NULL REFERENCES "artisan_business"("id") ON DELETE CASCADE,
  "quote_id" text REFERENCES "quote"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "request_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'complete',
  "base_version" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_request_status" CHECK ("status" in ('pending', 'complete', 'failed', 'stale')),
  CONSTRAINT "quote_request_business_request_unique" UNIQUE ("business_id", "request_id")
);
