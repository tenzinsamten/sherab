---
title: 'Class badge subject'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: 'e37ecd47dd1d6619e1775965b30b560848fb5ce5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-badge-detail/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-badge-detail/badge-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Badges will be counted per subject (spec-badge-detail CAP-2), but a class records no subject, so nothing can say whether a class counts toward language, dance or instrument badges.

**Approach:** Add an optional badge subject to each class (`language`, `dance`, `instrument`; song classes use `dance`). The admin must pick it when creating a class and when saving the class's edit form; existing classes stay unset until the admin assigns one. The class list shows each class's subject, or "Not set".

## Boundaries & Constraints

**Always:** Only these three values are storable, enforced by a Postgres check constraint (AD-2). The column stays nullable so existing classes and other writers (teacher schedule edits, tests, seed) keep working. The app requires a subject on admin create and admin edit. All new UI text exists in en, de and bo. Song classes are labelled together with dance ("Dance & song"). Add the column to `database.types.ts` by hand; never regenerate that file.

**Never:** No badge counting, badge display, icon or access change (stories 2–5). No subject UI for teachers. No guessing a subject from the class name. No NOT NULL or trigger that would block updating an unset class.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create with subject | valid names + schedule + `badgeSubject=dance` | class inserted with `badge_subject='dance'` | N/A |
| Create without subject | valid names + schedule, no `badgeSubject` | nothing inserted; inline error under the subject field together with any name/schedule errors; typed values echoed back | fail 400 |
| Invalid value | `badgeSubject=song` (or any other text) | rejected like a missing subject | fail 400 |
| Edit unset class | existing class with NULL subject; admin saves names + `language` | names and subject saved together | N/A |
| Edit without subject | admin saves the edit form with no subject | nothing written; error shown; values echoed | fail 400 |
| List | classes with and without a subject | each row shows its subject label, or a "Not set" warning pill | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0047_class_badge_subject.sql` -- new: `alter table classes add column badge_subject text` + check constraint on the 3 values + column comment. No backfill.
- `src/lib/supabase/database.types.ts` -- `classes` Row/Insert/Update gain `badge_subject` (hand-edited).
- `src/lib/badge-subject.ts` -- new: `BADGE_SUBJECTS` tuple, `BadgeSubject` type, `isBadgeSubject`, `badgeSubjectLabel` (m.* messages). Mirror `src/lib/rich-text.ts` `CONTENT_LANGUAGES`/`isContentLanguage`.
- `src/lib/components/BadgeSubjectSelect.svelte` -- new: `<ix-select name="badgeSubject" required>` with error slot; copy the pattern of `ContentLanguageSelect.svelte` and `ScheduleFields.svelte` (`ixValue`, `{#key}` remount, `field-error` with `role="alert"`).
- `src/routes/admin/classes/+page.server.ts` -- `load` selects `badge_subject`; `create` validates subject alongside names/schedule (one fail with all errors) and inserts it; `rename` action (the class edit form) validates and updates `badge_subject` with the names. Return `subjectError` + echoed value on failure.
- `src/routes/admin/classes/+page.svelte` -- subject select in the create form (after names) and in the edit row; new "Subject" column; the edit button/legend/save labels become class-level ("Edit class", "Save") since it is no longer names-only.
- `messages/en.json`, `de.json`, `bo.json` -- subject label, three option labels (Language / Dance & song / Instrument), "Not set", required error, column heading, edit/save labels.
- `src/routes/admin/classes/page.server.spec.ts` -- extend the create and rename describes (existing mocks) for the matrix rows.
- `src/lib/server/rls.spec.ts` -- do not change existing inserts; they stay valid because the column is nullable.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0047_class_badge_subject.sql` -- add nullable `badge_subject` with check constraint -- storage, enforced in Postgres
- [x] `src/lib/supabase/database.types.ts` -- add `badge_subject: string | null` to classes Row, optional in Insert/Update -- types are hand-maintained
- [x] `src/lib/badge-subject.ts` -- subject list, guard, label -- one source for server and UI
- [x] `src/lib/components/BadgeSubjectSelect.svelte` -- required subject select -- reused by create and edit
- [x] `src/routes/admin/classes/+page.server.ts` -- load/create/rename handle `badge_subject` per matrix -- admin sets subject
- [x] `src/routes/admin/classes/+page.svelte` -- select in both forms, Subject column with "Not set" pill -- admin sees and assigns subjects
- [x] `messages/en.json`, `messages/de.json`, `messages/bo.json` -- new keys in all three -- localization constraint
- [x] `src/routes/admin/classes/page.server.spec.ts` -- tests for every matrix row -- regression cover

**Acceptance Criteria:**
- Given the local DB is reset, when a client inserts a class with `badge_subject='song'`, then Postgres rejects it.
- Given an existing class with no subject, when a teacher saves its schedule, then the save still succeeds.
- Given the admin views /admin/classes in German or Tibetan, then every new label is translated.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | verification-gap | 3 e2e create tests never pick a subject and now fail | high | Confirmed: calendar.e2e.ts:800-807, :857-858, forms.e2e.ts:561-562 fill names only; server rejects. patch |
| 2 | verification-gap | Edit-row prefill and names-only save have no browser test | medium | No e2e/component covers /admin/classes ?/rename; dropping prefill would fail every edit silently. patch (e2e) |
| 3 | verification-gap | badge-subject.spec label test is tautological | low | Static text only; rejected |
| 4 | blind, edge-case | Failed class save still says "class names" | low | messages/en.json:118; direct correction. patch |
| 5 | blind | badge_subject typed `string \| null`, not BadgeSubject | low | DB constraint is the guard; retyping ripples through callers; rejected |
| 6 | blind | badgeSubjectLabel falls through to Language | low | Values constrained by DB check and isBadgeSubject guard at the only caller; rejected |
| 7 | blind, edge-case | New RLS tests skip cleanup when an assertion fails | low | Leaks only on an already-failing run; try/finally adds structure; rejected |
| 8 | edge-case | class_teachers insert error unchecked in new RLS test | low | Direct one-line correction. patch |
| 9 | blind | No RLS test for UPDATE to a bad value / back to NULL | low | Postgres CHECK applies to UPDATE identically; NULL passes CHECK by definition; rejected |
| 10 | blind | Failed create with a valid subject: echo untested | medium | createdSubject relies on it; no test. patch |
| 11 | blind | Subject select uses a different {#key} than names | low | Extra remount is harmless; value preserved via createdSubject; rejected |
| 12 | blind | editValues(cls) called twice per render | false | `form` cannot change between two calls in one render; no drift |
| 13 | blind | No overview/count of unset classes | low | Intent asks only for a per-row "Not set" pill; rejected |
| 14 | blind | de/bo wording unchecked | low | Already noted for the human's manual check; rejected as code finding |
| 15 | blind | Action still named `rename` | low | Naming churn with no user impact; rejected |

## Implementation Notes

- Implemented by subagent from this spec; diff verified against every task and AC.
- Matrix audit: the List row had no test; added a `load` test (badge_subject passes through, NULL for unset) and `src/lib/badge-subject.spec.ts` (guard + labels). The repo has no component tests, so the "Not set" pill itself is checked manually.
- Edit form labels moved to class-level keys (`classes_edit`, `classes_edit_title`, `classes_save`, `classes_saved`); `names_*` kept for teams. `classes_error_rename_failed` still says "names" on a failed save.
- bo/de wording is a best effort; needs a native check.
- Review patches applied: e2e create tests pick a subject; new e2e for Edit class prefill + names-only save; `classes_error_save_failed` replaces the now-removed `classes_error_rename_failed`; create echo test; assign error checked in RLS test.
- Final verification after patches: reset 0; npm test 1344 pass; check 0 errors; build 0; e2e calendar + forms 31 pass.
- Earlier verification: supabase reset 0, npm test 75 files / 1343 tests pass, check 0 errors, build 0.

## Verification

**Commands:**
- `npm run supabase:reset` -- expected: all migrations including 0047 apply cleanly
- `npm test` -- expected: exit 0
- `npm run check` -- expected: exit 0, no new errors
- `npm run build` -- expected: exit 0

**Manual checks:**
- /admin/classes: create a class without a subject (error shown), with one (saved, column shows it); edit an unset class and assign a subject.
