-- Every existing User keeps access: the default marks them active.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_status";
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_status" CHECK ("status" in ('invited', 'active', 'blocked'));
--> statement-breakpoint
-- The Administrator role granted in the admin area. ADMIN_EMAILS Administrators
-- are derived from configuration and are not stored here.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "administrator" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "administrator_action" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "actor_email" text NOT NULL,
  "target_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "target_email" text NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "administrator_action_action" CHECK ("action" in ('block', 'unblock', 'grant_administrator', 'remove_administrator'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "administrator_action_created_idx" ON "administrator_action" ("created_at");
