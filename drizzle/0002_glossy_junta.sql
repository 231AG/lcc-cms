CREATE TABLE "app"."app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"login_identifier" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."permission" (
	"role" text NOT NULL,
	"action" text NOT NULL,
	"allowed" boolean NOT NULL,
	"note" text,
	CONSTRAINT "permission_role_action_pk" PRIMARY KEY("role","action")
);
--> statement-breakpoint
CREATE INDEX "app_user_login_identifier_idx" ON "app"."app_user" USING btree ("login_identifier");