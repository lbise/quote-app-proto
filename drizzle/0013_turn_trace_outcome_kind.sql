-- The outcome an Administrator filters Assistant Turns by (#53). It refines
-- `outcome`: a committed turn may have had failed tool calls, and a discarded
-- turn may have failed at the provider or before any model call was sent.
ALTER TABLE "turn_trace" ADD COLUMN IF NOT EXISTS "outcome_kind" text;
--> statement-breakpoint
-- Existing Turn Traces get the kind their recorded calls show. A call was sent
-- when the provider built its payload or answered.
UPDATE "turn_trace" SET "outcome_kind" = CASE
  WHEN "outcome" = 'committed' AND (
    "detail"->>'assistantOutcome' = 'committed_with_failed_calls'
    OR EXISTS (SELECT 1 FROM json_array_elements("detail"->'toolCalls') AS tool WHERE tool->>'outcome' = 'rejected')
  ) THEN 'committed_with_failed_calls'
  WHEN "outcome" IN ('committed', 'unchanged') THEN "outcome"
  WHEN NOT EXISTS (
    SELECT 1 FROM json_array_elements("detail"->'modelCalls') AS call WHERE call->'payload' IS NOT NULL OR call->'response' IS NOT NULL
  ) THEN 'failed_before_model_call'
  WHEN EXISTS (
    SELECT 1 FROM json_array_elements("detail"->'modelCalls') WITH ORDINALITY AS entry(call, position)
    WHERE entry.position = json_array_length("detail"->'modelCalls')
      AND (entry.call->'payload' IS NOT NULL OR entry.call->'response' IS NOT NULL)
      AND (entry.call->'error' IS NOT NULL OR entry.call->'response'->>'stopReason' IN ('error', 'aborted'))
  ) THEN 'provider_error'
  ELSE 'discarded'
END
WHERE "outcome_kind" IS NULL;
--> statement-breakpoint
ALTER TABLE "turn_trace" ALTER COLUMN "outcome_kind" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "turn_trace" DROP CONSTRAINT IF EXISTS "turn_trace_outcome_kind";
--> statement-breakpoint
ALTER TABLE "turn_trace" ADD CONSTRAINT "turn_trace_outcome_kind" CHECK ("outcome_kind" in ('committed', 'committed_with_failed_calls', 'unchanged', 'discarded', 'provider_error', 'failed_before_model_call'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_trace_user_created_idx" ON "turn_trace" ("user_id", "created_at");
