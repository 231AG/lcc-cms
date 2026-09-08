-- Semester lifecycle: six states collapse to four.
--
-- Old (REQ-W01):  DRAFT  OPEN  REGISTRATION  IN_PROGRESS  GRADE_SUBMISSION  CLOSED
-- New:            DRAFT  OPEN                IN_PROGRESS                    CLOSED
--
-- The mapping, and why each one:
--
--   DRAFT            -> DRAFT         unchanged.
--   OPEN             -> OPEN          unchanged.
--   REGISTRATION     -> OPEN          the new Open state IS the planning
--                                     window: students build, edit and
--                                     submit course plans and Admins
--                                     approve them into registrations,
--                                     which is exactly and only what
--                                     REGISTRATION gated.
--   IN_PROGRESS      -> IN_PROGRESS   unchanged.
--   GRADE_SUBMISSION -> IN_PROGRESS   the new In Progress state is where
--                                     Admins enter and edit draft grades
--                                     and submit them for approval, which
--                                     is exactly and only what
--                                     GRADE_SUBMISSION gated. Folding it
--                                     forward rather than into CLOSED
--                                     matters: a semester mid-grade-entry
--                                     stays editable instead of being
--                                     sealed under everyone.
--   CLOSED           -> CLOSED        unchanged.
--
-- Nothing is lost by either merge -- no capability existed in REGISTRATION
-- that OPEN now lacks, and none in GRADE_SUBMISSION that IN_PROGRESS now
-- lacks. Every state change ever made is still in audit.audit_log under
-- SEMESTER_STATE_CHANGED with its original six-state old/new values; this
-- migration does not rewrite that history, so a semester's real path
-- through the old model stays readable afterwards.
--
-- Order matters below: the rows have to be legal under the new CHECK before
-- the new CHECK exists, so the constraint is dropped first, then the data is
-- moved, then the narrower constraint goes back on. Wrapped in the migrator's
-- own transaction, so a failure at any step leaves the six-state model intact.

ALTER TABLE "app"."semester"
  DROP CONSTRAINT IF EXISTS "semester_state_valid";
--> statement-breakpoint

UPDATE "app"."semester" SET "state" = 'OPEN' WHERE "state" = 'REGISTRATION';
--> statement-breakpoint

UPDATE "app"."semester" SET "state" = 'IN_PROGRESS' WHERE "state" = 'GRADE_SUBMISSION';
--> statement-breakpoint

ALTER TABLE "app"."semester"
  ADD CONSTRAINT "semester_state_valid"
  CHECK ("state" IN ('DRAFT', 'OPEN', 'IN_PROGRESS', 'CLOSED'));
--> statement-breakpoint

-- A consequence worth stating rather than discovering: the old model allowed
-- at most one semester in REGISTRATION and at most one in GRADE_SUBMISSION
-- (DEC-34), enforced in the service layer at transition time, never by a
-- constraint. If a semester was in OPEN while another was in REGISTRATION,
-- both are now OPEN -- which is legal data the guard would not have let you
-- create. That is deliberate: the guard still applies to every NEW
-- transition (see assertGuardConditions in src/lib/academic/calendar.ts), so
-- no third semester can join them, but existing rows are not forced through
-- a state change they never asked for. There is no unique index here for the
-- same reason.
