---
name: 'Adversarial Review: Architecture Spine (Parent Role update)'
type: architecture-review
lens: adversarial
target: ARCHITECTURE-SPINE.md (updated 2026-09-26: AD-4, AD-9 amended; AD-10 to AD-14 new)
sources:
  - '../ARCHITECTURE-SPINE.md'
  - '../../../prds/prd-tib-class-2026-09-26/prd.md'
  - '../../../prds/prd-tib-class-2026-09-26/addendum.md'
  - '../../../../specs/spec-class-tracker/SPEC.md'
  - '../../../../specs/spec-class-tracker/roles-and-permissions.md'
  - '../../../../specs/spec-class-tracker/calendar.md'
  - '../../../../specs/spec-class-tracker/gamification.md'
  - '../../../../../supabase/migrations/0001..0019'
status: draft
created: '2026-09-26'
---

# Adversarial Review: Parent Role Spine Update

## Method

For each finding I take two units one level down (stories, or two functions/policies inside one story). Each unit follows every AD to the letter, yet the two still build incompatibly. The collision can be a clashing data shape, two owners of one entity, two mutation paths, a privacy leak, a cutoff computed in two places, or unintended access through AD-4's union-of-capabilities rule. Every finding names the two units and ends with a concrete AD fix. Where existing migrations make the collision concrete, the file and line are cited.

Unit names used below:

| Id | Unit |
|---|---|
| U-PREG | Parent self-registration (FR-1) |
| U-PAPP | Admin approves or rejects parents (FR-2) |
| U-SREG | Student registration against an approved parent (FR-3, AD-11) |
| U-SAPP | Teacher approves a student (existing `/requests`, 0006 policy) |
| U-VIEW | Parent landing and child details (FR-6, FR-7, AD-12) |
| U-LEAVE | Parent sets session leave (FR-8, FR-9, AD-13) |
| U-SICK | Sick decision and auto-approval (FR-10, AD-13) |
| U-GEC | Guardian email change request (FR-5, AD-10) |
| U-DEL | Deletion request and cascade (FR-11, AD-9) |
| U-ATT | Attendance per session (story 6-2) |
| U-STRK | Streak recompute (AD-3) |
| U-SCHED | Class schedule regeneration (story 6-4, 0019) |
| U-TDEL | Admin deletes a teacher (existing `admin/teachers`, `auth.admin.deleteUser`) |
| U-PROF | Parent My Profile (FR-12) |
| U-DUAL | Teacher/admin who also holds parent capability (FR-1, AD-4) |

Verdict: **not ready to build Parent stories.** Two critical holes: role escalation at sign-up, and client-forgeable leave timestamps. Several high-severity seams also remain, around the meaning of `is_parent_of`, the leave-timing source of truth, and the ownership and lifecycle of `parent_id`.

---

## Critical

### C-1: Any visitor can sign up as admin. The new public parent sign-up makes this the main entry path.

- **U-PREG vs. `handle_new_user` (0001:132-149, 0006:62-100)**
- `handle_new_user` takes `profiles.role` from `raw_user_meta_data ->> 'role'`. That is `options.data` on `supabase.auth.signUp`, which any holder of the public anon key controls. `/join` already calls public `signUp` with `role: 'student'` (`src/routes/(auth)/join/+page.server.ts:52-62`), and `enable_signup = true`. A crafted `signUp({ options: { data: { role: 'admin' } } })` therefore produces a profile for which `is_admin()` returns true.
- AD-4 now says "Parent sign-up sets its role explicitly and never relies on `handle_new_user`'s default". U-PREG obeys this literally by passing `role: 'parent'` in user metadata, which is the same channel an attacker uses. AD-11 moves *student* sign-up to the service role but says nothing about the parent path, which must stay public (visitors self-register).
- **Fix (tighten AD-4, new clause):** "`handle_new_user` derives role only from `raw_app_meta_data` (writable only by the service role). From `raw_user_meta_data` it accepts at most `parent`, and any other value is refused. `admin` and `teacher` are never assignable through a client-reachable sign-up. Parent self-registration runs as a SvelteKit server action and creates the `parents` row (`pending`) in the same trigger. A migration test asserts that an anon `signUp` with `role: admin|teacher|student` fails or lands as `parent`/pending."

### C-2: Leave timestamps are client-writable, so a tampered client can forge Planned leave and bypass every cutoff

- **U-LEAVE (insert path) vs. the AD-13 classification trigger**
- AD-13 says a BEFORE INSERT trigger stamps `planned`/`short_notice` "from `set_at`, the session start, and the notice period". It also says the database enforces the cutoffs. It never says who writes `set_at` and `set_by`. The codebase precedent is `recorded_at timestamptz default now()` (0003:59), a default the client can override. U-LEAVE's insert can send `set_at = now() - 30 days`. The trigger then correctly classifies the leave as `planned`, and the cutoff check (`set_at < session start`) passes for a session that has already happened. `set_by` is similarly spoofable unless pinned. AD-13's own "Prevents: a client marking short-notice leave as planned" is defeated.
- The same gap applies to `sick_leave_decisions.decided_at/decided_by` and `deletion_requests.requested_at/requested_by`.
- **Fix (tighten AD-5 or AD-13):** "On every append-only history table, the actor and time columns (`set_by`/`set_at`, `decided_by`/`decided_at`, `recorded_by`/`recorded_at`, `requested_by`/`requested_at`) are overwritten in a BEFORE INSERT trigger with `auth.uid()` and `now()`. Client-supplied values are ignored, and the column grants exclude them. Cutoffs and classification compare `now()` inside the trigger, never a row value."

---

## High

### H-1: `is_parent_of` has no defined semantics, so parent-scoped stories disagree on pending, rejected, and revoked states

- **U-VIEW vs. U-DEL / U-LEAVE / U-SREG**
- FR-6 needs the parent to see a *pending* child's name and "Waiting for approval". FR-4 needs a *rejected* child to disappear. AD-4 grants parent capability only with an *approved* `parents` row. AD-10 sets `parent_id` at registration, while the child is pending, and never clears it on rejection.
- U-VIEW implements `is_parent_of(s)` as `profiles.parent_id = auth.uid()`, so the landing page shows pending children. That same predicate, added to SELECT on every table by AD-12, then covers rejected children and parents whose `parents` row is not approved. U-DEL uses the same helper to let the parent file a deletion request for a rejected child.
- Suppose instead that a stricter U-LEAVE story defines the predicate as "approved parent AND approved child". The pending card then disappears. Two helpers named the same, or one helper with the wrong meaning, breaks either FR-6 or the AD-4 capability gate.
- **Fix (tighten AD-4):** Define exactly two helpers:
  - `is_parent_of(student_id)`: caller holds an approved `parents` row, `profiles.parent_id = caller`, and the child's `status = 'approved'`. This is the only predicate that grants child data.
  - `linked_children()`: a security-definer function returning `(id, display name, status)` for pending and approved children only. It is the only source for the landing list.
  - Rejection or deletion of the child removes it from both. A parent row that is not approved yields false everywhere, including after a future revocation.

### H-2: Parent reads of class-scoped tables need a helper the spine doesn't list, so each story invents its own

- **U-VIEW (sessions, homework, teachers) vs. U-LEAVE (session picker)**
- AD-12 says to add `or is_parent_of(student_id)` to "student-scoped SELECT policies", and lists `sessions` among them. But `class_sessions`, `homework_assignments`, `homework_instances`, `classes`, and `class_syllabi` carry no `student_id`. Their student access is `is_enrolled_in_class(auth.uid(), class_id)` (0016:395-405, 0018:139).
- U-VIEW writes `exists (select 1 from profiles c join class_enrollments e ... where c.parent_id = auth.uid())`. U-LEAVE writes its own variant that forgets the approved-child filter. Both violate AD-4's "never a locally invented check", because AD-4 offers nothing to use for these tables.
- **Fix (AD-4 helper list):** Add `is_parent_in_class(class_id)`, meaning "an approved parent with an approved, enrolled child in that class", built on `is_parent_of`. AD-12 then states both forms: student-keyed tables use `is_parent_of(student_id)`, and class-keyed tables use `is_parent_in_class(class_id)`.

### H-3: "The parent's view is the child's view by construction" contradicts the PRD's privacy rule

- **AD-12 (`class_people`, classmate leave function) vs. FR-7 / PRD §8 ("no other Student's personal details beyond what the leaderboard already shows the child")**
- The child sees classmates' display names through `class_people` (0017) and classmates' leave through the AD-14 masked function. The leaderboard (0009) shows only per-team totals, with no names. AD-12 tells the implementer to make `class_people(p_student)` accept self-or-parent. The parent therefore receives every classmate's name, and through the AD-14 function every classmate's attendance intent.
- Both units follow the ADs, and the result is a PRD privacy breach.
- **Fix (tighten AD-12 and AD-14):** "When called for a parent, `class_people` returns teachers only. The classmate/teammate leave function never admits a parent-only caller. 'Child's view' means the child's *own* records plus the class's teachers and team totals, never classmate rows."

### H-4: Leave timing is computed in two places, and session start is undefined when the class has no time set

- **U-LEAVE UI preview (FR-9: "before saving, the Parent sees Planned or Short-Notice") vs. the AD-13 BEFORE INSERT trigger**
- The preview is naturally computed in TypeScript from the session's displayed date and time. The trigger computes the same thing in SQL. The effective start comes from `class_sessions_effective` (per-session override, else class default), and the calculation depends on Europe/Berlin daylight-saving shifts. Any drift, for example the UI using the class default while the trigger uses the override, means the parent is promised "Planned" and gets "Short-Notice".
- calendar.md also says a new class has "no time set until someone edits it". In that case "until the session starts", the notice period, and the Sick cutoff (end of the following day) have no defined anchor, so the trigger and the UI each pick one.
- A session whose time is later moved is covered only by an [ASSUMPTION] freeze for classification. The cutoff for *new* inserts is not covered.
- **Fix (new AD-15, Session time source):**
  - One SQL function, `session_starts_at(class_session_id) -> timestamptz` (Europe/Berlin to UTC), is the only way to get a session's start. When no time is set, the start is 00:00 Berlin on the class day.
  - `classify_leave(session_id, at)` and `leave_cutoffs(session_id)` wrap it.
  - The trigger, the RLS insert check, and a `preview_leave(session_id)` RPC used by the UI all call these functions. No client code computes classification or cutoffs.

### H-5: Sick decisions are keyed to a leave row, so a parent can re-submit to escape a rejection and pick up auto-approval

- **U-LEAVE (append-only, "current = latest row") vs. U-SICK (decisions attached to a `session_leave_history` row, per the ERD)**
- A teacher rejects Sick on Sunday. On Monday, still inside the Sick cutoff (end of the following day), the parent sets Coming and then Sick again. The latest leave row is a new Sick row with no decision. It is pending again, the rejection no longer applies, and the `pg_cron` job auto-approves it after two weeks.
- "Two weeks undecided" is also anchored to nothing: Sick `set_at`, session date, or first Sick row?
- **Fix (tighten AD-13):**
  - Key `sick_leave_decisions` by `(class_session_id, student_id)`, not by leave row.
  - Once a decision exists for a session, a new Sick insert inherits it, or is refused.
  - Auto-approval triggers at `session_starts_at + 14 days` when no decision row exists for that (session, student).
  - The job and a concurrent teacher decision both insert under a unique partial guard, so exactly one decision wins.

### H-6: Dual-role union lets a teacher-parent approve their own child's Sick leave, and route guards read `profiles.role`

- **U-DUAL vs. U-SICK; U-DUAL vs. U-PROF / `parent/` route tree**
- AD-13 lets "any teacher of the class or the admin" decide Sick. AD-4 says RLS evaluates the union of capabilities. A teacher who is the parent of a child in their own class sets Sick as parent and approves it as teacher. FR-10's approval check disappears.
- The existing server guard `requireRole(... profiles.role ...)` (`src/routes/account/+page.server.ts:55-62`) authorizes by the *primary* role. Carried into the `parent/` tree, it produces two failures:
  - A teacher-parent (`role = 'teacher'`) is locked out of the parent tree.
  - A pending or rejected parent (`role = 'parent'`) passes the guard, and U-PROF's service-role display-name write runs for them.
- **Fix:**
  - (a) AD-13 insert check on `sick_leave_decisions`: `not is_parent_of(student_id)`, and the decider is not the leave's `set_by`. The admin remains the backup decider.
  - (b) AD-4: add "Server route guards and service-role actions authorize through one `getCapabilities()` helper mirroring the SQL helpers (admin, teacher, approved student, approved parent). `profiles.role` alone never gates a route."

### H-7: Student registration and approval disagree on atomicity, confirmation state, and who may write `parent_id`

- **U-SREG (AD-11) vs. U-SAPP (0006:154-170, `/requests`)**
- AD-11 requires class-code and approved-parent validation "in the same transaction" as account creation. But `auth.admin.createUser` is an HTTP call to GoTrue and cannot join a Postgres function's transaction. U-SREG either checks first and then creates, leaving a time-of-check gap if the parent is rejected in between, or creates first and then checks, leaving orphan auth users.
- AD-11 retires the 0006 confirmation, but U-SAPP's WITH CHECK still requires `status = 'approved' and email_confirmed_at is not null`. A synthetic-email student is never confirmed, so no student can be approved.
- `profiles_update_registration_review` has no column restriction. A teacher's approval UPDATE can also rewrite `parent_id` or `guardian_email`. That is a second client write path for `parent_id`, which AD-10 forbids but nothing enforces.
- **Fix (tighten AD-10 and AD-11):**
  - `parent_id` is set inside `handle_new_user` from service-role-only `raw_app_meta_data`. The trigger re-validates the approved parent and raises on failure, which aborts user creation atomically.
  - A BEFORE UPDATE trigger on `profiles` (like `enforce_team_id_set_once`, 0002:112) rejects any change to `parent_id`/`guardian_email` unless it comes from the U-GEC approval trigger.
  - The approval policy's `email_confirmed_at` condition is replaced with `parent_id is not null`.
  - Column grants limit teacher UPDATE to `status`, `reviewed_by`, `reviewed_at`, and `team_id`.

### H-8: Parent Email has no owning column, so re-registration and dual-role enrollment collide with Auth's unique email

- **U-PREG vs. U-PAPP (reject) vs. U-DUAL**
- FR-2 says "a rejected Parent can submit a new registration with the same email". `parents` has PK = auth user id, and a rejection leaves that auth user in place. A second public `signUp` with the same email gets GoTrue's obfuscated duplicate response (see `src/lib/server/signup-duplicate.ts`), and no new account is created.
- A teacher who wants parent capability cannot use public sign-up at all, because their email is already an auth user. AD-4 says a parents row is "added for the same auth user" but names no path.
- The "Parent Email" that U-SREG matches against is unspecified: `auth.users.email`, `profiles.email`, or a `parents.email` column. A user can call `auth.updateUser({ email })` from the client, which silently moves the matching key even though the PRD makes the Parent Email unchangeable.
- **Fix (tighten AD-4 and AD-10):**
  - `parents.email citext`, snapshotted at creation, with a partial unique index `where status in ('pending','approved')`. This is the only column U-SREG matches.
  - Re-registration after rejection is a server action that reuses the existing auth user: it resets the row to `pending` and sets a new password.
  - Staff add parent capability through an authenticated "Also register as parent" server action on the same user.
  - Client-initiated email change is refused for users that hold a parents row (Auth hook or a server-only email change).

### H-9: Deleting a teacher or parent auth user can cascade into their children's data with no deletion approval

- **U-TDEL (`auth.admin.deleteUser`, `admin/teachers/+page.server.ts:201`) vs. AD-10 link / AD-9**
- `profiles.id` cascades from `auth.users`. If U-PREG builds `parents.id → profiles.id on delete cascade` and AD-10's `profiles.parent_id → parents.id` also uses `on delete cascade`, which is the repository's default habit (0003:54, 0018:115), then deleting a teacher-parent erases every linked child profile. Their history goes with it.
- CAP-8 ("no deletion without a recorded admin approval") is bypassed. AD-9 says "the parent's own account is not part of the cascade", but does not say the reverse direction is safe.
- **Fix (AD-10):** "`profiles.parent_id` is `ON DELETE RESTRICT`. Deleting any auth user that holds a `parents` row with linked children is refused until the children are deleted via AD-9 or moved via U-GEC. Teacher deletion checks this first."

### H-10: One streak row per student meets per-class and per-session leave

- **U-STRK (`student_streaks` PK = `student_id` with a `class_id` column; `recompute_student_streak(student, class)`, 0007:40, 0016:529) vs. U-LEAVE/U-SICK triggers vs. U-ATT (6-2)**
- AD-3 adds leave triggers that call `recompute_student_streak(student, session.class_id)`. For a child in two classes, a leave in class B overwrites the row's `class_id` with B.
- There is no week-verdict rule for multi-session weeks:
  - "Attending any session qualifies" (calendar.md).
  - "A missed session with Planned leave doesn't consume grace."
  - A week with one planned-leave session and one unannounced absence has no defined result.
- 6-2 and the leave story will each encode their own precedence, including attendance "present" vs. leave "on_leave" on the same session.
- Weeks are also UTC (`date_trunc('week', now() at time zone 'utc')`, 0016) while cutoffs use Berlin time.
- **Fix (tighten AD-3):**
  - The streak is per student, computed across all of the student's enrolled classes. Remove `class_id` from the key and the signature.
  - One `week_verdict(student, week)` function decides qualified / protected / holiday / missed. Present on any session means qualified. Otherwise the week is protected only if every missed non-cancelled session in that week has Planned or approved-Sick leave. No non-cancelled session means holiday.
  - Weeks are Europe/Berlin ISO weeks.
  - U-ATT and the leave triggers both call only this function.

---

## Medium

### M-1: A guardian email change leaves the old parent's in-flight actions live

- **U-GEC vs. U-DEL / U-LEAVE**
- Parent A files a deletion request. The child then moves to parent B through U-GEC. The admin approves A's request later, so a person who is no longer the parent deletes B's child.
- AD-10's trigger also validates the new parent only when the request is created. By the time the admin approves, the target parent may be rejected.
- **Fix (AD-10):** The approval trigger re-checks that the target parent is approved, in the same statement, and cancels open `deletion_requests` whose `requested_by` is the old parent. A pending request for a student blocks U-GEC approval, or the reverse, never both open.

### M-2: Schedule regeneration deletes sessions that carry leave and attendance

- **U-SCHED (`regenerate_class_sessions` deletes non-matching sessions dated today or later, 0019:192-201) vs. U-LEAVE / U-ATT (FKs to `class_sessions`)**
- Changing a schedule silently deletes a future session's planned leave and pending Sick leave. With 6-2, it also deletes today's attendance, because "today" counts as future. It either cascades or fails with an FK error, depending on which story wrote the FK.
- **Fix (tighten the AD-3 session clause):** A session that has leave or attendance rows is never deleted by regeneration. It is marked `cancelled` instead. Leave and attendance FKs are `ON DELETE RESTRICT`.

### M-3: The masked classmate function can still leak Sick through side channels

- **AD-14 function vs. U-LEAVE row shape**
- On-leave cannot be set after the session starts, so any leave row with `set_at` after the session start is necessarily Sick. A masked function that returns `set_at`, the row history, the `planned/short_notice` label (which Sick rows lack), or the decision state leaks Sick while complying with "return `sick` as `on_leave`".
- **Fix (AD-14):** The classmate function returns exactly `(student nickname, session_id, state ∈ {coming, on_leave, not_answered})` for the latest row: no timestamps, classification, history, or decision.

### M-4: "Authenticated" no longer means "school member"

- **U-PREG (public sign-up) vs. existing policies `auth.role() = 'authenticated'` (app_settings 0001:215, teams 0002:41, class_days 0018:89) and `team_leaderboard()` granted to authenticated**
- Any internet visitor who self-registers as a pending (or rejected) parent can read teams, class days, settings, and the leaderboard. PRD FR-1 says "a new parent sees no student data".
- **Fix (AD-4):** Add a helper `is_member()` (admin, teacher, approved student, or approved parent), and replace `auth.role() = 'authenticated'` with it in every policy and function grant.

### M-5: The deletion audit row points at identities the cascade destroys

- **U-DEL (parent-submitted, `requested_by` = parent uuid) vs. AD-9 cascade (student-submitted, `requested_by` = the student's own id)**
- When the student submitted the request, the cascade deletes `requested_by`'s profile. Depending on the FK, this either fails or removes the audit row that AD-9 promises to keep.
- **Fix (AD-9):** Store `requested_by_role` (`student` | `parent`) and `requested_by` with `ON DELETE SET NULL`. The cascade de-identifies both references. Allow at most one open request per student (partial unique index).

### M-6: The AD-13 insert check doesn't bind the session to the child

- **U-LEAVE vs. U-ATT / enrollment**
- `is_parent_of(student_id)` alone lets a parent answer for a session of a class the child isn't in (or is no longer in, after `unenroll_student`), or for a cancelled session.
- **Fix (AD-13):** The insert requires `is_enrolled_in_class(student_id, session.class_id)` and that the session is not cancelled.

### M-7: Retiring 0006 removes the confirmation signal that parent approval needs

- **U-SREG ("0006 is retired") vs. U-PAPP ("approvable only after the email is confirmed")**
- A literal retirement drops `sync_email_confirmed_at` and `profiles.email_confirmed_at`. The parent approval gate then has nothing to read, or reads `auth.users` directly from a client policy.
- **Fix (AD-11):** "Only the guardian-specific parts of 0006 are retired. `email_confirmed_at` mirroring stays the single confirmation source, and the parent approval WITH CHECK reads it."

---

## Low

- **L-1: The admin approves their own parent row (U-DUAL vs. U-PAPP).** With a single admin this is unavoidable. Record it as an accepted exception in AD-4 so no story tries to block it.
- **L-2: Service-role creep (U-PROF vs. AD-1).** `account/+page.server.ts:79` already updates `display_name` with the service role, which AD-1 forbids ("auth-account operations only"). U-PROF will copy it. Either add a column-granted `profiles` self-update policy for `display_name`, or amend AD-1 to list this use. Also, `changePassword` is staff-only today, so FR-12 must extend it.
- **L-3: Teachers can't read parent names for "set by".** A teacher can't read the parent's `profiles` row under current RLS, so U-LEAVE's teacher view shows a bare uuid or invents a definer function. Decide whether teachers see a parent display name, and through which helper.
- **L-4: The registration lookup is an email oracle.** If U-SREG's security-definer check is granted to `anon` (the `validate_class_code` precedent), it becomes a standalone email oracle. The PRD accepts this risk only inside the registration flow. Keep the function server-only, with `revoke ... from anon, authenticated`.
- **L-5: Planned leave switched to Sick loses protection.** A child on Planned leave who then becomes sick and is switched to Sick falls back to pending, unprotected. Record it under the OQ4 deferred item so no story "fixes" it ad hoc.

---

## Suggested spine deltas (summary)

| AD | Change |
|---|---|
| AD-4 | Role only from `app_metadata`, and only `parent` from user metadata (C-1). Exact `is_parent_of` and `linked_children` semantics (H-1). Add `is_parent_in_class` and `is_member` (H-2, M-4). `getCapabilities()` route guard (H-6). `parents.email` and paths for re-registration and staff opt-in (H-8). |
| AD-5 | Actor and time columns always trigger-stamped (C-2). |
| AD-3 | Per-student streak, one `week_verdict`, Berlin weeks (H-10). Regeneration cancels rather than deletes sessions that hold data (M-2). |
| AD-9 | `requested_by_role`, SET NULL, one open request per student (M-5). |
| AD-10 | `parent_id` set in `handle_new_user` from `app_metadata`. Guard trigger on `profiles`. `ON DELETE RESTRICT`. U-GEC re-validates and cancels stale requests (H-7, H-9, M-1). |
| AD-11 | Atomicity through the trigger. The approval policy drops `email_confirmed_at` for students. The confirmation mirror is kept for parents (H-7, M-7). |
| AD-12 | Class-keyed form. Parents never receive classmate rows (H-2, H-3). |
| AD-13 | Enrollment and not-cancelled check (M-6). Decisions keyed by (session, student). Auto-approval anchor. The decider cannot be the parent (H-5, H-6). |
| AD-14 | Exact masked return shape (M-3). |
| New AD-15 | `session_starts_at` / `classify_leave` / `preview_leave` as the only time source (H-4). |
