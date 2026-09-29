-- Turn Traces (ADR 0007): what each Assistant Turn sent to and received from
-- the model. Deleted with their Quote, or after 30 days. `detail` is `json`,
-- not `jsonb`, so provider payloads keep their exact key order.
CREATE TABLE IF NOT EXISTS "turn_trace" (
  "id" text PRIMARY KEY NOT NULL,
  "quote_id" text NOT NULL REFERENCES "quote"("id") ON DELETE CASCADE,
  "business_id" text NOT NULL REFERENCES "artisan_business"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "request_id" text NOT NULL,
  "locale" text NOT NULL,
  "outcome" text NOT NULL,
  "reason" text,
  "base_version" integer,
  "result_version" integer,
  "message_id" text,
  "provider" text,
  "model" text,
  "model_call_count" integer DEFAULT 0 NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cost_usd" double precision DEFAULT 0 NOT NULL,
  "detail" json NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "turn_trace_outcome" CHECK ("outcome" in ('committed', 'unchanged', 'discarded')),
  CONSTRAINT "turn_trace_locale" CHECK ("locale" in ('en', 'fr'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_trace_quote_created_idx" ON "turn_trace" ("quote_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_trace_created_idx" ON "turn_trace" ("created_at");
