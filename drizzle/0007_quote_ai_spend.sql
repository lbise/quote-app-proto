CREATE TABLE IF NOT EXISTS "quote_ai_spend" (
  "scope" text PRIMARY KEY NOT NULL,
  "reserved_nano_usd" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_ai_spend_non_negative" CHECK ("reserved_nano_usd" >= 0)
);
