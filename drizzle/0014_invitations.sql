-- Invitations an Administrator sends so a person can sign up (#51). An
-- invitation is not a User: the invitee becomes one by signing up through the
-- invitation link. Only a hash of the link's token is stored.
CREATE TABLE IF NOT EXISTS "invitation" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "administrator" boolean DEFAULT false NOT NULL,
  "invited_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "invited_by_email" text NOT NULL,
  "sent_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "cancelled_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "accepted_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitation_email_idx" ON "invitation" ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitation_token_hash_idx" ON "invitation" ("token_hash");
--> statement-breakpoint
-- Invitations are part of the Administrator action record.
ALTER TABLE "administrator_action" DROP CONSTRAINT IF EXISTS "administrator_action_action";
--> statement-breakpoint
ALTER TABLE "administrator_action" ADD CONSTRAINT "administrator_action_action" CHECK ("action" in ('block', 'unblock', 'grant_administrator', 'remove_administrator', 'send_invitation', 'send_administrator_invitation', 'resend_invitation', 'cancel_invitation'));
