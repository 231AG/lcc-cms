CREATE TABLE "app"."academic_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"course_id" uuid,
	"course_code_snapshot" text NOT NULL,
	"course_title_snapshot" text NOT NULL,
	"credit_hours" numeric(4, 1) NOT NULL,
	"letter" text NOT NULL,
	"grade_point" numeric(3, 2),
	"score" integer,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"origin" text DEFAULT 'IMPORTED' NOT NULL,
	"grade_record_id" uuid,
	"counts_in_gpa" boolean NOT NULL,
	"counts_in_attempted" boolean NOT NULL,
	"counts_in_earned" boolean NOT NULL,
	"is_repeat_dropped" boolean DEFAULT false NOT NULL,
	"was_major_at_record" boolean DEFAULT false NOT NULL,
	"entered_by" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_note" text,
	"is_void" boolean DEFAULT false NOT NULL,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	CONSTRAINT "academic_record_credit_hours_positive" CHECK ("app"."academic_record"."credit_hours" > 0),
	CONSTRAINT "academic_record_grade_point_range" CHECK ("app"."academic_record"."grade_point" IS NULL OR ("app"."academic_record"."grade_point" BETWEEN 0.0 AND 4.0)),
	CONSTRAINT "academic_record_origin_valid" CHECK ("app"."academic_record"."origin" IN ('SYSTEM', 'IMPORTED')),
	CONSTRAINT "academic_record_origin_grade_record_coherence" CHECK (("app"."academic_record"."origin" = 'IMPORTED' AND "app"."academic_record"."grade_record_id" IS NULL) OR ("app"."academic_record"."origin" = 'SYSTEM' AND "app"."academic_record"."grade_record_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "app"."academic_record" ADD CONSTRAINT "academic_record_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."academic_record" ADD CONSTRAINT "academic_record_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "app"."semester"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."academic_record" ADD CONSTRAINT "academic_record_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "app"."course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."academic_record" ADD CONSTRAINT "academic_record_entered_by_app_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."academic_record" ADD CONSTRAINT "academic_record_voided_by_app_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;