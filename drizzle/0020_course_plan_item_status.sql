-- DEV-19: per-course Admin decisions on a submitted plan (Section 9.4.9 /
-- 14.2 extension) -- "one bad planned course shouldn't force rejecting the
-- entire plan." Adds a status per course_plan_item and a new
-- PARTIALLY_APPROVED terminal plan status for when the per-item decisions
-- come out mixed.

ALTER TABLE "app"."course_plan_item"
  ADD COLUMN "status" text DEFAULT 'PENDING' NOT NULL,
  ADD COLUMN "rejection_reason" text,
  ADD COLUMN "decided_by" uuid,
  ADD COLUMN "decided_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "app"."course_plan_item"
  ADD CONSTRAINT "course_plan_item_status_valid" CHECK ("app"."course_plan_item"."status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD CONSTRAINT "course_plan_item_rejection_reason_required" CHECK ("app"."course_plan_item"."status" != 'REJECTED' OR "app"."course_plan_item"."rejection_reason" IS NOT NULL);
--> statement-breakpoint

ALTER TABLE "app"."course_plan_item"
  ADD CONSTRAINT "course_plan_item_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- Backfill: a plan already resolved as a whole (Stage 9's original
-- bulk-only approve/reject) had every item decided together -- reflect
-- that as if each item had been decided individually, so existing
-- APPROVED/REJECTED plans read consistently under the new per-item model.
UPDATE "app"."course_plan_item" i
SET "status" = 'APPROVED', "decided_by" = p."reviewed_by", "decided_at" = p."reviewed_at"
FROM "app"."course_plan" p
WHERE i."plan_id" = p."id" AND p."status" = 'APPROVED';
--> statement-breakpoint

UPDATE "app"."course_plan_item" i
SET "status" = 'REJECTED', "rejection_reason" = p."rejection_reason", "decided_by" = p."reviewed_by", "decided_at" = p."reviewed_at"
FROM "app"."course_plan" p
WHERE i."plan_id" = p."id" AND p."status" = 'REJECTED';
--> statement-breakpoint

ALTER TABLE "app"."course_plan" DROP CONSTRAINT "course_plan_status_valid";
--> statement-breakpoint
ALTER TABLE "app"."course_plan" ADD CONSTRAINT "course_plan_status_valid" CHECK ("app"."course_plan"."status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED'));
