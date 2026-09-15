ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "captured_line_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "undo_captured_line_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "quote_message" ADD COLUMN IF NOT EXISTS "sequence" integer;
--> statement-breakpoint
WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id")::integer AS "sequence"
  FROM "quote_message"
)
UPDATE "quote_message"
SET "sequence" = ordered."sequence"
FROM ordered
WHERE "quote_message"."id" = ordered."id"
  AND "quote_message"."sequence" IS NULL;
--> statement-breakpoint
ALTER TABLE "quote_message" ALTER COLUMN "sequence" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_message" ALTER COLUMN "sequence" ADD GENERATED ALWAYS AS IDENTITY;
--> statement-breakpoint
SELECT setval(
  pg_get_serial_sequence('quote_message', 'sequence'),
  COALESCE((SELECT max("sequence") FROM "quote_message"), 0) + 1,
  false
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_message_quote_sequence_idx" ON "quote_message" ("quote_id", "sequence");
