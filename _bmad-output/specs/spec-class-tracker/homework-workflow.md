# Homework Workflow

Detail behind CAP-3. The kernel states the intent and success criterion; this holds the full lifecycle.

## Creating an assignment (teacher, scoped to their own class)

- Title / instructions (e.g. "Write ཀ-ཁ-ག-ང ten times").
- Skill area: language / song / dance.
- Assigned to: whole class, or a chosen subset of students.
- Due date: default "next Sunday"; must support longer windows (e.g. "in two weeks").
- Optional reference link(s): one or more URLs (website, video, audio) shown as a plain "Open reference" link/button, opening externally — no embedded player/preview, no link validation needed (only admin-verified teachers can create assignments, so trust is already established).

## Recurring assignments

- A teacher can mark a task recurring with a repeat cadence (weekly is the main case); it auto-generates a new instance each period without teacher re-creation.
- Set up once; continues until the teacher pauses or ends the series.
- Each generated instance has its own independent Done/Reviewed status per student — completing one instance never marks future instances done.
- Editing the series (title, links, due-date offset) or ending it only affects instances going forward; past instances are untouched.
- Recurring assignments must be visually distinguishable from one-off assignments on roster/assignment views (e.g. a repeat icon).

## Student side

- Sees their own open homework list (own class only), grouped by due date or skill.
- Reference links open externally (new tab/browser), never embedded in-app.
- Marks each item **Done** themselves during the week.
- No proof required by default (self-report, low friction); photo/audio attachment is a possible future option, not v1.
- Future-visibility window: v1 shows the current open instance plus next week's only, nothing further out. This window must be a configurable value in the data model (a "look-ahead window") so it can widen later (e.g. to a month) without a structural change.

## Review state machine

`Assigned` → `Done` (student self-reports, or a teacher marks it done on the student's behalf, e.g. for a young child who can't use the app) → `Reviewed` (teacher confirms in class — checks the writing, hears the recitation).

- `Done` alone is sufficient to count toward a streak.
- `Reviewed` is tracked separately as the teacher's actual assessment of mastery, feeding skill-status history — it does not gate the streak.

## Teacher's view of an assignment

- Per-assignment: count of Done, count of Reviewed, list of who hasn't started.
- Quick per-student toggle to review/confirm without opening each student individually.

## Overdue / follow-up

- Assignments past due date and still not Done stay visible indefinitely, flagged overdue.
- They only disappear when the teacher explicitly archives them — nothing silently expires.
