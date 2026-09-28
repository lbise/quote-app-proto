ALTER TABLE "quote_message" ADD COLUMN IF NOT EXISTS "dictated" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "quote_message" ADD COLUMN IF NOT EXISTS "dictation_edit_ratio" double precision;
--> statement-breakpoint
ALTER TABLE "quote_message" DROP CONSTRAINT IF EXISTS "quote_message_dictation_edit_ratio";
--> statement-breakpoint
ALTER TABLE "quote_message" ADD CONSTRAINT "quote_message_dictation_edit_ratio" CHECK (
  ("dictated" AND "dictation_edit_ratio" BETWEEN 0 AND 1) OR (NOT "dictated" AND "dictation_edit_ratio" IS NULL)
);
