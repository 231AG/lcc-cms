CREATE TABLE "app"."student_cumulative_summary" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"cgpa" numeric(7, 6),
	"total_credits_attempted" numeric(6, 1) NOT NULL,
	"total_credits_earned" numeric(6, 1) NOT NULL,
	"is_provisional" boolean NOT NULL,
	"policy_version" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."student_semester_summary" (
	"student_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"gpa" numeric(7, 6),
	"credits_attempted" numeric(6, 1) NOT NULL,
	"credits_earned" numeric(6, 1) NOT NULL,
	"is_provisional" boolean NOT NULL,
	"policy_version" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_semester_summary_student_id_semester_id_pk" PRIMARY KEY("student_id","semester_id")
);
--> statement-breakpoint
ALTER TABLE "app"."student_cumulative_summary" ADD CONSTRAINT "student_cumulative_summary_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."student_semester_summary" ADD CONSTRAINT "student_semester_summary_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."student_semester_summary" ADD CONSTRAINT "student_semester_summary_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "app"."semester"("id") ON DELETE restrict ON UPDATE no action;