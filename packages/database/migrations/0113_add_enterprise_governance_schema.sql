DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enterprise_principal_type') THEN
    CREATE TYPE "public"."enterprise_principal_type" AS ENUM('user', 'role', 'workspace', 'department');
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enterprise_resource_permission') THEN
    CREATE TYPE "public"."enterprise_resource_permission" AS ENUM('read', 'write', 'manage');
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enterprise_resource_type') THEN
    CREATE TYPE "public"."enterprise_resource_type" AS ENUM('knowledge_base', 'folder', 'document', 'file', 'skill', 'connector');
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enterprise_workspace_policy_type') THEN
    CREATE TYPE "public"."enterprise_workspace_policy_type" AS ENUM('knowledge', 'skill', 'connector', 'upload', 'ai');
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"union_id" text,
	"email" text,
	"mobile_hash" text,
	"raw_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_access_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"resource_type" "enterprise_resource_type" NOT NULL,
	"resource_id" text NOT NULL,
	"principal_type" "enterprise_principal_type" NOT NULL,
	"principal_id" text NOT NULL,
	"permission" "enterprise_resource_permission" NOT NULL,
	"inherited_from_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sso_provider_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_type" "enterprise_workspace_policy_type" NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_identities_user_id_users_id_fk') THEN
    ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_access_controls_workspace_id_workspaces_id_fk') THEN
    ALTER TABLE "resource_access_controls" ADD CONSTRAINT "resource_access_controls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_access_controls_inherited_from_id_resource_access_controls_id_fk') THEN
    ALTER TABLE "resource_access_controls" ADD CONSTRAINT "resource_access_controls_inherited_from_id_resource_access_controls_id_fk" FOREIGN KEY ("inherited_from_id") REFERENCES "public"."resource_access_controls"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_access_controls_created_by_users_id_fk') THEN
    ALTER TABLE "resource_access_controls" ADD CONSTRAINT "resource_access_controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sso_provider_configs_updated_by_users_id_fk') THEN
    ALTER TABLE "sso_provider_configs" ADD CONSTRAINT "sso_provider_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_configs_updated_by_users_id_fk') THEN
    ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_policies_workspace_id_workspaces_id_fk') THEN
    ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_policies_updated_by_users_id_fk') THEN
    ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_identities_provider_external_user_id_unique" ON "external_identities" USING btree ("provider","external_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_identities_user_id_provider_idx" ON "external_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_access_controls_resource_idx" ON "resource_access_controls" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_access_controls_principal_idx" ON "resource_access_controls" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_access_controls_workspace_scope_unique" ON "resource_access_controls" USING btree ("workspace_id","resource_type","resource_id","principal_type","principal_id") WHERE "resource_access_controls"."workspace_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_access_controls_global_scope_unique" ON "resource_access_controls" USING btree ("resource_type","resource_id","principal_type","principal_id") WHERE "resource_access_controls"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sso_provider_configs_provider_unique" ON "sso_provider_configs" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "system_configs_key_scope_unique" ON "system_configs" USING btree ("key","scope");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_policies_workspace_id_policy_type_unique" ON "workspace_policies" USING btree ("workspace_id","policy_type");
