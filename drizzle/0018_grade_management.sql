CREATE TABLE "app"."grade_correction_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grade_record_id" uuid NOT NULL,
	"old_score" numeric(4, 1),
	"old_letter" text NOT NULL,
	"old_grade_point" numeric(3, 2),
	"new_score" numeric(4, 1),
	"new_letter" text NOT NULL,
	"new_grade_point" numeric(3, 2),
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "grade_correction_status_valid" CHECK ("app"."grade_correction_request"."status" IN ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "grade_correction_segregation_of_duties" CHECK ("app"."grade_correction_request"."decided_by" IS NULL OR "app"."grade_correction_request"."decided_by" != "app"."grade_correction_request"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "app"."grade_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"submission_id" uuid,
	"score" numeric(4, 1),
	"letter" text NOT NULL,
	"grade_point" numeric(3, 2),
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"entered_by" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"published_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "grade_record_status_valid" CHECK ("app"."grade_record"."status" IN ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'LOCKED')),
	CONSTRAINT "grade_record_score_range" CHECK ("app"."grade_record"."score" IS NULL OR ("app"."grade_record"."score" >= 0 AND "app"."grade_record"."score" <= 100)),
	CONSTRAINT "grade_record_segregation_of_duties" CHECK ("app"."grade_record"."decided_by" IS NULL OR "app"."grade_record"."decided_by" != "app"."grade_record"."entered_by")
);
--> statement-breakpoint
CREATE TABLE "app"."grade_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offering_id" uuid NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grade_count" integer NOT NULL,
	"undecided_count" integer NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "grade_submission_status_valid" CHECK ("app"."grade_submission"."status" IN ('SUBMITTED', 'PARTIALLY_DECIDED', 'CLOSED')),
	CONSTRAINT "grade_submission_segregation_of_duties" CHECK ("app"."grade_submission"."reviewed_by" IS NULL OR "app"."grade_submission"."reviewed_by" != "app"."grade_submission"."submitted_by")
);
--> statement-breakpoint
ALTER TABLE "app"."grade_correction_request" ADD CONSTRAINT "grade_correction_request_grade_record_id_grade_record_id_fk" FOREIGN KEY ("grade_record_id") REFERENCES "app"."grade_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_correction_request" ADD CONSTRAINT "grade_correction_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_correction_request" ADD CONSTRAINT "grade_correction_request_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_record" ADD CONSTRAINT "grade_record_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "app"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_record" ADD CONSTRAINT "grade_record_submission_id_grade_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."grade_submission"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_record" ADD CONSTRAINT "grade_record_entered_by_app_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_record" ADD CONSTRAINT "grade_record_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_submission" ADD CONSTRAINT "grade_submission_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "app"."course_offering"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_submission" ADD CONSTRAINT "grade_submission_submitted_by_app_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."grade_submission" ADD CONSTRAINT "grade_submission_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."academic_record" ADD CONSTRAINT "academic_record_grade_record_id_grade_record_id_fk" FOREIGN KEY ("grade_record_id") REFERENCES "app"."grade_record"("id") ON DELETE restrict ON UPDATE no action;