CREATE TABLE IF NOT EXISTS "managed_model_catalog" (
  "model_id" text PRIMARY KEY NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "draft" jsonb NOT NULL,
  "published" jsonb,
  "published_revision" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "managed_model_catalog_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "model_id" text NOT NULL REFERENCES "managed_model_catalog"("model_id"),
  "description" jsonb NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "managed_model_catalog_revisions_model_idx" ON "managed_model_catalog_revisions" ("model_id", "created_at");
