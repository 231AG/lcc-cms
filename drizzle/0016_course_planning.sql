CREATE TABLE "app"."course_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"total_credits" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "course_plan_status_valid" CHECK ("app"."course_plan"."status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
	CONSTRAINT "course_plan_rejection_reason_required" CHECK ("app"."course_plan"."status" != 'REJECTED' OR "app"."course_plan"."rejection_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."course_plan_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"is_retake" boolean DEFAULT false NOT NULL,
	"prereq_override_reason" text,
	"prereq_override_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"plan_item_id" uuid,
	"source" text NOT NULL,
	"is_retake" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'REGISTERED' NOT NULL,
	"dropped_reason" text,
	"frozen_credit_hours" integer NOT NULL,
	CONSTRAINT "registration_source_valid" CHECK ("app"."registration"."source" IN ('PLAN_APPROVAL', 'ADMIN_DIRECT')),
	CONSTRAINT "registration_status_valid" CHECK ("app"."registration"."status" IN ('REGISTERED', 'DROPPED')),
	CONSTRAINT "registration_dropped_reason_required" CHECK ("app"."registration"."status" != 'DROPPED' OR "app"."registration"."dropped_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "app"."course_plan" ADD CONSTRAINT "course_plan_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_plan" ADD CONSTRAINT "course_plan_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "app"."semester"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_plan" ADD CONSTRAINT "course_plan_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_plan_item" ADD CONSTRAINT "course_plan_item_plan_id_course_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "app"."course_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_plan_item" ADD CONSTRAINT "course_plan_item_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "app"."course_offering"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_plan_item" ADD CONSTRAINT "course_plan_item_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "app"."course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_plan_item" ADD CONSTRAINT "course_plan_item_prereq_override_by_app_user_id_fk" FOREIGN KEY ("prereq_override_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."registration" ADD CONSTRAINT "registration_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."registration" ADD CONSTRAINT "registration_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "app"."course_offering"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."registration" ADD CONSTRAINT "registration_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "app"."semester"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."registration" ADD CONSTRAINT "registration_plan_item_id_course_plan_item_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "app"."course_plan_item"("id") ON DELETE restrict ON UPDATE no action;