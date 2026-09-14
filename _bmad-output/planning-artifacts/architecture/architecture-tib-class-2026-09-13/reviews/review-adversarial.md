---
name: 'Adversarial Review — Architecture Spine'
type: architecture-review
lens: adversarial
target: ARCHITECTURE-SPINE.md
sources:
  - '../ARCHITECTURE-SPINE.md'
  - '../../../../specs/spec-class-tracker/SPEC.md'
  - '../../../../specs/spec-class-tracker/stories.yaml'
  - '../../../../specs/spec-class-tracker/gamification.md'
  - '../../../../specs/spec-class-tracker/homework-workflow.md'
  - '../../../../specs/spec-class-tracker/roles-and-permissions.md'
status: draft
created: '2026-09-13'
---

# Adversarial Review — Class Tracker Architecture Spine

## Method

For each finding below, I construct two units one level down (two stories, or two
components/functions inside one story) that each satisfy every AD in
`ARCHITECTURE-SPINE.md` to the letter, then show a concrete way their independently-valid
implementations collide: a shared-data-shape mismatch, dual ownership of one entity, a
race the spine's rules don't close, an RLS gap, or a boundary stated in prose but not
made enforceable by any AD or RLS policy. Each finding ends with a recommended fix,
framed as a new/tightened AD or a Consistency-Conventions/Deferred addition.

---

## Finding 1 — Two legitimate "server-side function" designs for the same sidecar, with different failure modes

**Pair:** Story 5 (streaks) vs. Story 6 (badges) sidecar implementations.

**Each obeys:** AD-3 only says the write must come from "a server-side function (a
Postgres function/trigger or a Supabase Edge Function)" — it does not say which. The
spine's own diagram shows two legal invocation paths: `DB -- triggers on write --> FN`
and `Client -- invoke (compute/award) --> FN`.

- Story 5 could legitimately be built as a **DB trigger** on `attendance_records` /
  `homework_status_history` insert — synchronous, same transaction, always fires.
- Story 6 could legitimately be built as an **Edge Function the client invokes** after a
  successful Done/attendance write — also fully AD-3-compliant, since the client never
  writes `badges_earned` directly.

**Clash:** The two derived tables now have different consistency guarantees for what is
conceptually the same event class (a Done/attendance write). The trigger-based streak is
atomic with the underlying write; the client-invoked badge award is not — a client that
crashes, is offline for a beat, or simply never calls the invoke (buggy PWA build, or a
tampered client that writes the Done row but skips the badge-award call, which AD-3
cannot prevent since it only constrains *who writes `badges_earned`*, not *whether the
award is triggered at all*) leaves a student permanently missing an earned badge with no
compensating mechanism. Two developers, two stories, two silently different reliability
guarantees for two derived tables that a parent/teacher will expect to be equally
trustworthy.

**Recommended fix:** Tighten AD-3 to specify *how* the sidecar is invoked, not just who
writes: "Every derived-state write in AD-3's scope must be triggered by a DB trigger on
the underlying table, never solely by a client-initiated Edge Function invoke on the
happy path." (An Edge Function is fine for backfill/admin recompute, but must not be the
only path to a correct value.)

---

## Finding 2 — Streak/badge counting logic can disagree with AD-5's own "current row" definition

**Pair:** Story 3/homework-workflow's Done-marking paths ("student self-reports, **or** a
teacher marks it done on the student's behalf") vs. Story 5/6's counting queries.

**Each obeys:** AD-5 says history is append-only and "current" is the latest row by
timestamp for a (student, subject) pair — this is satisfied whether one or two Done rows
exist for the same (student, instance). `homework-workflow.md` explicitly allows *both*
the student and a teacher to independently insert a Done transition for the same
instance (a young child who can't use the app). Both actors' inserts are individually
AD-2/AD-4/AD-5-compliant RLS-gated appends.

**Clash:** If Story 6's badge-milestone counter (or Story 5's streak evaluator) is
written as `COUNT(*) FROM homework_status_history WHERE student_id=X AND status='Done'`
rather than `COUNT(DISTINCT instance_id) FROM (latest-status-per-instance) WHERE
status IN ('Done','Reviewed')`, the double-insert scenario the spec itself sanctions
(student marks Done, then teacher also marks it Done in class, both legitimate)
inflates the count by one extra completion that never happened. This is a shared-data-shape
clash between the append-only convention (AD-5) and any story that queries the history
table as if it were a fact table of distinct events rather than a versioned-current-value
log.

**Recommended fix:** Add to Consistency Conventions: "Any derived count/streak read over
an AD-5 append-only history table must first collapse to one current row per (student,
subject-or-instance) key before counting or aggregating — raw `COUNT(*)`/`SUM(*)` over
the history table is never a valid basis for a computed/awarded value." Consider naming
this as a single canonical view (e.g., `current_homework_status`, `current_skill_status`)
that Stories 5/6/7 are required to read from, rather than each writing its own collapse
logic.

---

## Finding 3 — No enforceable boundary between "teacher creates a one-off instance directly" and "only the sidecar may create recurring instances"

**Pair:** Story 3's direct-lane homework creation vs. Story 4's recurrence-generation
sidecar function.

**Each obeys:** The capability map lists `homework_instances` under the *direct-lane*
tables for CAP-3 ("`homework_assignments`, `homework_instances`, `homework_status_history`
(direct-lane)"), which Story 3 needs — a one-off assignment's single instance is plainly
not "computed," so a teacher inserting it directly satisfies AD-3 (nothing computed is
being forged). AD-3 separately binds "CAP-3 (recurring generation)" to sidecar-only
writes. Both rules, read literally, are simultaneously true of the *same table*.

**Clash:** AD-3's sidecar-only rule for recurring generation has no way to be enforced by
RLS, because RLS policies are "keyed on the authenticated user's identity/role" (AD-2/AD-4)
— not on whether the *parent assignment* (`homework_assignments.is_recurring`) says this
instance should have come from the generator. A teacher's client, fully within its
granted role, can INSERT an extra `homework_instances` row for a period that the
recurrence function already generated (accidental double-click, or a client bug), and no
policy in the spine's model blocks it — producing two "independent" instances for one
period, violating homework-workflow.md's "each generated instance has its own independent
Done/Reviewed status... completing one instance never marks future instances done" (which
implicitly assumes exactly one instance per period per assignment).

**Recommended fix:** Either (a) add a DB constraint (unique on
`(assignment_id, period_start)`) that is trivially enforceable regardless of who writes,
turning the ambiguous RLS boundary into a hard schema invariant, or (b) tighten AD-3 to
require that `homework_instances` INSERT is *never* direct-lane — even the one-off case
goes through a `create_homework_assignment()` function that creates the assignment and
its first instance together — removing the direct/sidecar table-sharing ambiguity
entirely.

---

## Finding 4 — "Editing a series never touches past instances" has no data-shape guarantee

**Pair:** Story 3 (built first, no recurrence concept yet) vs. Story 4 (edits/ends a
series).

**Each obeys:** Nothing in the spine's Deferred column-level-schema note or AD-5 says
whether `homework_instances` must **snapshot** the parent assignment's title/due-date-offset/
links at generation time, or may simply FK-join and read them live from
`homework_assignments`. Story 3, built before recurrence exists, has every reason to pick
the simpler live-join design (DRY, no duplication) — it fully satisfies every AD.

**Clash:** homework-workflow.md requires "editing the series (title, links, due-date
offset)... only affects instances going forward; past instances are untouched." If
`homework_instances` live-joins to `homework_assignments` for display (Story 3's natural
design), then Story 4 editing the assignment row retroactively changes what every past
instance shows — a direct violation the spine's Deferred note explicitly disclaims
responsibility for ("Column-level schema... is seed, owned by migrations, not this
spine") while simultaneously making it Story 4's problem to *undo* a Story 3 decision
after the fact ("do not special-case recurring instances in a way that breaks Story 3's
streak/review reads" — but nothing said not to break Story 3's *schema* assumption).

**Recommended fix:** Add an explicit Consistency Convention: "Any entity generated from a
mutable parent template (recurring homework instances now; anything similar later) must
snapshot the fields that participate in per-period identity/display at generation time —
never live-join to the mutable parent for historical display." This belongs in the spine,
not deferred to Story 3's migration, precisely because Story 3 has no way to know Story 4
needs it.

---

## Finding 5 — Mutable, non-append-only tables have no concurrency story, despite an explicit SPEC constraint

**Pair:** Two teachers concurrently editing `homework_assignments` (Story 3/4) vs. two
teachers concurrently editing `class_teachers`/`team_members` (Story 1/7).

**Each obeys:** AD-5's "history-as-append" rule is scoped explicitly to three tables:
skill-status, homework Done/Reviewed transitions, and attendance. Every other mutable
table (`homework_assignments` title/due-date/links, `team_members` assignment,
`class_teachers`) is fair game for a plain `UPDATE`, which is a perfectly literal reading
of AD-5 (it doesn't bind those tables) and AD-1 (direct CRUD via the SDK).

**Clash:** SPEC.md's Constraints section states: "Must tolerate two teachers editing the
same class concurrently without clobbering each other's updates." AD-5 only delivers this
guarantee for the three tables it names. A plain `UPDATE homework_assignments SET
due_date = ... WHERE id = ...` from two teachers racing has ordinary last-write-wins
semantics with zero optimistic-concurrency check (no version/updated_at guard specified
anywhere) — one teacher's due-date change silently clobbers the other's. This is exactly
the SPEC-level guarantee the architecture claims to deliver but only partially covers.

**Recommended fix:** Either broaden AD-5 to state a general rule ("any field two teachers
of the same class can both edit is either append-only, or protected by an optimistic
`updated_at`/version check that surfaces a conflict rather than silently overwriting"), or
add a new AD explicitly enumerating which mutable tables get optimistic-concurrency
guards and which are judged low-risk enough to skip (and why).

---

## Finding 6 — "Teams fixed for the school year" is a prose rule with no enforcement path

**Pair:** Story 7's team-assignment write path vs. Story 7's leaderboard read path (same
story, two components) — and by extension any later admin/teacher screen that touches
`team_members`.

**Each obeys:** The capability map assigns `team_members` to "direct-lane assignment,"
governed by AD-2/AD-3. AD-2 only requires that *some* RLS policy gate writes by
identity/role — a policy letting "any teacher of the student's class INSERT **or UPDATE**
`team_members` for their own students" is fully AD-2/AD-4-compliant. Nothing in the spine
distinguishes "initial assignment at approval time" (explicitly in-scope, including
mid-year joins) from "reassignment of an already-placed student" (explicitly out of
scope: "no reshuffling mid-year," "no auto-balancing or randomization").

**Clash:** Because the leaderboard's combined-streak metric is computed live from current
`team_members` rows (per the capability map: "rank computed by sidecar/**read view**"),
any UPDATE to an existing student's team — accidental (teacher fat-fingers the picker on
the wrong row) or deliberate — silently moves that student's entire accumulated streak
history into the new team's combined total for past-earned weeks that happened under the
old team. No RLS policy, AD, or DB constraint in the spine prevents the write; the
"fixed for the year" rule exists only as a sentence in `gamification.md`.

**Recommended fix:** Add a DB-level guard (e.g., an UPDATE-blocking trigger/RLS `USING`
clause on `team_members` that rejects changing `team_id` once set, requiring an explicit
admin-only override path with its own audit row) and reference it from AD-3 or a new
AD-9 ("business rules stated as immutable in SPEC.md must be backed by a DB constraint,
not left as a UI-only affordance").

---

## Finding 7 — Recurrence-generation timing is deferred as "an implementation detail" but is actually a cross-story ordering constraint

**Pair:** Story 4's recurrence-generation scheduling (cron vs. Edge Function, explicitly
Deferred) vs. Story 5's streak evaluator, which needs "this week's homework instance" to
exist before it can be marked Done.

**Each obeys:** The Deferred section is explicit: "Recurring-assignment scheduling
mechanism (`pg_cron` vs. a scheduled Edge Function) — an implementation detail for Story
4, not an architectural invariant." Story 4 is free to schedule generation however it
likes and still be spine-compliant.

**Clash:** If generation runs on a schedule that lags a given class's actual meeting time
(e.g., a Monday cron tick generating "this week's" instance, for a class that met the
prior Sunday), students who attended and would have marked homework Done have no
instance to mark Done against for that week — the streak evaluator (Story 5) sees "no
Done row this week" and cannot distinguish "week had no homework to do" from "week had
homework, not done," silently breaking streaks for a class that did everything right.
This is not an implementation detail internal to Story 4 — it is a timing contract between
Story 4 (when instances must exist) and Story 5 (what "no row" means), and the spine
explicitly disclaims owning it.

**Recommended fix:** Elevate one sentence out of Deferred into an AD or Consistency
Convention: "A recurring homework instance for period N must exist and be visible to
students before period N's class session, independent of the chosen scheduling
mechanism," and define what a streak evaluator must do when a period had zero homework
instances (vacuously satisfied vs. undefined/skip week) — currently unspecified in
gamification.md too.

---

## Finding 8 — Story 1's approval RLS may not carry the admin-backup clause Story 8 is told to "reuse, not parallel-path"

**Pair:** Story 1's registration-approval mechanism vs. Story 8's admin backup-approve
reuse instruction.

**Each obeys:** AD-2/AD-4 only require that *an* RLS policy gates the approval action by
identity/role via `profiles`/`class_teachers`. A Story 1 implementation scoped tightly to
"a teacher assigned to the class may approve a pending student in that class" is fully
compliant and passes every Story 1 acceptance check (spec_checkpoint, done_checkpoint) —
CAP-7's admin-backup-approve is CAP-7/Story 8 territory, not tested by Story 1.

**Clash:** Story 8's `invoke_dev_with` explicitly requires reuse: "The admin
backup-approve capability shares its mechanism with Story 1's teacher-approval flow —
reuse it rather than building a parallel path." But nothing in the spine obligates Story 1
to write its RLS policy (or approval RPC) with the `role = 'admin' OR (role = 'teacher'
AND assigned-to-class)` OR-clause from day one. If Story 1 ships the narrower
teacher-only policy (which is what its own acceptance criteria demand), Story 8 is
structurally forced into exactly the "parallel path" its instructions forbid, or into a
retroactive RLS-policy edit against an already-shipped, checkpointed story.

**Recommended fix:** Add to AD-2 or AD-4 a forward-looking requirement: "Every RLS policy
gating an action that CAP-7 (admin) is documented to also perform must include the admin
role in its authorization check from first implementation, even if the story that ships
the admin path lands later." This converts an inter-story sequencing risk into a
day-one rule Story 1 can't miss.

---

## Finding 9 — RLS keyed on "role" is not fine-grained enough to stop a student from self-declaring `Reviewed`

**Pair (within Story 3):** the student-write RLS policy vs. the teacher-write RLS policy
on `homework_status_history`.

**Each obeys:** AD-2 states policies are "keyed on the authenticated user's
identity/role." A policy "students may INSERT into `homework_status_history` for their
own `(student_id, instance_id)`" and a separate policy "teachers of the class may INSERT
for any student in the class" are each, individually, a completely literal implementation
of AD-2 — role-keyed, identity-checked, no frontend-only gating.

**Clash:** Read together, if the student policy does not also constrain the *value* being
inserted (`status = 'Done'` only), a student can legally INSERT a row with
`status = 'Reviewed'` for themselves — self-declaring teacher-confirmed mastery, which
directly contradicts homework-workflow.md's state machine ("`Reviewed` (teacher confirms
in class)") and feeds fabricated data into skill-status history (CAP-2's continuity
guarantee) and into any future skill-mastery reporting. AD-2's literal text ("keyed on
role") is satisfied by a policy that checks role but not row content, so this gap survives
a compliant-by-the-letter build.

**Recommended fix:** Tighten AD-2 (or add a note under Consistency Conventions) to require
that RLS policies on state-machine columns be keyed on **(identity/role, and the specific
transition/value being written)** wherever a table encodes more than one actor's allowed
values — not role alone. Concretely for Story 3: `CHECK`/RLS clause restricting
`status = 'Reviewed'` inserts to rows where the actor is a teacher of that class.

---

## Finding 10 — Deletion cascade vs. "audit trail of the approval": the two requirements can't both apply to the same row

**Pair:** Story 8's deletion-cascade function vs. Story 8's own admin-approval audit
requirement (two components of one story, drawn from two different sources).

**Each obeys:** CAP-8's success criterion is unqualified: "once approved, all of that
student's records are gone." The ERD draws `PROFILES ||--o{ DELETION_REQUESTS : "submits"`
— i.e., `deletion_requests` is one of the student's own records. A cascade function that
deletes every table FK'd to the departing `profiles.id`, including `deletion_requests`,
satisfies CAP-8's success criterion to the letter. Separately, Story 8's
`invoke_dev_with` requires: "leave an audit trail of the approval." A cascade that
*preserves* the `deletion_requests` row (with its `approved_by`/`approved_at` fields)
satisfies that instruction to the letter.

**Clash:** These are the same function acting on the same row, and they cannot both be
literally true — either the deletion-request/approval record is erased (no audit trail
survives the very deletion it authorized) or it is kept (violating "all of that student's
records are gone" as drawn in the ERD, and leaving a dangling/nullable FK to a
just-deleted `profiles` row that AD-3's "computed state" rule never anticipated needing to
handle).

**Recommended fix:** Add an explicit carve-out to AD-3 or Deferred: the deletion-cascade
function must write a *de-identified* audit record (e.g., a separate
`deletion_audit_log` table not FK'd to `profiles`, storing only
`{deleted_at, approved_by, approving_admin_id, class_id}` with no student-identifying
fields) before erasing the student's row, and CAP-8's "all records gone" should be
reworded to explicitly exclude this de-identified log — otherwise every future
implementer has to invent this reconciliation themselves, and two different Story 8
attempts could reasonably land on incompatible answers (one preserves PII in the name of
audit; one destroys the audit in the name of erasure — both are GDPR-relevant failure
modes, and SPEC.md's own Open Questions flag GDPR obligations as unresolved).

---

## Finding 11 — Deletion cascade and team leaderboard: no stated owner for "who updates the aggregate when a member is deleted"

**Pair:** Story 7's leaderboard combined-streak computation vs. Story 8's deletion-cascade
function.

**Each obeys:** The capability map assigns CAP-6's rank to "sidecar/read view" (Story 7,
AD-3) and CAP-8's cascade to "deletion-cascade function (sidecar...)" (Story 8, AD-3).
Both are legitimately "the server-side function" AD-3 requires for their respective
capability — there is no rule saying which of the two owns keeping the OTHER's derived
output correct after a cross-cutting event like a student deletion.

**Clash:** If Story 7 implemented combined-streak as a **materialized** aggregate
(a reasonable, AD-3-compliant choice for performance, since the spine only says
"sidecar/read view" — leaving the choice open), then deleting a team member's
`student_streaks` row via Story 8's cascade leaves the materialized team total stale
unless Story 8's cascade function *also* knows to call Story 7's recompute path. Nothing
in AD-3 or the capability map assigns this responsibility to either story, so a
by-the-book Story 8 implementer who only deletes rows in the tables CAP-8 lists (profile,
progress, homework records) can ship a fully compliant cascade that leaves a phantom
student silently propping up their former team's leaderboard rank indefinitely.

**Recommended fix:** State in the spine which of the two designs Story 7 must use (a live
read view removes the problem entirely, since there is nothing to go stale), or, if a
materialized table is chosen for performance, add a line to AD-3: "Any function that
deletes or mutates a row feeding a materialized derived aggregate (streaks, badges,
leaderboard) must itself invoke that aggregate's recompute path in the same transaction —
derived aggregates are never allowed to go stale by omission."

---

## Finding 12 — No canonical computation source for "attendance count" / "homework-done count" shared across three stories

**Pair:** Story 5 (streak: needs "consecutive weeks with attendance AND Done") vs. Story
6 (badges: needs "attendance count" and "homework-done count" milestones).

**Each obeys:** Column-level schema is explicitly Deferred ("owned by migrations once
written, not this spine"). Each story is free to write its own SQL against
`attendance_records`/`homework_status_history` and still be fully AD-3/AD-5-compliant —
the sidecar writes the derived table, nobody direct-writes it, history stays append-only.

**Clash:** Story 5 will have already fixed real-world semantics for "did this student
attend this week" and "did this student complete homework this week" (e.g., handling the
double-Done-insert case from Finding 2, handling weeks with no generated instance from
Finding 7) by the time Story 6 is built. If Story 6 reimplements its own "count of Done"
query independently rather than calling Story 5's already-hardened logic, the two derived
numbers shown to the same student (streak length vs. badge progress) can disagree on the
same underlying facts — e.g., a corrected/re-marked attendance row that Story 5's streak
logic knows to de-duplicate but Story 6's badge counter naively sums twice.

**Recommended fix:** Add a Consistency Convention: "Any two derived-state computations
(streak, badge, leaderboard) that read the same underlying append-only table must call a
single shared function/view for that table's 'current facts,' never independently
reimplement the collapse/count logic." Name the shared views/functions expected
(`current_attendance`, `current_homework_status`) as seeds for the Story 5 migration to
establish, so Story 6/7 have something documented to reuse instead of guessing.

---

## Summary of Recommended Spine Changes

| # | Finding | Fix type | Target |
|---|---|---|---|
| 1 | Trigger vs. client-invoke sidecar reliability gap | Tighten AD-3 | AD-3 |
| 2 | Raw COUNT over append-only history double-counts legitimate dual inserts | New Consistency Convention | Conventions |
| 3 | No enforceable boundary between direct one-off instance and sidecar-only recurring instance | Tighten AD-3 + DB constraint | AD-3 |
| 4 | Live-join vs. snapshot for generated instances | New Consistency Convention | Conventions |
| 5 | No concurrency story for mutable non-append-only tables | Broaden AD-5 or new AD | AD-5 / new AD |
| 6 | "Teams fixed for the year" unenforced | New AD (DB-level guard) | New AD-9 |
| 7 | Recurrence-generation timing vs. streak week semantics | Un-defer into AD/Convention | AD / Deferred |
| 8 | Story 1 approval RLS may omit admin OR-clause Story 8 needs | Tighten AD-2/AD-4 | AD-2 or AD-4 |
| 9 | Role-only RLS insufficient to block student self-marking Reviewed | Tighten AD-2 | AD-2 |
| 10 | Deletion cascade vs. audit-trail requirement contradict on the same row | New Deferred/AD-3 carve-out | AD-3 / Deferred |
| 11 | No owner for leaderboard aggregate staleness on member deletion | Tighten AD-3 | AD-3 |
| 12 | No canonical computation source shared across streak/badge/leaderboard | New Consistency Convention | Conventions |

Every finding above is constructed so that each of the two units in the pair is, on its
own, a straightforward and even natural reading of the spine's current ADs — the risk is
not that an implementer will misread a rule, but that two correct readings of the same
rule set can diverge. The streak/badge/leaderboard chain (Findings 1, 2, 6, 7, 11, 12) is
the densest cluster and the one most worth resolving before Story 5 starts, since Stories
5–7 all read/write overlapping derived state and Story 5 ships first, fixing conventions
the later two will inherit whether or not they were told to.
