CREATE TABLE IF NOT EXISTS "app_installation" (
  "id" integer PRIMARY KEY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "single_installation" CHECK ("app_installation"."id" = 1)
);
--> statement-breakpoint
INSERT INTO "app_installation" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
