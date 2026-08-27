CREATE TABLE "app"."course_offering" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"semester_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"section" text NOT NULL,
	"instructor_name" text,
	"capacity" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"frozen_credit_hours" integer NOT NULL,
	CONSTRAINT "course_offering_status_valid" CHECK ("app"."course_offering"."status" IN ('DRAFT', 'PUBLISHED', 'CANCELLED')),
	CONSTRAINT "course_offering_capacity_positive" CHECK ("app"."course_offering"."capacity" IS NULL OR "app"."course_offering"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."offering_meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offering_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"room" text,
	CONSTRAINT "offering_meeting_day_valid" CHECK ("app"."offering_meeting"."day_of_week" BETWEEN 1 AND 7),
	CONSTRAINT "offering_meeting_end_after_start" CHECK ("app"."offering_meeting"."end_time" > "app"."offering_meeting"."start_time")
);
--> statement-breakpoint
ALTER TABLE "app"."course_offering" ADD CONSTRAINT "course_offering_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "app"."semester"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."course_offering" ADD CONSTRAINT "course_offering_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "app"."course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."offering_meeting" ADD CONSTRAINT "offering_meeting_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "app"."course_offering"("id") ON DELETE restrict ON UPDATE no action;