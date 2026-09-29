ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "artisan_business" ADD COLUMN IF NOT EXISTS "next_quote_number" bigint NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "artisan_business" DROP CONSTRAINT IF EXISTS "artisan_business_next_quote_number_positive";
--> statement-breakpoint
ALTER TABLE "artisan_business" ADD CONSTRAINT "artisan_business_next_quote_number_positive" CHECK ("next_quote_number" >= 1);
--> statement-breakpoint
-- Start each business's counter after its highest current Q-<n>, so no
-- existing or later-deleted reference is ever assigned again.
UPDATE "artisan_business" AS business
SET "next_quote_number" = GREATEST(business."next_quote_number", highest.number + 1)
FROM (
  SELECT "business_id", max(substring("reference" from '^Q-([0-9]{1,15})$')::bigint) AS number
  FROM "quote"
  GROUP BY "business_id"
) AS highest
WHERE highest."business_id" = business."id" AND highest.number IS NOT NULL;
