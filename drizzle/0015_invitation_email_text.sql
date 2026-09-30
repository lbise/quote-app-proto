-- The invitation email's subject and message, as the Administrator wrote them,
-- so resending sends the same text with the new link. Existing invitations keep
-- null, which means the default text for their role.
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "email_subject" text;
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "email_message" text;
