-- Each Published Revision keeps the Quote Layout it was published with (ADR 0004).
-- Revisions published before Quote Layouts existed use standard version 1.
ALTER TABLE "quote_revision" ADD COLUMN IF NOT EXISTS "layout_id" text NOT NULL DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE "quote_revision" ADD COLUMN IF NOT EXISTS "layout_version" integer NOT NULL DEFAULT 1;
