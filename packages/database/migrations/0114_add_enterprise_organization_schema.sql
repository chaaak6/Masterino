CREATE TABLE IF NOT EXISTS "enterprise_departments" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_department_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"raw_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_department_members" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"user_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"employee_number" text,
	"employment_status" text DEFAULT 'active' NOT NULL,
	"position" text,
	"primary_department_id" text,
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"raw_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_departments_parent_id_enterprise_departments_id_fk') THEN
    ALTER TABLE "enterprise_departments" ADD CONSTRAINT "enterprise_departments_parent_id_enterprise_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."enterprise_departments"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_department_members_department_id_enterprise_departments_id_fk') THEN
    ALTER TABLE "enterprise_department_members" ADD CONSTRAINT "enterprise_department_members_department_id_enterprise_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."enterprise_departments"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_department_members_user_id_users_id_fk') THEN
    ALTER TABLE "enterprise_department_members" ADD CONSTRAINT "enterprise_department_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_user_profiles_user_id_users_id_fk') THEN
    ALTER TABLE "enterprise_user_profiles" ADD CONSTRAINT "enterprise_user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_user_profiles_primary_department_id_enterprise_departments_id_fk') THEN
    ALTER TABLE "enterprise_user_profiles" ADD CONSTRAINT "enterprise_user_profiles_primary_department_id_enterprise_departments_id_fk" FOREIGN KEY ("primary_department_id") REFERENCES "public"."enterprise_departments"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_departments_provider_external_department_id_unique" ON "enterprise_departments" USING btree ("provider","external_department_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_departments_parent_id_idx" ON "enterprise_departments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_department_members_department_id_user_id_unique" ON "enterprise_department_members" USING btree ("department_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_department_members_user_id_idx" ON "enterprise_department_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_user_profiles_employee_number_unique" ON "enterprise_user_profiles" USING btree ("employee_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_user_profiles_provider_external_user_id_unique" ON "enterprise_user_profiles" USING btree ("provider","external_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_user_profiles_primary_department_id_idx" ON "enterprise_user_profiles" USING btree ("primary_department_id");
