# Backup and Restore Runbook

## Current state — read this first

**There is currently no backup of any kind for this system's data.** Per `DECISIONS.md` DEV-09, the
project owner chose to launch on the existing free-tier Supabase project with no backup configuration and
no restore rehearsal, deferring the upgrade to a later phase. This is a real, accepted operational risk, not
a documentation gap:

> Until this is revisited, there is no recovery path from data loss, corruption, or accidental deletion of
> any student record, grade, or GPA in production. A dropped table, a bad migration, a compromised
> credential, or a Supabase incident is unrecoverable.

The plan's own Stage 11 Go-Live gate (G11) requires "a restore from backup has been performed and verified"
as a hard acceptance criterion. **That criterion is not met.** Do not describe this system as fully
production-ready, or as having passed Go-Live in the plan's sense, until the steps below have actually been
carried out — not merely configured, but tested with a real restore.

## When the Supabase subscription is upgraded: what to actually do

1. **Upgrade the Supabase project to a paid tier that includes Point-in-Time Recovery (PITR)** — this is
   DEC-31's own stated requirement ("must include point-in-time recovery; no free tier in prod"). Confirm in
   the Supabase dashboard under Database → Backups that PITR is active and the retention window meets the
   College's actual risk tolerance (the longer the window, the further back you can recover from a mistake
   that isn't noticed immediately).
2. **Confirm automatic daily backups are running** (Supabase dashboard → Database → Backups). Note the
   backup schedule and retention period somewhere the whole team can see it — this document is a reasonable
   place to record it once known.
3. **Separate the environments** — DEV-01 flagged this as a prerequisite for real production data:
   provision a genuinely separate Supabase project for production, distinct from the development project
   used to build this system. Never let synthetic/test data and real academic records coexist in the same
   project.

## Rehearsing a restore (do this before trusting the backup, and periodically after)

This is the step the plan treats as non-negotiable: *"Backup discovered not to work at the moment it is
needed — mitigated by rehearsing the restore before go-live, which is a gate condition, not a
recommendation."*

1. In the Supabase dashboard, use the point-in-time recovery or backup-restore feature to restore the
   production project's backup **into a new, scratch Supabase project** — never restore over the live
   project to test this.
2. Once the scratch project is up, point a local checkout's `DATABASE_URL` at it temporarily and run:
   ```bash
   npm run db:reconcile
   ```
   Expect all three checks (I-15 summaries-match-engine, I-16 repeat-resolution-coherence, I-05
   published-grades-have-records) to report zero mismatches, exactly as they would against the live project.
3. **Compare record counts** between the live project and the restored scratch project for at least:
   `app.student`, `app.academic_record`, `app.grade_record`, `audit.audit_log`. They should match as of the
   backup's timestamp.
4. **Spot-check a sample of CGPAs**: pick 3-5 students, compare `app.student_cumulative_summary.cgpa` in the
   restored copy against the live project. They should be identical (or explainably different only by
   activity that happened after the backup's timestamp).
5. Tear down the scratch project once verified. Record the date this rehearsal was performed and by whom —
   in this document, or wherever the College keeps operational records.

**Until step 2-4 above have actually been performed once, successfully, do not consider the backup
"working" — a backup that has never been restored is a hope, not a control.**

## If data loss actually happens before backups are configured

There is no recovery path. The only mitigations available right now:
- The append-only audit log (`audit.audit_log`) may let you manually reconstruct *what happened*, even if
  it can't restore the data itself — it cannot be altered or deleted, and every grade/record change is
  captured there with old/new values.
- `npm run db:reconcile` can tell you whether summaries are internally consistent with what remains, but
  cannot recover anything that was actually deleted.
- Contact Supabase support — some incidents (their own infrastructure fault) may be recoverable on their
  end even without your own backup configured, but this is not something to rely on.

This section should become unnecessary once the steps above are completed. Update this runbook, and
`DECISIONS.md` DEV-09/DEC-31, the day a real, rehearsed restore succeeds.
