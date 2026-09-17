# Epic 5 Context: Admin Oversight & Privacy (CAP-7, CAP-8)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic gives the admin the two capabilities only they hold: a single cross-class view of the whole school (every teacher, every student, overall homework completion) so they can spot problems no individual teacher can see, and the human checkpoint that gates any student data from ever being erased. It matters because the admin is deliberately the sole cross-class role in this system — no other role should ever see beyond its own class — and because deletion of a minor's data must never be a silent or automatic action: it requires a recorded, explicit approval step before anything is destroyed. This epic also closes the loop on the admin backup-approval path that Epic 1 built for pending registrations, giving it its intended second use as part of this same oversight surface.

## Stories

- Story 5-1: Admin cross-class oversight & data deletion

## Requirements & Constraints

- The admin dashboard must show aggregate, cross-class figures — all teachers, all students, overall homework completion — and this cross-class visibility must remain exclusive to the admin; no other role gets it under any condition.
- The admin already has a backup-approve capability for any class's pending student registrations (built in Epic 1); this epic's dashboard is where that capability lives, not a rebuild of it.
- A student can submit a data-deletion request from within the app. No deletion may occur without an explicit, recorded admin approval step — deletion is never automatic and never a single click.
- Once approved, all of that student's profile, progress, and homework records must be erased — except the deletion request record itself, which survives as a de-identified accountability trail (who approved it and when), not as a route back to the erased student.
- Minimize personal data collected on minors generally; nothing built here should expand what's collected beyond what deletion review itself requires.
- Must support German/English/Tibetan UI via Paraglide (no inline copy strings) and meet the WCAG 2.2 AA accessibility floor already established for the app.
- GDPR obligations beyond consent-at-registration and admin-approved deletion — data controller identity, retention limits, breach notification — remain an explicitly open gap carried from SPEC.md; this epic does not resolve them, only implements the approval-gated deletion flow itself.

## Technical Decisions

- Cross-class admin reads are authorized the same way every other role-scoped read in this app is: a Postgres RLS policy keyed on `is_admin()`, the existing `SECURITY DEFINER` helper already backing every admin-only policy since Story 1-1 — no new authorization mechanism should be introduced for the dashboard.
- The admin backup-approve path for pending registrations already exists end-to-end (`/requests`, shared with the teacher queue, scoped to every class for the admin) — this epic surfaces/links it from the admin dashboard rather than building a parallel approval screen.
- Deletion follows the function-sidecar lane, not the direct lane: a student's deletion *request* is a direct-lane insert (client-writable, RLS-gated), but the actual erasure cascade is written only by a DB trigger firing on the admin's approval write — never a client-invoked function — so it fires unconditionally and can't be skipped by a buggy or tampered client.
- The `deletion_requests` row is the one explicit exception to "all records gone": once the cascade completes, its `student_id` reference is replaced with a non-identifying placeholder, while `admin_id`/`requested_at`/`approved_at` remain — an audit trail that an approved deletion happened, without it becoming a route back to who the student was. Every other table tied to that student is a hard delete.
- No `deletion_requests` table or deletion-cascade trigger exists yet in any migration (`supabase/migrations/0001`–`0009` cover accounts, registration, roster, homework, streaks, badges, leaderboard) — this is new schema, not an extension of existing tables.
- No admin dashboard route exists yet either (`src/routes/admin/` currently has `classes/`, `teachers/`, `teams/`, plus the shared `+layout.server.ts` admin gate — no `+page.server.ts`/`+page.svelte` at `/admin` itself). Building the stat-tile dashboard and wiring the deletion-review UI is this story's own scope, not a retrofit of something already live.
- Conventions carried over unchanged: `snake_case` DB tables/columns, kebab-case routes, `PascalCase` Svelte components, UUID PKs, `timestamptz` UTC timestamps, ISO 8601 dates, admin-tunable values live in `app_settings` rather than as hardcoded constants, all authorization enforced by RLS (frontend gates are UX-only, never the real barrier).

## UX & Interaction Patterns

- An admin dashboard concept already exists in the design docs (stat tiles for classes / teachers / assignments / pending / students, with entry points into Manage Classes / Manage Teachers / Review Requests) — this story is what actually builds it; a zero-value tile should render de-emphasized rather than hidden, per the existing stat-tile convention, so an empty count still reads as legitimate rather than broken.
- Attention Amber marks "waiting on a person" (e.g. an outstanding-approvals count) and is not to be reused for destructive-action confirmation.
- Deletion approval is the app's first genuinely destructive, irreversible action — no existing screen demonstrates a destructive-button or confirmation-dialog pattern yet (Error Red today is used only for field-validation; the existing approve/reject queue is deliberately frictionless with no confirmation step at all, which is the wrong precedent to copy here). This is a real, unresolved design decision, not something to invent silently: flag it rather than reusing the approve/reject queue's immediate-action pattern.
- The existing "attention banner" pattern (a full-bleed amber block explaining an irreversible or one-time operation, used today for the admin-bootstrap explainer) is a plausible precedent to extend for the deletion-approval step, but this has not been confirmed by any design doc for this specific flow.

## Cross-Story Dependencies

- Depends on Epic 1's `profiles`/`class_teachers` identity model and `is_admin()` helper for both the cross-class dashboard reads and the deletion-request RLS.
- Reuses, rather than duplicates, Epic 1's approval-queue mechanism (`/requests`) for the admin's backup-approve capability — this epic surfaces it, it doesn't rebuild it.
- The aggregate homework-completion figure on the dashboard depends on Epic 3's `homework_status_history` (Done/Reviewed state) and, if scoped per-class, Epic 2's roster data — neither epic implements this aggregate itself.
- The deletion cascade must account for every table introduced by Epics 1–4 that references a student (`profiles`, `attendance_records`, `skill_status_history`, `homework_status_history`, `student_streaks`, `badges_earned`, `team_members`/`team_id`) — this story is the first to need a complete map of student-referencing tables across the whole schema.
