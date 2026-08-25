CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "app"."grade_scale" (
	"policy_version" integer NOT NULL,
	"letter" text NOT NULL,
	"min_score" integer,
	"max_score" integer,
	"grade_point" numeric(3, 2),
	"counts_in_gpa" boolean NOT NULL,
	"counts_in_attempted" boolean NOT NULL,
	"counts_in_earned" boolean NOT NULL,
	"is_passing" boolean NOT NULL,
	"display_order" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_scale_policy_version_letter_pk" PRIMARY KEY("policy_version","letter")
);
--> statement-breakpoint
CREATE TABLE "app"."idempotency_key" (
	"key" text PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."institution_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role_snapshot" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"student_id" uuid,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"request_id" text,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE INDEX "audit_log_student_occurred_idx" ON "audit"."audit_log" USING btree ("student_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit"."audit_log" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_idx" ON "audit"."audit_log" USING btree ("occurred_at");