CREATE TABLE "app"."student" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_number" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"department_id" uuid NOT NULL,
	"enrolment_year" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"contact_phone" text,
	"historical_import_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"import_completed_by" uuid,
	"import_completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_status_valid" CHECK ("app"."student"."status" IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'GRADUATED', 'ADMISSION_FORFEITED')),
	CONSTRAINT "student_import_status_valid" CHECK ("app"."student"."historical_import_status" IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE'))
);
--> statement-breakpoint
ALTER TABLE "app"."student" ADD CONSTRAINT "student_id_app_user_id_fk" FOREIGN KEY ("id") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."student" ADD CONSTRAINT "student_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "app"."department"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_department_idx" ON "app"."student" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "student_status_idx" ON "app"."student" USING btree ("status");