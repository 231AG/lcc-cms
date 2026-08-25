CREATE TABLE "app"."college" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"credit_hours" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"prerequisite_min_grade" numeric(3, 2),
	CONSTRAINT "course_credit_hours_positive" CHECK ("app"."course"."credit_hours" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."course_prerequisite" (
	"course_id" uuid NOT NULL,
	"prerequisite_course_id" uuid NOT NULL,
	"min_grade" numeric(3, 2),
	CONSTRAINT "course_prerequisite_course_id_prerequisite_course_id_pk" PRIMARY KEY("course_id","prerequisite_course_id"),
	CONSTRAINT "course_prerequisite_no_self_reference" CHECK ("app"."course_prerequisite"."course_id" != "app"."course_prerequisite"."prerequisite_course_id")
);
--> statement-breakpoint
CREATE TABLE "app"."department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"college_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"max_credits_override" integer
);
--> statement-breakpoint
ALTER TABLE "app"."course" ADD CONSTRAINT "course_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "app"."department"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_prerequisite" ADD CONSTRAINT "course_prerequisite_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "app"."course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_prerequisite" ADD CONSTRAINT "course_prerequisite_prerequisite_course_id_course_id_fk" FOREIGN KEY ("prerequisite_course_id") REFERENCES "app"."course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."department" ADD CONSTRAINT "department_college_id_college_id_fk" FOREIGN KEY ("college_id") REFERENCES "app"."college"("id") ON DELETE restrict ON UPDATE no action;