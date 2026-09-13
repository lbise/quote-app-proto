ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "pending_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quote_request" ADD COLUMN IF NOT EXISTS "payload_hash" text NOT NULL DEFAULT '';
