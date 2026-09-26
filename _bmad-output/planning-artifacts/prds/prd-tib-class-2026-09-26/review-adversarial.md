# Adversarial Review: PRD Parent Role (2026-09-26)

Reviewed: `prd.md`, `addendum.md` against `specs/spec-class-tracker/` (SPEC.md, roles-and-permissions.md, calendar.md, gamification.md). Checked against migrations 0002, 0003, 0006, 0007, 0009, 0016.

**Verdict:** Not ready for architecture. The read-only visibility idea holds up. The leave and streak rules, the migration of existing students, and the notes and Sick privacy model are underspecified or contradict each other. Several of these would ship privacy regressions for minors.

Counts: critical 3, high 5, medium 4, low 1.

---

## F1. CRITICAL: "Sick" is health data about a minor and the visibility rule broadcasts it to classmates and the team
**Location:** §4.3 FR-8 (visibility), FR-10, §8.
**Problem:** FR-8 keeps leave visible to "the class's Teachers, the Admin, classmates, and the child's Team". Calendar.md already shows the state (nickname + state) to classmates and to the team across classes. FR-10 adds a Sick state and never says who can see it. Read literally, every classmate and team member sees "Pema: Sick". Under GDPR Art. 9, "sick on date X" is health data. For a minor it is special-category data and needs an explicit legal basis. §8's "no medical detail is collected" does not help: the label itself is the medical detail. The existing SPEC open question on team-wide leave visibility makes the problem worse.
**Fix:** Add an FR: to anyone other than the class's Teachers, the Admin and the Parent, Sick shows only as "On leave". Decide whether the child themself sees "Sick". Add the Art. 9 question to §10 Q1. Add calendar.md visibility to §5.

## F2. CRITICAL: Existing approved students have no Parent, and the PRD removes the only way to set their leave
**Location:** §4.1 FR-3/FR-4, §4.3 FR-8 ("Student-side control is removed"), §5, §7.
**Problem:** The school already runs with approved students (migration 0006 stores `profiles.guardian_email` for them). FR-3 only covers new registrations. Nothing in the PRD covers:
- Whether existing students auto-link when a Parent later registers with a matching email. The Glossary's live email-equality definition implies they do, silently.
- What happens when a stored guardian email never matches a Parent because of a typo, a different address, or a family that never signs up.

FR-8 removes the Student control on day one, so every unlinked student loses leave entirely. Their announced absences then become unannounced and consume grace, which is a direct regression. The FR-2 assumption ("no Student can exist yet to match against") is also false for this whole population.
**Fix:** Add a "Migration of existing students" feature. Pick one of two rules: existing students auto-link on email match only after the Admin confirms, or the Student control stays until the child has an approved Parent. State which. Rewrite the FR-2 assumption.

## F3. CRITICAL: Existing teacher notes get exposed retroactively, and free-text notes can name other children
**Location:** §4.2 FR-7 ("Teacher notes... are written for the Parent"), §5 CAP-2 bullet, §8.
**Problem:** Notes live today in `skill_status_history.notes` and `attendance_records.notes` (0003). They were written under the contract "teacher-only, class-scoped". FR-7 publishes every historical note to Parents. Teachers wrote those notes without knowing parents would read them, and they are free text that can mention other children ("argued with Lobsang"). That directly breaks FR-7's own consequence "sees no other Student's personal details". The PRD also doesn't say which notes are meant: skill notes, attendance notes, or a new note type. "The teacher-side label should say so" is not a requirement anyone can test.
**Fix:** Pick one of two rules: only notes written after launch are shown, or notes get a per-note "visible to parent" flag that defaults off. Name the note sources explicitly. Add a testable consequence: before saving a note, the teacher is told it is visible to the parent. Tell teachers in the UI not to name other students.

## F4. HIGH: The PRD's notion of a "set" time can be gamed and breaks when the notice period changes
**Location:** §4.3 FR-8 ("change... any number of times"), FR-9, Glossary "Planned Leave".
**Problem:** Planned vs Short-Notice depends on "when it was set", but answers can be edited freely. Three cases are undefined:
- **Toggling:** a parent marks On leave 3 weeks ahead, switches to Coming, then back to On leave 2 days before. Is that Planned? If the first-set time counts, a parent can blanket-mark every session On leave months ahead and flip to Coming when attending. That makes every absence Planned and the notice rule worthless.
- **Notice period changes:** streaks are fully recomputed from history on every trigger (0007). If the Admin changes 2 weeks to 3, every past leave is reclassified on the next recompute and existing streaks break retroactively. Nothing says whether the period is snapshotted when the leave is set.
- **Sessions created or moved inside the window:** extra sessions and time changes (CAP-10) can appear less than 2 weeks ahead. Leave for them can never be Planned, so the family is penalized for the school's scheduling.

**Fix:**
- Record every leave change, and classify by the timestamp of the latest transition into On leave.
- Classify once, when the leave is set, and store the result so later setting changes don't reclassify it.
- Sessions created or rescheduled inside the notice window get Planned automatically (or use their creation time as the reference).

## F5. HIGH: Sick timing crosses the streak week boundary and has no deadline for the teacher's decision
**Location:** §4.3 FR-10 plus its [ASSUMPTION], gamification.md.
**Problem:** Sessions are on Sunday. Streak weeks are ISO weeks starting Monday (`date_trunc('week', session_date)`, 0007). The Sick window ends Monday 23:59, which is in the next streak week. Today the recompute runs only on attendance and homework inserts, so leave decisions don't trigger it. Nothing says a decision recomputes the earlier week. Pending Sick "does not protect", and there is no deadline for the teacher. The child's streak and the team's leaderboard total (0009 `team_leaderboard` sums streaks) can show a reset for weeks and then jump back. With grace 2, two pending Sick weeks can wipe a streak that should survive. The PRD also doesn't say what happens to Sick marked on a session where the teacher recorded the child present, or to Sick after a Short-Notice leave on the same session.
**Fix:**
- Define the state machine for each session answer: Coming, On leave, Sick-pending, Sick-approved, Sick-rejected. List the allowed transitions and cut-off times.
- Give the teacher's decision a deadline. Either auto-approve after N days, or treat a pending Sick as protecting until it is rejected.
- Require that approving or rejecting recomputes the affected student's streak.
- Block Sick when attendance is marked present.

## F6. HIGH: "Sick at any time before the session" is a loophole around the notice rule, and teachers have nothing to judge
**Location:** §4.3 FR-10 ("from any time before it... regardless of notice"), [ASSUMPTION] no reason collected.
**Problem:** A parent who misses the 2-week notice can mark Sick for next Sunday instead. With approval, the notice rule no longer applies. Teachers must approve or reject with no reason and no information, so the decision comes down to trust or mood. It is inconsistent across teachers and can't be tested. The two assumptions (no reason collected, teacher approves) contradict each other in practice.
**Fix:** Allow Sick only from N hours before the session start (for example, from the Saturday before) until the end of the day after. Either drop teacher approval and cap Sick weeks per term, or state the criteria teachers use to approve or reject.

## F7. HIGH: The Parent lifecycle beyond Pending is missing: deactivation, the parent's own erasure, and fraud
**Location:** §4.1 FR-2, §4.4 FR-11, §6, §10 Q3/Q4.
**Problem:**
- FR-2 covers approve and reject for Pending Parents only. There is no way to revoke an approved Parent: the wrong person was approved, a custody or safeguarding issue, a compromised account.
- There is no path for a Parent to delete their own account, even though that is an adult's GDPR Art. 17 right. Q3 leaves the account orphaned with no rule when the children leave.
- Since leave is now set only by the Parent, revoking or deleting a Parent leaves the children with no one who can set leave at all.
- FR-4 shows a Pending child on the Parent's landing page. When a stranger registers a child using a known Parent Email, the Parent sees it but has no "not my child" action.

**Fix:**
- Add FRs for Admin deactivation of an approved Parent, and for the Parent requesting deletion of their own account.
- Define what the linked children become when their Parent is deactivated or deleted. The FR-5 reassignment process could cover this.
- Add a "not my child" flag on a Pending child that routes to the teacher and Admin.

## F8. HIGH: The multi-class enrollment model is ignored; the PRD assumes one class per child
**Location:** §4.2 FR-6 ("the child's name, class"), FR-7 ("the child's class", "Teachers assigned to the child's class"), FR-10 ("a Teacher of the class").
**Problem:** Since 0016, a student can be in several classes (`class_enrollments`), with one streak and one team per student. The PRD assumes a single class throughout. Several things are undefined:
- Which class the card shows.
- Which teachers are listed.
- Which class's teacher approves Sick for a given session.
- How leave on a class-A session combines with attendance at class B in the same week.

Streaks are weekly, and attending any session qualifies the week (SPEC assumption). So Short-Notice leave on one session in a week where the child attended another session should cost nothing, yet the PRD says the week "consumes one grace week". The PRD also never says whether a Planned-leave week is neutral or still requires homework Done.
**Fix:** Rewrite FR-6, FR-7 and FR-10 in terms of the child's classes and sessions: Sick is decided by a teacher of that session's class. Define a week's streak outcome as a function of all its sessions: present at any session qualifies, and leave matters only if no session was attended. State whether homework Done is still required in a Planned-leave week.

## F9. MEDIUM: FR-7 contradicts itself about other children's data
**Location:** §4.2 FR-7 consequences, §8.
**Problem:** "Sees exactly what the child can see" includes classmates' and team members' leave states (calendar.md: visible to classmates and the team) plus the leaderboard. The next consequence says "no other Student's personal details beyond what the leaderboard already shows". Both can't be true. Nicknames plus leave or Sick states of other children are more than the leaderboard shows (0009 returns team totals only).
**Fix:** Pick one rule. Recommended: the Parent sees the team leaderboard (team totals) and only their own child's leave, never other children's attendance intent. Say so explicitly.

## F10. MEDIUM: The FR-3 error message reveals which emails belong to school families
**Location:** §4.1 FR-3, UJ-1 edge case.
**Problem:** The registration page answers "no parent account found" or proceeds. Anyone holding the class code can use it to test whether an email belongs to an approved Parent, which tells them the email is linked to a child at this school. Registration is public and unauthenticated.
**Fix:** Rate-limit the check. Consider asking the class code first, so the check is gated. Record this as an accepted risk or add a consequence: the check doesn't run until a valid class code is entered, and it is rate-limited per IP.

## F11. MEDIUM: §5 "Changes to the Existing Spec" misses several spec clauses the PRD contradicts
**Location:** §5.
**Problem:** §5 leaves these out:
- **SPEC Assumption** "Leave protects a streak only when set before the session starts". Sick Leave until the day after contradicts it.
- **SPEC Constraint** "requires... a confirmed guardian email... Approval is blocked until the guardian confirms". Needs rewording for the parent-first flow.
- **SPEC Constraint** "a missed session with an announced leave does not consume grace", and **CAP-11 success** "an announced leave does not consume streak grace". Both are now false for Short-Notice leave.
- **CAP-11 intent** "A student marks each upcoming session". The owner changes.
- **calendar.md:** the Attendance intent layer owner is "Student", the states list lacks Sick and the approval state, and the before-start rule.
- **roles-and-permissions.md:** not mentioned at all. It needs a Parent row in the roles table, the "Parent view is deferred" line removed, registration steps 3–4 rewritten, and "Only the admin has cross-class visibility" reconciled with a Parent of children in several classes.
- **CAP-7:** the Admin gains Parent approval and deactivation, and the Guardian Email Change queue.
- **CAP-8 success** "all of that student's records are gone": now also covers leave, Sick decisions, guardian change requests and the parent link.
- **SPEC Open Questions:** the date-range leave question gets more pressing, since a parent marking a month-long trip session by session is the UJ-3 journey.

**Fix:** Add each of these to §5.

## F12. MEDIUM: Deletion side effects are unspecified
**Location:** §4.4 FR-11.
**Problem:** Nothing defines duplicate or conflicting requests (Student and Parent both submit, or one wants to withdraw), whether the child is told a parent requested deletion, or what happens to derived data. A deleted child's streak leaves the team's combined total (leaderboard jumps). Leave and Sick records and teacher decisions on them need cascading too.
**Fix:** Add consequences:
- One open request per child, whoever submits it.
- Either submitter can withdraw only their own request.
- Deletion cascades to leave and Sick records and guardian change requests.
- The team total is recomputed.

## F13. LOW: Some FRs are untestable and some hide implementation choices
**Location:** UJ-1 and SM-3 ("never more than a week"), FR-6 ("visually highlighted"), FR-7 (teacher-side label "should"), FR-9 ("without a code change"), FR-3 ("goes straight to the teacher approval queue as verified").
**Problem:**
- "Never more than a week" is a promise about human behavior with nothing in the system to enforce it.
- "Should" is not a requirement.
- "Without a code change" is ambiguous: the existing grace setting is DB-only with no admin screen (0007 comment). Does the Admin need a UI for the notice period or not?
- "As verified" reuses the 0006 `email_confirmed_at` mechanism in the wording, and the addendum admits that mechanism is being replaced.

**Fix:**
- Either add a Pending-Parent age indicator and reminder for the Admin, or drop "never".
- Turn the label into a testable consequence (see F3).
- State whether the Admin sets the notice period in the UI or by DB config.
- Phrase FR-3 as behavior only: the teacher sees no "unverified" flag.
