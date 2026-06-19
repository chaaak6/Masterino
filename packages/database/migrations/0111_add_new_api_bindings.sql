CREATE TABLE IF NOT EXISTS "new_api_bindings" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "new_api_user_id" integer NOT NULL,
  "encrypted_access_token" text NOT NULL,
  "managed_token_id" integer,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "last_synced_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "new_api_bindings_new_api_user_id_idx"
  ON "new_api_bindings" ("new_api_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "new_api_bindings_status_idx"
  ON "new_api_bindings" ("status");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'new_api_bindings_status_check'
  ) THEN
    ALTER TABLE "new_api_bindings"
      ADD CONSTRAINT "new_api_bindings_status_check"
      CHECK ("status" IN ('pending', 'active', 'error'));
  END IF;
END $$;
