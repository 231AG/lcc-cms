# Grading Rules as Implemented — For Registrar Review

**Purpose of this document:** This is a plain-language description of exactly how the e-portal
calculates grades, GPA, CGPA, and related figures. It is not a summary — every rule below is what
the software actually does, verified by 47 automated test cases before this document was written.
Please read it against the College's own grading policy and confirm, in writing, that it matches.
That confirmation is a required step before this part of the system goes into real use (Stage 7
gate G7 in the development plan) — there is no discretionary way around it.

If anything below doesn't match College policy, tell the developer before signing off. A wrong rule
here is much cheaper to fix now than after real student CGPAs have been calculated with it.

---

## 1. The grading scale

| Letter | Score range | Grade point | Passes? |
|---|---|---|---|
| A+ | 95–100 | 4.00 | Yes |
| A- | 90–94 | 3.70 | Yes |
| B+ | 85–89 | 3.30 | Yes |
| B- | 80–84 | 2.70 | Yes |
| C+ | 75–79 | 2.30 | Yes |
| C- | 70–74 | 1.70 | Yes |
| D+ | 65–69 | 1.30 | Yes |
| D- | 60–64 | 0.70 | Yes |
| F | 0–59 | 0.00 | No |
| I (Incomplete) | — | not counted | No |

**D- (0.70) is the minimum passing grade.** There is no Withdrawal, Audit, or Transfer-credit grade
anywhere in this system — those are not used at this College and cannot be entered.

## 2. Turning a numeric score into a letter grade

A score is entered with one decimal place (e.g. 87.5) and kept exactly as entered on the permanent
record. To decide which letter it earns, the score is rounded to the nearest whole number first —
**and rounded up on an exact half**, not down. So:

- 94.4 rounds to 94 → A-
- 94.5 rounds to 95 → **A+** (the half-point rounds up, not down)
- 59.4 rounds to 59 → F
- 59.5 rounds to 60 → **D-, a pass** — this is the single most consequential rounding rule in the
  system, since it's the one that turns a fail into a pass.

The original entered score (87.5, not 88) is what stays on the permanent record. Only the rounded
value is used to pick the letter.

## 3. Semester GPA

Add up (grade point × credit hours) for every course in the semester, then divide by the total
credit hours attempted. An Incomplete (I) doesn't enter this calculation at all — it's simply left
out, both from the top and bottom of the division.

A failed course (F) **does** enter the calculation — it counts as 0 grade points, which pulls the
average down, exactly as it should. It also counts toward credits attempted but not credits earned.

If a student took no gradeable courses in a semester (everything was an Incomplete, for instance),
the semester GPA is shown as **not available**, not as 0.000 — those are different things: 0.000
means "attempted courses and failed them all," not available means "nothing to calculate."

## 4. Cumulative GPA (CGPA)

The CGPA works the same way as semester GPA, but across the student's whole academic history —
**with one important difference explained in the next section: retaken courses**.

## 5. Retaking a course

If a student takes the same course more than once, **only the most recent attempt counts toward
the CGPA.** The earlier attempt(s) are kept on the permanent record (marked with an "R") but
excluded from the cumulative GPA calculation.

**This means: if a student retakes a course and does worse the second time, their CGPA goes down,**
not up. This is a deliberate policy — "most recent" rather than "best" — carried forward from the
College's existing grading policy. If the College actually intends "best attempt counts," this is
the single most important thing to flag, because it would change the CGPA of every student who has
ever retaken a course.

One nuance worth knowing about: the **earlier, dropped attempt still counts in that specific
semester's own GPA.** A semester's GPA is a historical fact about that term and doesn't get rewritten
years later because of something that happened afterward — a printed grade report from three years
ago must always match what the system shows today. The dropped attempt is excluded only from the
cumulative figure, not from the semester it actually happened in.

The credit hours for a retaken course are **only counted once** toward the 132 needed to graduate,
no matter how many times it was attempted.

## 6. Mandatory repeats

Some grades create an obligation for the student to retake the course, even though they may have
already earned credit for it:

| Grade | In the student's own department | In any other department |
|---|---|---|
| F | Must retake | Must retake |
| D+ or D- | Must retake | Optional — grade stands |
| C- or better | No obligation | No obligation |

"The student's own department" is determined by which department they were enrolled in **at the
time the grade was recorded** — if they later change departments, that doesn't create or remove
this obligation retroactively.

This is advisory, not a hard block: it shows up on the student's own record and on the Admin's view
of the student, and the Admin sees a warning if they approve a course plan that doesn't address an
outstanding repeat — but the Admin can approve it anyway if there's a good reason, and that decision
is recorded.

## 7. Incomplete (I) grades

An Incomplete is a real, visible grade — it shows up on the grade sheet and would appear on a
transcript, not hidden. It carries no weight in any calculation (not GPA, not credits attempted,
not credits earned) until it's resolved to a real letter grade.

**An Incomplete must be resolved within one semester** of when it was given. The deadline is shown
next to the grade (e.g., "must be resolved by end of Second Semester 2026/2027").

**Nothing happens automatically when the deadline passes.** The system produces a list of overdue
Incompletes at semester close for a human to review — it never invents a failing grade on its own.
If the real grade never arrives, an Admin can request converting it to F, which requires a second
person's (Super Admin's) approval — the same two-person check as any other change to an already
recorded grade.

## 8. Academic standing

| Standing | CGPA |
|---|---|
| Honours | 3.500 and above |
| Good standing | 2.000 up to 3.499 |
| Probation | Below 2.000 |

**Worth knowing:** because the passing grade is D- (0.70) rather than the more common 1.00 or 2.00,
a student who passes every single course at the minimum D- average has a CGPA of 0.700 — which
lands them on Probation despite not having failed anything. This was flagged to the College when the
2.00/3.50 thresholds were chosen, and the conventional thresholds were selected anyway — so this is
intentional, not a bug. Flagging it again here in case it's worth a second look.

Standing is **never shown at all** for a student whose record is still incomplete (see the next
section) — not as "Probation," not as "Unknown," but genuinely absent, with a note that it isn't
available yet. Showing a standing label on an incomplete record would be more misleading than
showing nothing.

## 9. "Provisional" figures — why some numbers carry a warning badge

The College's historical academic records are being entered into this system gradually, after
go-live, student by student, semester by semester — not all at once. Until a given student's full
history has been entered and marked complete by the Admin office, **every GPA, CGPA, and credit
figure for that student is marked "provisional"** — meaning it's accurate for what's been entered
so far, but may not be the whole picture yet.

This applies everywhere a figure appears: the student's own view, the Admin's view, and even the
"credits remaining to graduate" number — which is the one most likely to be mistaken for a real
graduation clearance if it weren't flagged.

Once the Admin office finishes entering a student's history and marks it complete, every badge for
that student disappears — all at once, in the same action.

## 10. Numbers are always exact — no rounding surprises

GPA and CGPA are calculated using exact decimal arithmetic (not the kind of computer math that can
produce "2.9999999999997" instead of "3.000") and are always shown to exactly three decimal places,
even when the real answer is a round number (e.g. "4.000", never just "4").

---

## Sign-off

This document describes the grading rules exactly as implemented in the e-portal, verified against
47 specific test scenarios covering the scale, rounding, repeats, Incompletes, and academic standing
boundaries described above.

**Registrar confirmation:**

I confirm the rules described in this document match Liberia Christian College's grading policy.

Name: _______________________________ Date: _______________

Signature: _______________________________
