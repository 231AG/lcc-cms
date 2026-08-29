# Administrator Manual — LCC E-Portal

For Admin and Super Admin staff. If you're setting up local development, see `SETUP.md` instead — this
document is about using the running system, not building it.

**Before you use this in a real semester:** the system currently has no working backup — see
`docs/BACKUP_RESTORE_RUNBOOK.md`. Treat it as a working pilot, not a fully protected production system,
until that document says otherwise.

## Roles, in one paragraph

**Admin** runs the day-to-day academic office: enrolling students, entering historical records, setting up
the calendar and course catalogue, scheduling classes, reviewing course plans, and entering grades. **Super
Admin** is the second key on the highest-risk actions: approving grade submissions, deciding grade
corrections, moving a semester backward, and managing Admin accounts. The system will not let one person
hold both roles' powers on a single grade — that separation is enforced by the database itself, not just by
policy, so it holds even if someone tries to work around it.

## Getting your account

Your first account is created by whoever holds the other role (a Super Admin creates Admin accounts; the
bootstrap procedure creates the first Super Admin — see `SETUP.md`/`docs/DEPLOYMENT_RUNBOOK.md`). You'll be
given a temporary password in person or on paper — there is no email or SMS in this system. The first thing
you'll be asked to do, before anything else works, is set a real password. This can't be skipped or worked
around by typing a different URL.

## Admin workflows

- **Academic structure** (`/admin/structure`): colleges, departments, courses, prerequisites. Deactivating
  something checks for dependents first and tells you exactly what's blocking it.
- **Academic calendar** (`/admin/calendar`): academic years and semesters, and moving a semester forward
  through its six states (Draft → Open → Registration → In Progress → Grade Submission → Closed). Moving
  backward is Super Admin-only and always needs a reason.
- **Students** (`/admin/students`): enrolling a new student, searching, resetting a password.
- **Historical import** (`/admin/historical`, progress at `/admin/historical/progress`): entering a
  student's past academic record from paper, one semester at a time. The progress page shows counts by
  status, a breakdown by department and cohort, records entered per week (a flat line means the import has
  stalled), and any flagged issues (a course code that doesn't match the catalogue) with a direct link to
  fix them.
- **Course offerings** (`/admin/offerings`): sections, instructors, meeting times, publishing a class so
  students can plan around it.
- **Course plan review** (`/admin/planning`): approving, rejecting (with a reason), or overriding a failed
  prerequisite check on a student's course plan.
- **Registrations** (`/admin/registrations`): registering or dropping a student directly, with a reason —
  the exception path, not the normal one (normal registration comes from an approved plan).
- **Class grade entry** (`/admin/grades`): pick a semester in Grade Submission state, pick a class, enter
  scores (the letter and grade point preview live as you type), save as a draft, then submit for approval.
  You cannot approve your own submission — that's not a permission you're given, not a button that's
  hidden.
- **Grade corrections** (`/admin/grade-corrections`): requesting a correction to an already-published grade.
  A different Super Admin has to decide it; if the grade changed since you requested it, your request is
  automatically rejected as stale rather than silently applied to the wrong value.
- **Semester-end export** (`/admin/export`): a plain CSV of a semester's academic data, openable in any
  spreadsheet program. Every download is logged. If some students in that semester still have no published
  grade, you'll see a warning before you download.
- **Grading policy** (`/grading-policy`): read-only view of the active grade scale and institution
  settings — useful for checking what a letter grade converts to, or what the current credit ceiling is.

## Super Admin workflows

- **Admin accounts** (`/admin/accounts`): creating and disabling Admin accounts. The system will refuse to
  disable the last active Super Admin — there must always be at least one.
- **Grade submission review** (`/admin/grade-review`): approving or rejecting a class's submitted grades,
  as a batch or individually. Rejecting returns that grade to draft with your reason attached, visible to
  the Admin who entered it.
- **Grade corrections** (`/admin/grade-corrections`): deciding a pending correction request from an Admin.
- **Audit log** (`/admin/audit`): every significant action in the system, filterable by student, action
  type, entity, or date. Actions from a single batch operation (e.g. approving 40 grades at once) are
  grouped together. Viewing this page is itself logged.
- **Backward semester transitions**: from `/admin/calendar`, moving a semester back a state (e.g. reopening
  a Closed semester) — always requires a reason, always audited.

## What the system will never let anyone do

- A Student see another student's record, or any grade before it's published.
- An Admin publish, approve, or edit a grade — that action doesn't exist for that role.
- A Super Admin enter or edit a grade, or touch a historical record — same.
- The same person both submit and approve one grade, or both request and decide one correction.
- Anyone delete or alter an audit log entry, ever.

If something in the interface looks like it should let you do one of these and doesn't, that's the design
working, not a bug to report.
