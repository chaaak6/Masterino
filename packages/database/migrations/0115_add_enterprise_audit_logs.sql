CREATE TABLE IF NOT EXISTS "enterprise_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"result" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_audit_logs_actor_user_id_users_id_fk') THEN
    ALTER TABLE "enterprise_audit_logs" ADD CONSTRAINT "enterprise_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_audit_logs_actor_user_id_idx" ON "enterprise_audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_audit_logs_action_idx" ON "enterprise_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_audit_logs_target_idx" ON "enterprise_audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_audit_logs_created_at_idx" ON "enterprise_audit_logs" USING btree ("created_at");
