ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "is_admin_managed" boolean DEFAULT false NOT NULL;
