CREATE TABLE "app"."academic_year" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."semester" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	CONSTRAINT "semester_state_valid" CHECK ("app"."semester"."state" IN ('DRAFT', 'OPEN', 'REGISTRATION', 'IN_PROGRESS', 'GRADE_SUBMISSION', 'CLOSED'))
);
--> statement-breakpoint
ALTER TABLE "app"."semester" ADD CONSTRAINT "semester_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "app"."academic_year"("id") ON DELETE restrict ON UPDATE no action;