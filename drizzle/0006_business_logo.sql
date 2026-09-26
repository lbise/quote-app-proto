CREATE TABLE IF NOT EXISTS "business_logo" (
  "id" text PRIMARY KEY NOT NULL,
  "business_id" text NOT NULL REFERENCES "artisan_business"("id") ON DELETE CASCADE,
  "content_type" text NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "business_logo_content_type" CHECK ("content_type" in ('image/png', 'image/jpeg'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_logo_business_idx" ON "business_logo" ("business_id");
