DROP INDEX IF EXISTS "user_memories_summary_vector_1024_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_details_vector_1024_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_contexts_description_vector_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_preferences_conclusion_directives_vector_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_activities_narrative_vector_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_activities_feedback_vector_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_identities_description_vector_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_experiences_situation_vector_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_experiences_action_vector_index";--> statement-breakpoint
DROP INDEX IF EXISTS "user_memories_experiences_key_learning_vector_index";--> statement-breakpoint

UPDATE "user_memories"
SET
  "summary_vector_1024" = CASE
    WHEN "summary_vector_1024" IS NULL OR vector_dims("summary_vector_1024") = 2048
      THEN "summary_vector_1024"
    ELSE NULL
  END,
  "details_vector_1024" = CASE
    WHEN "details_vector_1024" IS NULL OR vector_dims("details_vector_1024") = 2048
      THEN "details_vector_1024"
    ELSE NULL
  END;--> statement-breakpoint

UPDATE "user_memories_contexts"
SET "description_vector" = NULL
WHERE "description_vector" IS NOT NULL
  AND vector_dims("description_vector") <> 2048;--> statement-breakpoint

UPDATE "user_memories_preferences"
SET "conclusion_directives_vector" = NULL
WHERE "conclusion_directives_vector" IS NOT NULL
  AND vector_dims("conclusion_directives_vector") <> 2048;--> statement-breakpoint

UPDATE "user_memories_activities"
SET
  "narrative_vector" = CASE
    WHEN "narrative_vector" IS NULL OR vector_dims("narrative_vector") = 2048
      THEN "narrative_vector"
    ELSE NULL
  END,
  "feedback_vector" = CASE
    WHEN "feedback_vector" IS NULL OR vector_dims("feedback_vector") = 2048
      THEN "feedback_vector"
    ELSE NULL
  END;--> statement-breakpoint

UPDATE "user_memories_identities"
SET "description_vector" = NULL
WHERE "description_vector" IS NOT NULL
  AND vector_dims("description_vector") <> 2048;--> statement-breakpoint

UPDATE "user_memories_experiences"
SET
  "situation_vector" = CASE
    WHEN "situation_vector" IS NULL OR vector_dims("situation_vector") = 2048
      THEN "situation_vector"
    ELSE NULL
  END,
  "action_vector" = CASE
    WHEN "action_vector" IS NULL OR vector_dims("action_vector") = 2048
      THEN "action_vector"
    ELSE NULL
  END,
  "key_learning_vector" = CASE
    WHEN "key_learning_vector" IS NULL OR vector_dims("key_learning_vector") = 2048
      THEN "key_learning_vector"
    ELSE NULL
  END;--> statement-breakpoint

ALTER TABLE "user_memories"
  ALTER COLUMN "summary_vector_1024" TYPE halfvec(2048)
    USING "summary_vector_1024"::halfvec(2048),
  ALTER COLUMN "details_vector_1024" TYPE halfvec(2048)
    USING "details_vector_1024"::halfvec(2048);--> statement-breakpoint

ALTER TABLE "user_memories_contexts"
  ALTER COLUMN "description_vector" TYPE halfvec(2048)
    USING "description_vector"::halfvec(2048);--> statement-breakpoint

ALTER TABLE "user_memories_preferences"
  ALTER COLUMN "conclusion_directives_vector" TYPE halfvec(2048)
    USING "conclusion_directives_vector"::halfvec(2048);--> statement-breakpoint

ALTER TABLE "user_memories_activities"
  ALTER COLUMN "narrative_vector" TYPE halfvec(2048)
    USING "narrative_vector"::halfvec(2048),
  ALTER COLUMN "feedback_vector" TYPE halfvec(2048)
    USING "feedback_vector"::halfvec(2048);--> statement-breakpoint

ALTER TABLE "user_memories_identities"
  ALTER COLUMN "description_vector" TYPE halfvec(2048)
    USING "description_vector"::halfvec(2048);--> statement-breakpoint

ALTER TABLE "user_memories_experiences"
  ALTER COLUMN "situation_vector" TYPE halfvec(2048)
    USING "situation_vector"::halfvec(2048),
  ALTER COLUMN "action_vector" TYPE halfvec(2048)
    USING "action_vector"::halfvec(2048),
  ALTER COLUMN "key_learning_vector" TYPE halfvec(2048)
    USING "key_learning_vector"::halfvec(2048);--> statement-breakpoint

CREATE INDEX "user_memories_summary_vector_1024_index"
  ON "user_memories" USING hnsw ("summary_vector_1024" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_details_vector_1024_index"
  ON "user_memories" USING hnsw ("details_vector_1024" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_contexts_description_vector_index"
  ON "user_memories_contexts" USING hnsw ("description_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_preferences_conclusion_directives_vector_index"
  ON "user_memories_preferences" USING hnsw ("conclusion_directives_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_activities_narrative_vector_index"
  ON "user_memories_activities" USING hnsw ("narrative_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_activities_feedback_vector_index"
  ON "user_memories_activities" USING hnsw ("feedback_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_identities_description_vector_index"
  ON "user_memories_identities" USING hnsw ("description_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_experiences_situation_vector_index"
  ON "user_memories_experiences" USING hnsw ("situation_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_experiences_action_vector_index"
  ON "user_memories_experiences" USING hnsw ("action_vector" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_memories_experiences_key_learning_vector_index"
  ON "user_memories_experiences" USING hnsw ("key_learning_vector" halfvec_cosine_ops);
