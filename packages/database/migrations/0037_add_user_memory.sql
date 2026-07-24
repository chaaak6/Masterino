CREATE TABLE IF NOT EXISTS "user_memories" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" text,
	"memory_category" varchar(255),
	"memory_layer" varchar(255),
	"memory_type" varchar(255),
	"title" varchar(255),
	"summary" text,
	"summary_vector_1024" halfvec(2048),
	"details" text,
	"details_vector_1024" halfvec(2048),
	"status" varchar(255),
	"accessed_count" bigint DEFAULT 0,
	"last_accessed_at" timestamp with time zone NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memories_contexts" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_memory_ids" jsonb,
	"labels" jsonb,
	"extracted_labels" jsonb,
	"associated_objects" jsonb,
	"associated_subjects" jsonb,
	"title" text,
	"title_vector" halfvec(2048),
	"description" text,
	"description_vector" halfvec(2048),
	"type" varchar(255),
	"current_status" text,
	"score_impact" numeric DEFAULT 0,
	"score_urgency" numeric DEFAULT 0,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memories_experiences" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_memory_id" text,
	"labels" jsonb,
	"extracted_labels" jsonb,
	"type" varchar(255),
	"situation" text,
	"situation_vector" halfvec(2048),
	"reasoning" text,
	"possible_outcome" text,
	"action" text,
	"action_vector" halfvec(2048),
	"key_learning" text,
	"key_learning_vector" halfvec(2048),
	"metadata" jsonb,
	"score_confidence" real DEFAULT 0,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memories_identities" (
	"current_focuses" text,
	"description" text,
	"description_vector" halfvec(2048),
	"experience" text,
	"extracted_labels" jsonb,
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"labels" jsonb,
	"relationship" text,
	"role" text,
	"type" varchar(255),
	"user_memory_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memories_preferences" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"context_id" varchar(255),
	"user_memory_id" varchar(255),
	"labels" jsonb,
	"extracted_labels" jsonb,
	"extracted_scopes" jsonb,
	"conclusion_directives" text,
	"conclusion_directives_vector" halfvec(2048),
	"type" varchar(255),
	"suggestions" text,
	"score_priority" numeric DEFAULT 0,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD CONSTRAINT "user_memories_experiences_user_memory_id_user_memories_id_fk" FOREIGN KEY ("user_memory_id") REFERENCES "public"."user_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD CONSTRAINT "user_memories_identities_user_memory_id_user_memories_id_fk" FOREIGN KEY ("user_memory_id") REFERENCES "public"."user_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD CONSTRAINT "user_memories_preferences_context_id_user_memories_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."user_memories_contexts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD CONSTRAINT "user_memories_preferences_user_memory_id_user_memories_id_fk" FOREIGN KEY ("user_memory_id") REFERENCES "public"."user_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_memories_summary_vector_1024_index" ON "user_memories" USING hnsw ("summary_vector_1024" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_details_vector_1024_index" ON "user_memories" USING hnsw ("details_vector_1024" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_contexts_title_vector_index" ON "user_memories_contexts" USING hnsw ("title_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_contexts_description_vector_index" ON "user_memories_contexts" USING hnsw ("description_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_contexts_type_index" ON "user_memories_contexts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "user_memories_experiences_situation_vector_index" ON "user_memories_experiences" USING hnsw ("situation_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_experiences_action_vector_index" ON "user_memories_experiences" USING hnsw ("action_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_experiences_key_learning_vector_index" ON "user_memories_experiences" USING hnsw ("key_learning_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_experiences_type_index" ON "user_memories_experiences" USING btree ("type");--> statement-breakpoint
CREATE INDEX "user_memories_identities_description_vector_index" ON "user_memories_identities" USING hnsw ("description_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_identities_type_index" ON "user_memories_identities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "user_memories_preferences_conclusion_directives_vector_index" ON "user_memories_preferences" USING hnsw ("conclusion_directives_vector" halfvec_cosine_ops);
