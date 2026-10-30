---
name: 'Sherab Architecture Spine'
type: architecture-spine
purpose: build-substrate
altitude: feature
paradigm: 'RLS-Gated Direct-Access BaaS with Function Sidecar'
scope: 'Sherab (Munich Tibetan Sunday School Class Tracker) - v1 plus calendar (CAP-9/10), Parent Role (CAP-11 to CAP-13) and second parent per student (spec-second-parent)'
status: final
created: '2026-09-13'
updated: '2026-10-27'
binds: [CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-7, CAP-8, CAP-9, CAP-10, CAP-11, CAP-12, CAP-13]
sources: ['../../../specs/spec-class-tracker/SPEC.md', '../../prds/prd-tib-class-2026-09-26/prd.md', '../../prds/prd-tib-class-2026-09-26/addendum.md', '../../../specs/spec-second-parent/SPEC.md']
companions: []
---

# Architecture Spine — Sherab Architecture Spine

## Design Paradigm

**RLS-Gated Direct-Access BaaS with Function Sidecar.** The SvelteKit client talks to a single Supabase Postgres project directly via its client SDK — there is no hand-rolled REST/GraphQL layer. Two enforcement lanes:

- **Direct lane** — plain CRUD (attendance marks, homework creation, Done/Reviewed toggles, session leave, registration requests) flows straight from client to Postgres, authorized entirely by Row Level Security policies.
- **Function-sidecar lane** — anything the system *computes or awards* (streaks, badges, leave classification, deletion cascade, calendar sessions) is written only by a **DB trigger** reacting to the underlying write, never by the client directly and never dependent on the client remembering to invoke anything. The exceptions are genuinely time-based jobs with no triggering write — recurring-assignment generation and Sick-leave auto-approval — which run on `pg_cron` (AD-3, AD-8, AD-13). Leaderboard rank is neither: it's a read-time computed view, not stored state at all.

Account operations that must bypass RLS (creating a student's or parent's auth user, promoting a login, minting credentials) run in SvelteKit server actions holding the service-role key — the only server-side code path, and never a general API (AD-1, AD-11).

```mermaid
flowchart LR
  Client["SvelteKit PWA (client)"] -- "direct CRUD, RLS-gated" --> DB[("Postgres\n(Supabase)")]
  Client --> Server["SvelteKit server actions\n(service role: account operations only)"]
  Server -- "Admin API: create / promote / delete users" --> Auth
  DB -- "trigger fires on write\n(unconditional)" --> TRG["DB trigger functions\n(role + parent link on sign-up, streaks, badges,\nleave classification, sessions, deletion cascade)"]
  TRG -- "writes derived state" --> DB
  SCHED["pg_cron jobs (idempotent catch-up)\nrecurring homework, sick auto-approval"] -- "time-based, not client-invoked" --> DB
  Auth["Supabase Auth\n(custom SMTP in production)"] -. "issues JWT, read by every RLS policy" .-> DB
  Client -- "sign in / session" --> Auth
```

## Invariants & Rules

### AD-1 — Stack & access paradigm

- **Binds:** all
- **Prevents:** divergent backend choices per feature; an ad hoc REST layer growing up alongside direct DB access
- **Rule:** All persistence goes through one Supabase Postgres project. Client code talks to Supabase directly via its SDK — no custom REST/GraphQL layer is introduced. SvelteKit serves the frontend as an installable PWA. SvelteKit server actions may use the service-role key only for auth-account operations RLS can't express (AD-4, AD-11), never as a general data layer.

### AD-2 — Authorization enforcement boundary

- **Binds:** CAP-1, CAP-2, CAP-3, CAP-7, CAP-11, CAP-12, CAP-13
- **Prevents:** a feature checking permissions in frontend code, which a tampered client can bypass
- **Rule:** All authorization is enforced by Postgres Row Level Security policies keyed on the authenticated user's identity/role. Frontend code may hide UI for a role but is never the sole barrier to an action.

### AD-3 — Computed/awarded state ownership

- **Binds:** CAP-3 (recurring generation), CAP-4 (streaks), CAP-5 (badges), CAP-8 (deletion cascade), CAP-10 (sessions), CAP-11 (leave classification, sick auto-approval)
- **Prevents:** a tampered or buggy client writing a fabricated computed value (e.g. self-awarding a badge, forging a streak, marking short-notice leave as planned); a client that never calls the "right" function leaving derived state permanently stale; two features computing the streak differently
- **Rule:** Any derived-state write that reacts to a data change (streak recompute, badge award, leave classification, session generation, deletion cascade) is a **DB trigger on the source table's write** — never a client-invoked Edge Function — so it fires unconditionally, regardless of client behavior. Scheduled jobs (`pg_cron`) are reserved for genuinely time-based work with no triggering row-write: recurring-assignment instance generation (AD-8) and Sick-leave auto-approval (AD-13). Derived counts (streak length, badge-milestone crossing) count **distinct `(student_id, homework_instance_id)` pairs that reached Done**, never raw history-row counts. `recompute_student_streak` is the **single** streak path: triggers on `attendance_records`, `homework_status_history`, `session_leave_history`, `sick_leave_decisions`, and `class_sessions` cancellation all call it, and a missed session is protected only by Planned leave or approved Sick leave (SPEC CAP-4).
- Leaderboard rank is explicitly **not** derived/stored state (see Structural Seed) — it is a read-time computed view, so it isn't bound by this AD.

### AD-4 — Identity & role model

- **Binds:** CAP-1, CAP-2, CAP-6, CAP-7, CAP-12, CAP-13
- **Prevents:** a client granting itself a privileged role at sign-up; divergent "who can see this class" or "is this a parent" checks per feature; two features encoding the Teacher/Admin + Parent dual role differently; a route guard that locks out a teacher-parent or lets a pending parent in; a teacher approving or deciding anything about their own child; a routine update reshuffling a student's fixed-for-the-year team
- **Rule:**
  - Supabase Auth is the sole identity provider. `profiles` (PK = auth user id) carries the login's **primary** `role` (`admin`, `teacher`, `student`, or `parent` for a parent-only login). Privileged roles (`admin`, `teacher`, `student`) are set only from `raw_app_meta_data` or the Admin API — **never from client-supplied `raw_user_meta_data`**. Client metadata may carry at most `parent`, and a sign-up with no valid role is refused, never defaulted to `teacher` (existing hole logged as issue #50).
  - **Parent capability is held only by an approved row in `parents`** (PK = auth user id, `pending`/`approved`/`rejected`, approvable only after the email is confirmed) — never inferred from `profiles.role`. A parent-only login is created by a server action. A signed-in teacher or admin requests parent capability by an RLS-guarded insert of their own `pending` row. When the admin creates a teacher whose email already has a parent-only login, that login is promoted, not duplicated. Rejecting a parent deletes the `parents` row and, for a parent-only login, the auth user, so the email can register again. A `parents` row with active links can't be rejected, revoked, or deleted until the admin removes those links (AD-10).
  - Every RLS check resolves through the shared helpers `is_admin()`, `is_teacher_of_class()`, `is_parent()`, `is_parent_of(student_id)` (caller holds an approved `parents` row and an active `student_parents` link to the student, and the student is approved), and `is_parent_in_class(class_id)`, plus `has_link_to(student_id)` for self-decision guards — never a locally invented check. `linked_children()` returns the caller's actively linked pending and approved children (name and status only) for the landing page; rejected children are excluded.
  - RLS evaluates the union of everything a login holds; the role switcher is presentation only. Route guards read one `getCapabilities()` helper (primary role + parent status), never `profiles.role` alone.
  - No approval or decision about a student (registration, Sick leave, deletion, link removal) is accepted from an actor who `has_link_to` that student (an active link, whatever the parent's or student's approval status) — enforced in the policy's `WITH CHECK` or the deciding function. A teacher-parent who is pending, or whose child is still pending, therefore can't decide their own child either.
  - A student's `team_id` may only be set **from `NULL`** through the normal client update path; changing an already-set `team_id` requires an explicit admin-only override path.

### AD-5 — History-as-append

- **Binds:** CAP-2 (skill status), CAP-3 (homework Done/Reviewed transitions), CAP-4 (attendance), CAP-8 (deletion requests), CAP-11 (session leave, sick decisions), CAP-1 (guardian email change requests)
- **Prevents:** two features disagreeing on "current value"; losing the substitute-teacher continuity SPEC.md requires; a client back-dating a leave answer or forging who made a decision
- **Rule:** Skill-status changes, attendance marks, homework status transitions, session-leave answers, Sick-leave decisions, and request rows insert new append-only rows — never update a row in place. "Current" is always the latest row by timestamp for that subject (student + skill area, student + session, …). On every such table a BEFORE INSERT trigger overwrites the actor and time columns (`*_by`, `*_at`) with `auth.uid()` and `now()`; clients never supply them, and every cutoff compares against `now()`.

### AD-6 — Deployment, environments & operations

- **Binds:** all
- **Prevents:** building CI/CD or staging infrastructure disproportionate to a volunteer-run project; parents never receiving their confirmation email; a scheduled job silently skipping work while the project was paused
- **Rule:** The frontend deploys as a static/SSR SvelteKit build to a free-tier static host (e.g. Cloudflare Pages). The backend is the single managed Supabase project — no self-hosted infrastructure. One production environment plus local development against a separate dev Supabase project; a staging environment is deferred. Supabase free-tier projects auto-pause after 7 days with zero activity; this is an accepted quirk, the admin restores the project from the dashboard, and the org inbox that receives Supabase's pause warnings is monitored. Paused projects skip `pg_cron` runs and never replay them, so **every scheduled job is an idempotent catch-up**: it processes everything due, not just what fell due today. Production Auth email (parent confirmation, password reset) goes through **custom SMTP** under the org account with a raised Auth email rate limit; Supabase's built-in sender is for development only.

### AD-7 — Ownership & portability

- **Binds:** NFR ownership constraint
- **Prevents:** hosting, domain, email, or admin access becoming tied to one individual's personal account
- **Rule:** The Supabase project, hosting account, SMTP provider, and domain are created under an organization-owned account (e.g. a dedicated school email/org) — never an individual maintainer's personal account.

### AD-8 — Recurring-instance integrity

- **Binds:** CAP-3
- **Prevents:** a direct client insert creating a duplicate `homework_instances` row for a period the recurrence sidecar already generated
- **Rule:** A `UNIQUE(assignment_id, period_start)` constraint on `homework_instances` rejects duplicates at the database level. RLS additionally restricts direct client inserts into `homework_instances` to assignments where `recurrence_rule IS NULL` (one-off) — instances for a recurring assignment can only be created by the scheduled generation job's trusted connection.

### AD-9 — Deletion audit vs. erasure

- **Binds:** CAP-8
- **Prevents:** "all of that student's records are gone" silently destroying the only record that an approved deletion ever happened; a parent-submitted request taking a different path from a student-submitted one
- **Rule:** One `deletion_requests` queue serves both submitters; each row records `requested_by` (the student, or their parent checked by `is_parent_of`). The cascade is a trigger on the admin's approval of the request. The row survives the cascade but is de-identified — `student_id`, and `requested_by` when it was the student, are replaced with a non-identifying placeholder, while the submitter's role, `admin_id`, `requested_at`, and `approved_at` remain as a minimal accountability trail. This is the one explicit carve-out to "all records gone"; every other student-owned table is a hard delete. The parent's own account is not part of the cascade. SELECT is the student, `is_parent_of(student_id)`, or the admin. The `requested_by = auth.uid()` clause is dropped, so both active parents see a pending request and who made it (AD-12's `actor_display_name`), and a removed parent no longer does; the one-pending-per-student index stays, and the app maps its violation to "already requested". A request survives its requester's link removal.

### AD-10 — Parent↔child link

- **Binds:** CAP-1, CAP-12, CAP-13, spec-second-parent
- **Prevents:** a live email-text match drifting on case/whitespace or a guardian-email typo; RLS policies matching emails; checks that OR across two parent columns; a third parent from two accepts racing; a student left with no parent; a re-invite undoing an admin's removal; deleting a parent account wiping children
- **Rule:**
  - Links live in `student_parents` (`student_id`, `parent_id`, `slot` 1 or 2, `invited_by`, `linked_at`, `removed_by`, `removed_at`). Partial `UNIQUE(student_id, slot)` and `UNIQUE(student_id, parent_id)` where `removed_at is null` make a third active link impossible, whatever the concurrency. Removed rows are kept. Every parent check reads active links through AD-4's helpers; RLS never matches on email text.
  - `student_parents.student_id` cascades on student deletion. `student_parents.parent_id` references `profiles(id)` with `ON DELETE RESTRICT`, and `invited_by` and `removed_by` are `ON DELETE SET NULL`. A `parents` row with active links cannot leave `approved` or be deleted: the admin removes its links first. Link removal is therefore the only way a link ends, apart from deleting the student.
  - A deferred constraint trigger on UPDATE and DELETE of `student_parents` locks the student's `profiles` row (`FOR UPDATE`), recounts active links, and refuses zero while the student still exists. Concurrent removals therefore serialize, and student deletion passes. The rule is enforced on link changes only, so service-role fixtures may create a student with no link.
  - Only the trusted sign-up path (AD-11) and the invite accept (AD-16) create links; parents never write `student_parents`. Only the admin removes a link, through a security-definer function. It sets `removed_by`/`removed_at` once (a removed row is never changed again) and refuses when `has_link_to` makes the admin a parent of that student.
  - Lock order is the same everywhere: the parent's `parents` row, then the student's `profiles` row. RPCs that lock or write are `VOLATILE`, so PostgREST calls them by POST and not read-only.
  - `profiles.parent_id` is renamed `registered_by_parent_id`, and its FK becomes `ON DELETE SET NULL`. It is set once at sign-up, used only by the one-student-per-parent-and-name rule (0042) and for "registered by" display, and **never read for access**. The same migration does four things:
    - inserts one link per non-null value (slot 1, `invited_by` null, `linked_at` = the profile's `created_at`);
    - recreates every database function whose body names `parent_id` on top of the links (guard trigger, `handle_new_user`, `is_parent_of`, `linked_children`, `student_registration_state`, the 0037 push recipients);
    - ends with a `pg_proc.prosrc` check that raises if `parent_id` still appears;
    - stops before changing anything if a row would break the new rules.
  - Story 1 owns the database functions, and story 2 the TypeScript readers. `registered_by_parent_id`, `guardian_email`, and `role` are writable only by trusted paths (guard trigger). `guardian_email` stays a display copy; contact lists come from the links (AD-12).

### AD-11 — Student registration identity

- **Binds:** CAP-1, CAP-12
- **Prevents:** Supabase Auth's unique-email rule colliding between siblings and their parent; anonymous visitors reading `parents`; a student created without a parent because the check and the insert ran separately; Auth sending mail to a synthetic address
- **Rule:** A student's auth user carries a synthetic email (the existing student email domain) from the moment they register, created by a server action through the Admin API with the email pre-confirmed and a random, unshared password; real login credentials are minted at teacher approval, as today. The parent match happens **inside the auth-user insert trigger**: it sets `registered_by_parent_id` and inserts the slot-1 `student_parents` link, or raises, rolling back the whole sign-up. It also raises, with the stable hint `already_invited`, when the registering parent has a live invite (AD-16), an active link, or a removed link for a student with the same trimmed, case-insensitive `registration_name`. It locks that `parents` row so concurrent registrations by one parent serialize. `student_registration_state()` (0042, service role) is the single `/join` pre-check. It returns `invited` for the same cases, and `/join` maps both it and the hint to one message pointing at the invite. Student approval no longer requires `email_confirmed_at`; the 0006 guardian-email confirmation flow is retired.

### AD-12 — Parent read access

- **Binds:** CAP-13
- **Prevents:** a parallel parent read path drifting from the child's view; a parent gaining write access through reused student policies; a parent seeing another child's name, leave, or progress
- **Rule:** Parent reads are granted per table:
  - **Student-keyed tables** (`homework_status_history`, `student_streaks`, `badges_earned`, `class_enrollments`, `attendance_records`, `skill_status_history`) add `or is_parent_of(student_id)` to their SELECT policies, creating a parent SELECT policy where no student-scoped one exists. Parents see `skill_status_history.notes`; [ASSUMPTION] `attendance_records.notes` stay teacher-only.
  - **Class-keyed tables** (`classes`, `class_sessions`, homework assignments and instances via the targeting helpers) use `is_parent_in_class(class_id)`.
  - **Classmates are never returned to a parent:** the parent variant of `class_people` returns teachers only, and the masked leave function (AD-14) excludes parents. The leaderboard shows team totals only.
  - Functions that treat `auth.uid()` as "the student" take an explicit student id and check self-or-parent. Open and Overdue counts come from one `homework_counts(student_id)` function shared by the student page, the parent card, and the admin view.
  - Parents get **no** INSERT/UPDATE/DELETE policy anywhere except `session_leave_history` (AD-13), `deletion_requests` (AD-9), their own `parents` request (AD-4), and `done` rows for a parent-managed child (below). They create and cancel invites only through AD-16's functions and never write `student_parents`.
  - **Parent-managed homework** (spec-parent-managed-homework): `profiles.parent_managed` (default off) changes only through `set_parent_managed(student_id, on)` (security definer, raises `42501` unless `is_parent_of(student_id)`); the profile guard trigger blocks every other client write to it, and no `profiles` update policy or grant is added. A parent may insert into `homework_status_history` only `status = 'done'` with `is_parent_managing(student_id)` (`is_parent_of` and the flag), under the same `recorded_by = auth.uid()`, instance/class and prior `assigned` checks as the student's self-mark. Never `reviewed`, never update or delete. Both linked parents have the same rights; turning the flag off leaves recorded rows unchanged.
  - Every parent-recipient or parent-scoped query (push recipients, parent calendar, admin parents page) joins active `student_parents` links, never `registered_by_parent_id`.
  - `student_parent_contacts(student_id)` (security definer) returns both active parents' display name and email to the student's class teachers, the admin, and the student's linked parents, and to no one else.
  - `student_parents` SELECT is limited to the student's active parents and the admin. `actor_display_name(student_id, actor_id)` (security definer) is the single way to name the parent behind a leave answer or deletion request, and it covers removed links too. It answers anyone who may read that row; no new `profiles` policy exposes co-parents.

### AD-13 — Session leave

- **Binds:** CAP-4, CAP-11
- **Prevents:** a client marking short-notice leave as planned; a student setting their own leave; a parent re-submitting Sick after a rejection to get it auto-approved; pending Sick leave being forgotten forever
- **Rule:**
  - Leave lives in `session_leave_history` (append-only, keyed by `class_session_id` + `student_id`: `coming` / `on_leave` / `sick`). Only `is_parent_of(student_id)` may insert. The database enforces the cutoffs using AD-15's session start: `coming`/`on_leave` until the session starts, `sick` until the end of the following day (Europe/Berlin). A BEFORE INSERT trigger stamps `planned` / `short_notice` via `classify_leave()`; the client never supplies it.
  - Sick decisions live in `sick_leave_decisions`, keyed by `(class_session_id, student_id)` — not by a leave row — and are made by any teacher of the class or the admin (subject to AD-4's self-approval guard). [ASSUMPTION] A rejection is final for that session.
  - A daily `pg_cron` catch-up job approves every undecided Sick answer whose session started at least 14 days ago, recorded with a system actor.
  - All of this holds per `(class_session_id, student_id)`, whichever linked parent writes: a Sick rejection is final for both parents. `answered_by` (0027, AD-5-stamped) identifies the parent and is shown in parent and teacher views through `actor_display_name` (AD-12).
  - Leave rows of a session deleted by schedule regeneration are deleted with it ([ASSUMPTION]; regeneration only touches future sessions). This replaces story 6-3's student-set leave.
- [ASSUMPTION] The classification is frozen at insert: changing the notice period later or moving the session doesn't reclassify existing leave. PRD Open Question 4 is still open; revisit when it's decided.

### AD-14 — Sick masking

- **Binds:** CAP-11
- **Prevents:** a classmate or team view reading the raw leave table and leaking that a child is Sick
- **Rule:** SELECT on `session_leave_history` and `sick_leave_decisions` is limited to the student, their parent, the class's teachers, and the admin. Classmates and teammates read leave only through one security-definer function that checks the caller is an enrolled classmate or teammate, returns only session, student display name, and answer, and returns `sick` as `on_leave`. No view or policy grants classmates the base table.

### AD-15 — Session timing single source

- **Binds:** CAP-10, CAP-11
- **Prevents:** the FR-9 "Planned or Short-Notice" preview disagreeing with what the database stores; cutoffs computed differently in the UI, the insert trigger, and the auto-approval job
- **Rule:** One SQL function `session_starts_at(class_session_id)` resolves a session's start (session override, else class default, in Europe/Berlin). `classify_leave()` (used by the insert trigger) and `preview_leave()` (the RPC the UI calls before saving) both build on it; no other code computes session start, cutoffs, or classification. [ASSUMPTION] A session with no time set starts at 00:00 local on its day.

### AD-16 — Parent invites

- **Binds:** spec-second-parent
- **Prevents:** an email-matching RLS policy; an invite form that reveals whether an email has an account; a stale invite linking someone after its inviter was removed; two pending invites or a third parent for one child
- **Rule:**
  - Invites live in `parent_invites` (`student_id`, `invited_email` stored `lower(btrim())`, `invited_by`, `created_at`, `expires_at`, `status` `pending`/`accepted`/`cancelled`/`expired`). A partial unique index allows one `pending` row per student. [ASSUMPTION] The lifetime is the `app_settings` value `parent_invite_days`, default 30.
  - **One live-invite predicate** (`status = 'pending'`, `expires_at > now()`, inviter still actively linked) is used by create, list, accept, and the CAP-5 sign-up check. An index predicate cannot use `now()`, so create locks the student row and marks expired or orphaned `pending` rows `expired` before inserting. No scheduled job is needed.
  - Every write, and the invitee's read, goes through `VOLATILE` security-definer functions (create, cancel, list mine, accept). There is no client write policy and no policy that matches email. SELECT is open to the student's linked parents and the admin.
  - Create requires the caller to be `is_parent_of` an approved student. Its distinct refusals are exactly four, and none depends on whether the email has an account:
    - not your child;
    - the child already has two parents;
    - the email is the caller's own, or belongs to a linked parent;
    - an invite is already pending.
  - Accept locks the caller's `parents` row and then the student's `profiles` row, and re-checks everything in one transaction:
    - the invite is live;
    - the student is approved and has fewer than two active links;
    - the caller holds an approved `parents` row, and their confirmed `auth.users` email equals `invited_email`;
    - the caller has no removed link to that student;
    - the caller has no active link or registered child with the same `registration_name`.
    - If all pass, it inserts the link into the free slot and marks the invite accepted.
  - Removing a link cancels the student's pending invites from that parent (trigger on removal). Rejecting the student cancels its pending invites, and deleting it cascades them.

## Consistency Conventions

| Concern | Convention |
| --- | --- |
| Naming (entities, files, interfaces, events) | `snake_case` for DB tables/columns; kebab-case routes; `PascalCase` Svelte components |
| Data & formats (ids, dates, error shapes, envelopes) | UUID primary keys (Supabase default); all timestamps `timestamptz` in UTC; dates as ISO 8601; session times and leave cutoffs evaluated in Europe/Berlin |
| State & cross-cutting (mutation, errors, logging, config, auth) | Supabase Auth JWT is the only identity token; admin-tunable values (streak grace period, leave notice period, badge milestone step, homework look-ahead window) live in `app_settings`, never a hardcoded constant; UI strings keyed through **Paraglide (Inlang)**, never inline literals |
| Database functions | New `security definer` functions pin `set search_path = ''`, check the caller inside, return only the needed columns, and grant `EXECUTE` explicitly (revoked from `public`/`anon`). Existing functions keep their current form. |

## Stack

| Name | Version |
| --- | --- |
| SvelteKit | **2.x, pinned** — SvelteKit 3.0.0 shipped 2026-10-01 (3.1.0 latest), but @vite-pwa/sveltekit 1.1.0 still peers `^1.3.1 \|\| ^2.0.1` (re-verified 2026-10-27); move to 3.x only once the PWA plugin supports it |
| Supabase (Postgres + Auth + Storage + `pg_cron`) | managed, current |
| @vite-pwa/sveltekit | 1.x (1.1.0 current, re-verified 2026-09-26) |
| Paraglide (Inlang) | 2.x, via `svelte add paraglide` |
| Hosting | Cloudflare Pages free tier |

## Structural Seed

```mermaid
erDiagram
  PROFILES ||--o{ CLASS_TEACHERS : "teacher assigned via"
  CLASSES ||--o{ CLASS_TEACHERS : "has teachers via"
  CLASSES ||--o{ CLASS_ENROLLMENTS : "enrolls"
  PROFILES ||--o{ CLASS_ENROLLMENTS : "student in"
  PROFILES ||--o| PARENTS : "may hold parent capability"
  PARENTS ||--o{ STUDENT_PARENTS : "linked (max 2 active per student)"
  PROFILES ||--o{ STUDENT_PARENTS : "student has 1-2 parents"
  PARENTS ||--o{ PROFILES : "registered_by_parent_id (display + 0042 only)"
  PROFILES ||--o{ PARENT_INVITES : "invites for student"
  PROFILES ||--o{ ATTENDANCE_RECORDS : "has"
  PROFILES ||--o{ SKILL_STATUS_HISTORY : "has"
  CLASSES ||--o{ HOMEWORK_ASSIGNMENTS : "scoped to"
  HOMEWORK_ASSIGNMENTS ||--o{ HOMEWORK_INSTANCES : "generates"
  HOMEWORK_INSTANCES ||--o{ HOMEWORK_STATUS_HISTORY : "has per student"
  PROFILES ||--o{ HOMEWORK_STATUS_HISTORY : "has"
  CLASS_DAYS ||--o{ CLASS_SESSIONS : "hosts"
  CLASSES ||--o{ CLASS_SESSIONS : "has (trigger-created)"
  CLASS_SESSIONS ||--o{ SESSION_LEAVE_HISTORY : "leave answers"
  PROFILES ||--o{ SESSION_LEAVE_HISTORY : "about student"
  CLASS_SESSIONS ||--o{ SICK_LEAVE_DECISIONS : "sick decided per session"
  PROFILES ||--o{ SICK_LEAVE_DECISIONS : "about student"
  TEAMS ||--o{ PROFILES : "team_id (set once)"
  PROFILES ||--o{ STUDENT_STREAKS : "has (derived)"
  PROFILES ||--o{ BADGES_EARNED : "has (derived)"
  PROFILES ||--o{ DELETION_REQUESTS : "about / requested by"
```

Entity names and relationships only — column-level shape is seed the code owns once migrations exist. `STUDENT_STREAKS`, `BADGES_EARNED` and `CLASS_SESSIONS` are written only by DB triggers (AD-3). `APP_SETTINGS` (admin-tunable values, not shown) is a flat key/value table. **Team leaderboard rank is deliberately absent** — it is a read-time computed view (`SUM` of member streaks per team), never a stored column. `PARENTS` (0023), `DELETION_REQUESTS` (0029) and the leave tables (0027, 0028) are built, and `ATTENDANCE_RECORDS` is keyed by session (0045). `STUDENT_PARENTS` and `PARENT_INVITES` are new with spec-second-parent.

```text
messages/              # Paraglide message files (de, en, bo)
src/
  routes/            # SvelteKit pages, one tree per role (admin/, teacher/, student/, parent/)
  lib/
    supabase/         # generated types + typed client wrapper
    server/           # server-only helpers (getCapabilities, service-role account operations)
    components/       # shared UI
supabase/
  migrations/         # schema + RLS policies + DB triggers + pg_cron jobs, source of truth for the data layer
```

## Capability → Architecture Map

| Capability | Lives in | Governed by |
| --- | --- | --- |
| CAP-1 Account & registration | `profiles`, `class_teachers`, sign-up trigger, server-action account operations | AD-2, AD-4, AD-5, AD-10, AD-11 |
| CAP-2 Roster & skill tracking | `attendance_records`, `skill_status_history` (notes visible to parent), direct-lane RLS | AD-2, AD-4, AD-5, AD-12 |
| CAP-3 Homework assignment & tracking | `homework_assignments`, `homework_instances` (UNIQUE-constrained), `homework_status_history` + `pg_cron` recurrence job; `homework_counts()` | AD-2, AD-3, AD-5, AD-8, AD-12 |
| CAP-4 Streaks | `student_streaks`, written only by `recompute_student_streak` via triggers (incl. leave, cancellation) | AD-3, AD-13 |
| CAP-5 Badges | `badges_earned`, trigger-written only | AD-3 |
| CAP-6 Team leaderboard | `teams`, set-once `profiles.team_id` + rank as a read-time function | AD-2, AD-3, AD-4, AD-12 |
| CAP-7 Admin oversight | cross-class read via admin-role RLS; approves students, parents, deletions; removes parent links | AD-2, AD-4, AD-10 |
| CAP-8 Data privacy & deletion | `deletion_requests` (student or parent submits) + cascade trigger on admin approval | AD-2, AD-3, AD-5, AD-9 |
| CAP-9 Class days `[ADOPTED]` | `class_days`, admin-written | AD-2 |
| CAP-10 Class schedules & sessions `[ADOPTED]` | class schedule columns + trigger-created `class_sessions`; `session_starts_at()` | AD-2, AD-3, AD-15 |
| CAP-11 Session leave | `session_leave_history`, `sick_leave_decisions`, masked classmate read function, `pg_cron` auto-approval | AD-3, AD-5, AD-13, AD-14, AD-15 |
| CAP-12 Parent accounts | `parents` (admin-approved), `student_parents`, `profiles.registered_by_parent_id`, custom SMTP for confirmation | AD-4, AD-6, AD-10, AD-11 |
| spec-second-parent Second parent | `student_parents` (slot 1/2), `parent_invites` + invite functions, `student_parent_contacts()`, admin link removal | AD-4, AD-9, AD-10, AD-11, AD-12, AD-13, AD-16 |
| spec-parent-managed-homework Parent-managed homework | `profiles.parent_managed`, `set_parent_managed()`, `is_parent_managing()`, parent `done` branch of the `homework_status_history` insert policy | AD-2, AD-3, AD-12 |
| CAP-13 Parent child view | per-table parent SELECT policies, `linked_children()`, `parent/` route tree | AD-2, AD-4, AD-12, AD-14 |

## Deferred

- **Column-level schema** — table shapes beyond the ERD's names/relationships are seed, owned by migrations once written, not this spine.
- **SMTP provider choice** — any provider under the org account (AD-6, AD-7); pick it in the first parent story.
- **Reworking existing `security definer` functions** to the new convention (private schema / empty `search_path`) — not required by the Parent role; revisit in a hardening pass.
- **Badge milestone step size** (every 5 vs. every 10) — open question carried from SPEC.md.
- **Planned-leave edge cases** (PRD OQ4) — On leave → Coming → On leave, sessions moved inside the notice period, and reclassification when the setting changes. AD-13 freezes the classification at insert until this is decided.
- **Parent account after its last child leaves** (PRD OQ3) — the account survives for now; no lifecycle rule.
- **Parent email-access recovery** (PRD OQ5) — handled manually by the admin until decided.
- **GDPR controller, retention, legal basis** (PRD OQ1) — a go-live precondition for the Parent role, not an architecture decision; no retention jobs are designed in yet.
- **Parent notifications beyond homework push** — homework push (#92) reaches both parents through active links (AD-12); any other parent email or push is still a non-goal.
- **Guardian-email change flow** — `guardian_email_change_requests` was never built. When it is, it must act on `student_parents`, saying which link it replaces and never creating a third.
- **Staging environment** — deferred until there's a second maintainer or usage beyond the free tier; revisit then.
- **Offline sync** — explicit SPEC.md non-goal.
- **UI/UX design system and role switcher placement** — owned by `bmad-ux`, not this spine.
- **Native app-store packaging** — not needed (SPEC.md constraint). If ever wanted later, the lowest-cost path is wrapping the existing PWA (e.g. Capacitor) rather than a rewrite.
