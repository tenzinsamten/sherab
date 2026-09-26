# Rubric Review: Architecture Spine, Parent Role update (2026-09-26)

- **Spine:** `../ARCHITECTURE-SPINE.md` (updated 2026-09-26: AD-4 and AD-9 amended, AD-10 to AD-14 new, CAP-9 to CAP-13 bound)
- **Inputs checked:** PRD `prd-tib-class-2026-09-26/prd.md` and `addendum.md`; `specs/spec-class-tracker/SPEC.md`, `roles-and-permissions.md`, `calendar.md`, `gamification.md`; migrations `0001` to `0019`; `src/routes` (join, signup, requests, layout, calendar); `src/lib/server/temp-password.ts`; `supabase/config.toml`
- **Reviewer stance:** independent. The spine was not edited.

## Verdict

**Revise before stories are cut.** The paradigm holds and most of the spine ratifies the code correctly: pg_cron for time-based work, trigger-created sessions, the set-once `team_id` trigger, the synthetic student email domain, the single streak path, and service-role use limited to auth-account work. All 13 CAPs are mapped. But:

- One critical trust hole already exists in the code, and amended AD-4 extends it.
- Several new Rules can't be enforced as worded, or don't match the existing policies they claim to extend (AD-10, AD-11, AD-12).
- Several parent-flow divergence points aren't decided: the parent registration and rejection lifecycle, the leave cutoff when a session has no start time, the Open/Overdue definition, and which notes fields parents can see.

## Checklist summary

| Check | Result |
| --- | --- |
| Fixes the real divergence points, misses none | Partial: see H4, M1, M2, M4, M6, M7 |
| Every AD Rule is enforceable and prevents its divergence | Partial: AD-4 (C1), AD-10 (H2), AD-11 (H1), AD-12 (H3) |
| Nothing under Deferred lets two units diverge | Mostly yes. The deferred items are product questions, and AD-13 freezes classification around OQ4. The gaps are undecided items that aren't listed at all (see M-tier). |
| Ratifies, doesn't contradict, the brownfield code | Mostly yes. Mismatches: AD-12 (H3), the Structural Seed claim about `class_sessions` (L2), the leaderboard wording (L3) |
| Covers CAP-1 to CAP-13 and PRD FR-1 to FR-12 | CAPs all mapped. Requirements dropped quietly: FR-2 re-registration (H4), FR-7 privacy limit (H5), FR-9 preview (M1), FR-6 counts (M6) |
| Every structural dimension is decided, deferred, or an open question | Gaps: error-shape convention, test/verification convention, week-bucket timezone (L5) |

## Brownfield claims checked

| Spine claim | Code | Status |
| --- | --- | --- |
| `handle_new_user` defaults to teacher; parent sign-up sets its role explicitly | 0001/0002/0006: `coalesce((raw_user_meta_data->>'role')::user_role, 'teacher')`. The role comes from **client-supplied** user metadata, and public sign-up is enabled (`config.toml` `enable_signup = true`, `/signup` calls anon `signUp`) | **Wrong premise.** See C1 |
| Synthetic student email domain | `STUDENT_EMAIL_DOMAIN = 'students.internal.invalid'`. Today it's minted at approval; `requests/+page.server.ts` already knows a `pending-<uuid>` placeholder shape | Ratified. Should name the pending shape (H1) |
| pg_cron for time-based jobs | 0005 `cron.schedule(...)` for recurring homework | Ratified |
| `class_sessions` trigger-created | 0018/0019 triggers, **plus** the client-invoked security-definer RPCs `add_extra_session()` and `set_class_schedule()` | Partly wrong (L2) |
| `is_admin()` / `is_teacher_of_class()` shared helpers | 0001. Also `is_enrolled_in_class`, `is_teacher_of_student` (0016), `is_targeted_for_homework_*` (0004) | Ratified, but the list is incomplete (L1) |
| `attendance_records` still keyed by `session_date` | 0003, and streak holiday detection reads it (0007/0016) | Ratified (see M3) |
| Parent reads = add `or is_parent_of(student_id)` to **existing student-scoped** SELECT policies | `attendance_records` and `skill_status_history` SELECT are admin/teacher only (0003). There's no student-scoped policy to extend. `class_sessions`, `classes` and `class_syllabi` are class-keyed via `is_enrolled_in_class(auth.uid(), ...)` | **Contradicts code** (H3) |
| `team_id` set-once | 0002 `profiles_team_id_set_once` trigger | Ratified |
| Leaderboard function treats `auth.uid()` as the student | 0009 `team_leaderboard()` takes no arguments and never reads `auth.uid()` | Minor mismatch (L3) |

---

## Critical

### C1. `handle_new_user` trusts a client-supplied role, and AD-4 extends the pattern to parents

**Evidence.** Every version of `handle_new_user` (0001:144, 0002:150, 0006:74) casts `raw_user_meta_data->>'role'` straight into `profiles.role`. Any client with the anon key can set `raw_user_meta_data` through GoTrue `/auth/v1/signup` (`options.data`). Public sign-up is on (`supabase/config.toml` `enable_signup = true`), and `src/routes/(auth)/signup/+page.server.ts` calls `signUp` anonymously. So:

- A visitor who sends `data: { role: 'admin' }` gets `profiles.role = 'admin'`, which makes `is_admin()` true. Every admin RLS policy then opens once they confirm their own mailbox.
- A plain sign-up with no metadata lands as `teacher`. That contradicts the SPEC rule "no teacher self-registration".
- Amended AD-4 ("Parent sign-up sets its role explicitly") keeps client-declared roles as the mechanism and adds `parent` as one more role a client can choose.

**Why it matters for this update.** The parent flow is the first *intended* anonymous self-sign-up of a real, long-lived account. The spine needs to close this now, not push the pattern further.

**Suggested fix.** Amend the AD-4 Rule:

- `handle_new_user` takes privileged roles (`admin`, `teacher`, `student`) only from `raw_app_meta_data`, which only the service role can set.
- From client `raw_user_meta_data` it honours only the value `parent`, which creates `profiles.role = 'parent'` plus a `pending` `parents` row. Any other or missing value is rejected: raise, or insert a non-privileged role.
- Teacher, admin and student accounts are created only through the service-role Admin API (AD-1, AD-11).
- Retire or repurpose the anon `/signup` route as the parent sign-up.
- Add an RLS/integration test that an anon sign-up with `role: 'admin'` doesn't produce an admin profile.

---

## High

### H1. AD-11's "same transaction" can't be enforced; the real guard belongs in the auth-insert trigger

**Evidence.** AD-11 says a server action with the service role calls a security-definer function that "validates the class code and the approved parent in the same transaction". But the auth user is created by the GoTrue Admin API (`auth.admin.createUser`), an HTTP call outside that function's transaction. The profile row, and with it `parent_id`, is written by `handle_new_user` inside the `auth.users` insert. So:

- The check and the insert are two transactions, and a parent can be rejected in between.
- AD-10's "set once by the trusted registration path" doesn't say which of the two steps writes `parent_id`.

Also:

- The rule doesn't say how emails are normalized at match time (`lower(trim())`). AD-10 prevents drift *after* linking, but the match itself still compares text.
- The existing approval gate still requires `email_confirmed_at is not null`: `profiles_update_registration_review` in 0006, and `requests/+page.server.ts:137`. AD-11 retires the flow that satisfied it but doesn't say what replaces it.
- The synthetic *pending* email shape isn't named. `{username}` is only chosen at approval.

**Suggested fix.** Reword AD-11:

- (a) The student branch of `handle_new_user` (trusted `app_metadata` per C1) resolves the approved parent by `lower(trim(guardian_email)) = lower(auth email of an approved parents row)`, sets `profiles.parent_id`, and **raises if none is found**. The auth insert then fails atomically.
- (b) The server-action pre-check exists only to produce the "No parent account found" message.
- (c) Pending students use `pending-<uuid>@students.internal.invalid`, created with `email_confirm: true`, and approval swaps it for `{username}@...` as today.
- (d) The approval policy's `email_confirmed_at` gate becomes `parent_id is not null`, and the pre-check in `requests/+page.server.ts` is removed.

### H2. AD-10's "no client path writes `parent_id`" isn't enforced by existing policy

**Evidence.** `profiles_update_registration_review` (0006) is row-level. For a pending student it lets any teacher of the class, or the admin, UPDATE **every column**, including `guardian_email`, `email`, and a future `parent_id`. No `grant update (...)` or column revoke exists on `profiles` (checked every migration). A teacher who also holds parent capability (AD-4) could point a pending student's `parent_id` at their own `parents` row, then read the child's data through `is_parent_of`.

**Suggested fix.** Add one of these to the AD-10 Rule:

- A `BEFORE UPDATE` trigger on `profiles` that rejects any change to `parent_id` or `guardian_email` unless it comes from the approved change-request trigger. The trigger can be a security-definer function that sets a transaction-local flag, the same pattern as `profiles_team_id_set_once`.
- Or `revoke update on profiles from authenticated` and `grant update (status, team_id, reviewed_by, reviewed_at)` only.

Cover it with an RLS test.

### H3. AD-12 describes policies that don't exist and a predicate that doesn't fit class-keyed tables

**Evidence.**

- Students have no SELECT on `attendance_records` or `skill_status_history`. Both policies are `is_admin() or is_teacher_of_class(class_id)` (0003:105, 0003:129). There's nothing student-scoped to "add `or is_parent_of(student_id)`" to; these need **new** parent policies.
- `class_sessions` (0018), `classes` (`classes_select_own_student`) and `class_syllabi` have no `student_id`. They gate on `is_enrolled_in_class(auth.uid(), class_id)`, so `or is_parent_of(student_id)` can't be written there.
- Homework reads go through `is_targeted_for_homework_*()` keyed on `auth.uid()`.
- `profiles` isn't in the list at all. The parent needs the child's own profile row, including **pending** children for "Waiting for approval" (FR-4, FR-6), and must *not* see rejected ones.
- The spine never states what `is_parent_of` means. CAP-12 says a pending or unconfirmed parent sees nothing, so the helper must require `parents.status = 'approved'`.

**Suggested fix.** Rewrite the AD-12 Rule as a per-table predicate list:

- **Student-keyed tables** (`attendance_records`, `skill_status_history`, `homework_status_history`, `student_streaks`, `badges_earned`, `class_enrollments`, `session_leave_history`): `or is_parent_of(student_id)`, as a new policy where no student policy exists.
- **Class-keyed tables** (`classes`, `class_sessions`, and the homework targeting helpers): a new helper `is_parent_of_class(class_id)`, true when an approved linked child is enrolled in the class.
- **`profiles`**: `is_parent_of(id) and status <> 'rejected'`.
- **Helper definitions**: `is_parent()` means an approved `parents` row for `auth.uid()`. `is_parent_of(s)` means `is_parent()` and `profiles(s).parent_id = auth.uid()`. Reads of child data other than the profile additionally require the child to be approved.

### H4. The parent registration, rejection and dual-role lifecycle is undecided

**Evidence.**

- FR-2 says "A rejected Parent can submit a new registration with the same email". But the rejected parent's `auth.users` row still holds that email, and Supabase Auth emails are unique, so the second sign-up is swallowed as a duplicate (see `isDuplicateSignup`).
- The spine doesn't say who creates the `parents` row: `handle_new_user` from metadata, a server action, or a self-insert.
- It doesn't say how an existing teacher or admin "adds a parents row". Is there a self-insert RLS policy, or does the admin create it? Does it need email re-confirmation, given teacher emails are admin-set?
- It doesn't say whether an approved parent can later be revoked, or what happens to the links if so.

The parent-registration story and the admin-approval story will each invent an answer.

**Suggested fix.** Add to AD-4, or as a new AD:

- (a) A parent-only sign-up creates `parents(status = 'pending')` in `handle_new_user`.
- (b) A teacher or admin requests parent capability through an RLS INSERT on `parents` with `id = auth.uid() and status = 'pending'`.
- (c) Approval is admin-only, with `WITH CHECK` requiring `auth.users.email_confirmed_at is not null` (read through the `profiles.email_confirmed_at` mirror).
- (d) Rejecting a parent-only login deletes the auth user through the service-role Admin API, mirroring CLEAR REJECTED, which frees the email. Rejecting a dual-role login deletes only the `parents` row.
- (e) Revoking an approved parent is either decided now or listed under Deferred.

### H5. "Parent view = child view by construction" leaks classmates, against FR-7 and PRD §8

**Evidence.** AD-12 has `class_people()` take a student id and check self-or-parent. `class_people()` (0017) returns every enrolled classmate's display name. AD-14's masked leave function returns classmates' and teammates' nicknames with their leave state. If parents reuse both, a parent sees other children's names and attendance intentions. FR-7 and PRD §8 say "no other student's personal details beyond what the leaderboard already shows the child", and the leaderboard (0009) shows only team totals.

**Suggested fix.** Add to AD-12:

- The parent path of `class_people` returns teachers only (FR-7 needs only the "Teachers assigned").
- A parent can't call the classmate leave function, or can only see their own child through it.

If the product owner prefers "exactly what the child sees", record that as an explicit PRD decision instead.

---

## Medium

### M1. Leave cutoffs and classification need one shared "session start" and a preview function; the insert guard is incomplete

**Evidence.**

- AD-13's insert rule is only `is_parent_of(student_id)`. It doesn't require that the child is enrolled in the session's class (calendar.md: "Sessions of classes the child is enrolled in"), that the child is approved, or that the session isn't cancelled.
- "Until the session starts" needs a start instant. A new class has `default_start_time` unset (0019: "time unset"), so `class_sessions_effective.start_time` can be NULL and both the cutoff and the Planned/Short-Notice stamp are undefined.
- FR-9 requires that "Before saving, the Parent sees whether the leave will count as Planned or Short-Notice". A client-side calculation will drift from the trigger.

**Suggested fix.** Add to AD-13:

- A single SQL function `session_starts_at(session_id) returns timestamptz`: Europe/Berlin, `class_day.day + effective start time`, with a defined fallback when the time is NULL (for example 00:00 Berlin, or "reject leave until a time is set").
- One function `classify_leave(session_id, at timestamptz)`, used by the BEFORE INSERT trigger and exposed as an RPC for the FR-9 preview.
- An insert `WITH CHECK` covering: approved linked child, enrolled in the session's class, session not cancelled, cutoff not passed.

### M2. Keying sick decisions to a history row lets a rejected Sick come back as pending and then auto-approve

**Evidence.** The ERD keys `SICK_LEAVE_DECISIONS` to a `SESSION_LEAVE_HISTORY` row. Leave is append-only and Sick may be set until the end of the next day. So a parent whose Sick is rejected can answer Sick again, which creates a new undecided row, and the pg_cron job approves it after two weeks. The rule also doesn't say when the two-week clock starts.

**Suggested fix.** In AD-13:

- Key decisions to `(class_session_id, student_id)`.
- Define "current Sick state" as the latest decision after the latest Sick answer.
- Either forbid a new Sick answer once a rejection exists, or carry the rejection over.
- The auto-approval clock starts at the `set_at` of the latest Sick answer.

### M3. Where holidays come from, and missing recompute triggers

**Evidence.** Today `recompute_student_streak` (0016:529) treats a week as a holiday when there's no `attendance_records` row in any of the student's classes. SPEC Constraints say "Scheduled sessions are the source of truth ... a week with no non-cancelled session ... does not consume grace". AD-3 lists recompute triggers only on attendance, homework, leave and sick decisions. Cancelling a session or class day, or regenerating a schedule, changes which weeks are holidays but fires no recompute, so streaks go stale. It's also undecided whether a week counts as protected in a multi-class week when leave covers only one of several missed sessions.

**Suggested fix.** Extend the AD-3 Rule:

- Holiday means a week with no non-cancelled row in `class_sessions_effective` for any enrolled class.
- Add AFTER UPDATE triggers on `class_sessions.cancelled` and `class_days.cancelled`, plus the regeneration trigger, that call `recompute_student_streak` for the affected enrolled students. Or state explicitly that staleness until the next write is accepted.
- Define the protected-week rule: all missed sessions of that week protected, or any one.

### M4. Leave foreign key behavior versus session regeneration

**Evidence.** `regenerate_class_sessions()` (0019:193) hard-deletes future non-matching sessions. The `ON DELETE` behavior of `session_leave_history.class_session_id` isn't decided:

- `RESTRICT` would make schedule edits fail once any leave exists.
- `CASCADE` silently drops parents' answers.

The 6-3 replacement story and future 6-4 changes will clash.

**Suggested fix.** Decide in AD-13. The likely choice is `ON DELETE CASCADE` for both leave tables, stating that answers to a removed session are moot, and that the resulting streak recompute is covered by M3.

### M5. De-identifying deletion requests is incomplete, and it's unclear who runs the cascade

**Evidence.**

- AD-9 keeps `requested_by`. For a student-submitted request that's the erased student's own id: under FK cascade the row dies, and without an FK it's an identifier left behind. For a parent-submitted request the parent's id points to the family, which re-identifies the child.
- The Rule says "`requested_by` role remains", which suggests a separate role column, but doesn't say so.
- AD-3 says the cascade is a "trigger on admin approval". But erasure has to delete the `auth.users` row, because `profiles` cascades from it. The codebase does that through the service-role Admin API (the CLEAR REJECTED precedent, which AD-1 already allows), not from a trigger.

**Suggested fix.** Amend AD-9:

- Columns: `student_id` (`ON DELETE SET NULL`), `requested_by` (`ON DELETE SET NULL`, nulled on completion), and `requested_by_role` (retained).
- Approval is a service-role server action that calls `auth.admin.deleteUser(student)`. FK cascades do the erasure, and the same action stamps `approved_at` and nulls the ids.
- Drop "cascade trigger" from AD-3 and the map, or explicitly choose a security-definer trigger that deletes from `auth.users`. Pick one.

### M6. The Open/Overdue definition will diverge between the child's list, the parent's card and the admin view

**Evidence.**

- The student list is bounded by `homework_lookahead_days` (0004) and computes Done in TypeScript (`src/lib/server/homework-status.ts`, which scans the full history).
- FR-6 defines Open as "not Done and not archived", with no look-ahead.
- CAP-7's admin completion view is a third consumer.

**Suggested fix.** Add a Consistency Convention: one shared per-student homework-state definition (a single SQL function such as `student_homework_summary(student_id)`, or the single TS module) used by the student page, the parent card and the admin dashboard. Decide whether the look-ahead applies to the counts.

### M7. Which "teacher notes" parents can see is undecided

**Evidence.** Both `skill_status_history.notes` and `attendance_records.notes` exist (0003). RLS is row-level, so the attendance rows granted to parents under AD-12 also expose attendance notes. The PRD only relabels "the notes field" on the teacher side.

**Suggested fix.** Name the parent-visible notes columns in AD-12. If attendance notes stay teacher-only, give parents attendance through a `security_invoker` view without `notes`, or through column privileges, and label every parent-visible notes field in the UI.

---

## Low

- **L1. AD-4 presents its helper list as complete.** It omits the existing `is_enrolled_in_class`, `is_teacher_of_student` and `is_targeted_for_homework_*`. *Fix:* list them, or say "the shared helpers in migrations, including …".
- **L2. The Structural Seed says `CLASS_SESSIONS` are "written only by DB triggers".** But `add_extra_session()` and `set_class_schedule()` (0019) are client-invoked security-definer RPCs. *Fix:* reword as "written by triggers and admin/teacher security-definer RPCs; no direct client insert or delete".
- **L3. AD-12 lists the leaderboard among functions keyed on `auth.uid()`.** `team_leaderboard()` (0009) takes no arguments and never reads `auth.uid()`. *Fix:* drop it from that list. The parent only needs the child's `team_id` through `profiles` (H3).
- **L4. The enum and check-constraint mechanics aren't mentioned.** Adding `parent` to `user_role` must be its own migration before first use (the 0001 comment warns about this). `profiles_student_fields_check` must be extended with `parent_id`. *Fix:* add a one-line note under AD-4.
- **L5. Structural dimensions left open.**
  - There's no error-shape convention. The code mixes "RLS filters to zero rows" (updates) with raising `42501` (`class_people`, `add_extra_session`).
  - There's no verification convention, although `src/lib/server/rls.spec.ts` is the natural enforcement check for AD-2, AD-12, AD-13 and AD-14.
  - Week bucketing is unspecified: the streak's "today's week" is pinned to UTC (0007) while the conventions say Europe/Berlin.

  *Fix:* add Consistency Convention rows for all three.
- **L6. SM-2 (parent adoption) can't be measured for dual-role logins.** `auth.users.last_sign_in_at` doesn't say which role signed in. *Fix:* list under Deferred, or note an optional `parents.last_seen_at` stamp.
- **L7. FR-5 change-request validation isn't covered by AD-11.** A student must be able to check that the new guardian email belongs to an approved parent without reading `parents`. *Fix:* route it through the same security-definer found/not-found check, and note the anti-enumeration stance (the risk FR-3 already accepts).

## Coverage matrix

| Item | Architectural implication | Covered by | Gap |
| --- | --- | --- | --- |
| CAP-1 / FR-3 | Parent-gated registration, synthetic email | AD-10, AD-11 | H1, C1 |
| CAP-2 / FR-7 notes | Parents can read notes | AD-12 | H3, M7 |
| CAP-3 | Parent homework read | AD-12 | H3 (targeting helpers), M6 |
| CAP-4 / FR-9, FR-10 | Leave-aware streak | AD-3, AD-13 | M1, M3 |
| CAP-5 | Parent reads badges | AD-12 | none |
| CAP-6 | Child's team and leaderboard | AD-4, AD-12 | L3 |
| CAP-7 / FR-2 | Admin approves parents and email changes | AD-4, map | H4 |
| CAP-8 / FR-11 | Parent-submitted deletion, audit | AD-9 | M5 |
| CAP-9 / CAP-10 | Adopted calendar | map, Seed | L2, M4 |
| CAP-11 / FR-8, FR-10 | Leave storage, Sick masking, auto-approval | AD-13, AD-14 | M1, M2, M4, H5 |
| CAP-12 / FR-1, FR-4 | `parents` table, dual role, link | AD-4, AD-10 | C1, H2, H4 |
| CAP-13 / FR-6, FR-7 | Parent read path | AD-12 | H3, H5, M6 |
| FR-5 | Guardian email change | AD-10 | L7 |
| FR-12 | My Profile, i18n | Paraglide convention, Supabase Auth | none (no architectural gap) |

## What the spine gets right

- The stored FK link (AD-10) instead of a live email match, and synthetic pending emails (AD-11). Together they remove the sibling/parent unique-email collision that `join/+page.server.ts` documents today.
- Parent capability as a separate approved `parents` row rather than overloading `profiles.role` is the right shape for dual roles, and "RLS evaluates the union" is clear.
- Classifying leave with a trigger (AD-13), the single streak path (AD-3), and pg_cron only for truly time-based work all match the existing precedents (0005, 0007).
- Sick masking through a single security-definer read (AD-14) follows the `class_people` and `team_leaderboard` precedent.
- The Deferred list is honest and consists of product questions. None of its items would let two units diverge on their own.
