# Manual Verification Checklist — Sherab (tib-class)

Tick items as you go. Sections follow build order; later sections reuse data from earlier ones.
Note failures inline (e.g. `- [ ] ... ❌ got 500`).

## 0. Setup
- [ ] Docker running
- [ ] `npm install` (use `--legacy-peer-deps` if it fails) and `cp .env.example .env`
- [ ] `npm run supabase:start`; paste API URL, anon key, service_role key into `.env`
- [ ] `npm run dev` → http://127.0.0.1:5173
- [ ] Inbucket (:54324) and Studio (:54323) open in other tabs
- [ ] Do NOT run `npm run supabase:types` (drops hand-maintained type aliases)
- [ ] No `seed.sql` exists: all accounts are created by hand below

## 1. Accounts and roles (Epic 1)

### Admin bootstrap
- [x] Sign up at `/signup`; `?justSignedUp` banner shows (banner layout bug fixed in app.css)
- [x] In Studio run: `update public.profiles set role='admin' where id=(select id from auth.users where email='...')`
- [ ] Running it a second time changes nothing

### Login (`/login`)
- [ ] Wrong password → generic error (no account leak)
- [ ] Empty fields → required-field error
- [ ] Sign-in redirects to `/`; sign-out works
- [ ] Signed-in user visiting `/login`, `/signup`, `/join` is redirected to `/`

### Admin setup
- [ ] `/admin/teams`: create 2 teams
- [ ] `/admin/classes`: create 2 classes; codes unique, no 0/O/1/I; duplicate name allowed
- [ ] `/admin/teachers`: create Teacher A (class 1) and Teacher B (class 2)
- [ ] Temp password shown once (copy it)
- [ ] Duplicate teacher email → inline error

### Student join (`/join`)
- [ ] Valid class code + name + guardian email + consent → `/join/pending`
- [ ] Invalid code → friendly error
- [ ] Missing consent → blocked
- [ ] Duplicate registration → friendly error

### Approval (`/requests`, as admin and as Teacher A)
- [ ] Before guardian confirms: student flagged unverified, Approve blocked, Reject works
- [ ] Click guardian link in Inbucket
- [ ] Approve with a team → username + PIN shown once (copy them)
- [ ] Log in as the student with username + PIN
- [ ] Pending-count badge in nav is correct
- [ ] `clearRejected` removes the row from history
- [ ] Teacher B does not see class 1's requests
- [ ] Pending student absent from rosters and leaderboard

### Role guards
- [ ] `/admin` as non-admin → 403
- [ ] `/teacher` as student, `/student` as teacher → blocked
- [ ] `/requests` as student → 403
- [ ] Anonymous access to guarded pages → redirect to `/login`
- [ ] `/teacher` lists only that teacher's assigned classes

## 2. Roster and skills (Epic 2)
As Teacher A at `/teacher/classes/[id]`:
- [ ] Roster shows approved students only
- [ ] Mark attendance on a chosen session date
- [ ] Set language / song / dance status (not started / learning / confident) with a note
- [ ] "View history" expands inline; two updates → two history rows
- [ ] Teacher B opening class 1 by URL → 404 / empty

## 3. Homework (Epic 3)
### One-off (`/teacher/classes/[id]/homework`)
- [ ] Create for whole class (title, skill area, due date, link)
- [ ] Create for a subset of students
- [ ] Every targeted approved student shows at least "assigned"
- [ ] Teacher marks Done on a student's behalf
- [ ] Mark Reviewed (independent of Done)
- [ ] Overdue item stays visible and flagged until archived
- [ ] Archive works
- [ ] Student on `/student` sees current + next period homework and self-marks Done

### Recurring
- [ ] Create weekly series
- [ ] Trigger pg_cron generator manually in Studio
- [ ] No duplicate instance in the same period
- [ ] Edit series → title updates on existing instances, Done statuses untouched
- [ ] Pause series, end series

### Teacher walkthrough fixes (#23–#27, needs 0013 pushed)
- [ ] Teacher lands on **Dashboard** (`/teacher`): tiles for students, pending requests (links to
      `/requests`), due this week, overdue, waiting for review, completion; class cards below
- [ ] Teacher B's tiles don't include class 1's numbers
- [ ] **My Account** (bottom of side menu, admin + teacher): change display name, shows in
      `/admin/teachers`
- [ ] Change password: wrong current password → error; new password works after sign-out, old
      one doesn't; other signed-in devices are signed out
- [ ] `/account` as a student → 403
- [ ] Whole-class homework on a class with no approved students is created, shows "No students
      yet"; approve a student → they see it on `/student`
- [ ] Archived or past-due whole-class homework is not given to a newly approved student
- [ ] Subset homework with no students ticked → error
- [ ] Description with line breaks and several labelled links: shown to teacher and student
- [ ] Add / remove link rows (max 10); a label with no URL is ignored
- [ ] **Edit** works on one-off homework and on a series; Done/Reviewed marks unchanged
- [ ] Existing homework's single link still shows after 0013 (backfilled)

### Retest fixes (#28–#33, needs 0014 pushed)
- [ ] "My Account" menu item shows its icon
- [ ] Date fields (homework due / start date, attendance date) show a dark calendar icon, also
      with the Mac in dark mode
- [ ] **Homework list:** 10 per page with Previous / Next and "Page x of y"; filters Open /
      Archived / All with counts (default Open)
- [ ] Open hides fully archived one-offs and paused / ended series with nothing open;
      Archived shows them
- [ ] Row shows title, skill, Weekly pill, next due, Done x / y, Overdue / Archived pill, and
      opens the detail page
- [ ] **Create homework** opens `/homework/new`; after creating, back on the list with exactly one
      toast and no spinner left; refreshing doesn't repeat the toast
- [ ] **Detail page:** mark done / reviewed, archive, edit, pause / end all work, each with a
      spinner; Back to homework returns to the list
- [ ] **Class page cards:** Students count, Homework "open · total" (links to the list), Syllabus
- [ ] Teacher edits the syllabus (text with line breaks + labelled links); clearing it shows
      "No syllabus yet"
- [ ] Admin edits the same syllabus from `/admin/classes` ("Edit syllabus" under each class)
- [ ] Student sees the "Class syllabus" card on `/student` (hidden when empty)
- [ ] Teacher B cannot save class 1's syllabus

## 4. Gamification (Epic 4)
### Streaks (`/student`)
- [ ] Empty state before any streak
- [ ] 1 week after attendance + homework Done both exist
- [ ] Missing fewer weeks than `streak_grace_weeks` (default 2) keeps streak
- [ ] Missing more resets to 0
- [ ] Week with no class does not consume grace
- [ ] Duplicate Done marks / mark order have no effect
- [ ] Backdated attendance triggers recompute

### Badges
- [ ] Cross attendance/homework thresholds → badge appears once, no duplicates
- [ ] Multiple crossed milestones all awarded
- [ ] Other students and teachers cannot see the badge

### Leaderboard (`/leaderboard`)
- [ ] Reachable from admin, teacher, student, with nav link in each
- [ ] Teams ranked by summed streaks of approved students
- [ ] Team with no streaks shows 0
- [ ] No individual students exposed
- [ ] Empty state renders
- [ ] Anonymous → redirect to `/login`

## 5. Admin dashboard (Epic 5, `/admin`)
- [ ] Six tiles: classes, teachers, students, pending, homework assignments, completion
- [ ] Counts match the database
- [ ] Pending shows `0`, muted, not hidden
- [ ] Completion `0%` with no history (never NaN), capped at 100
- [ ] Tiles link to their management pages
- [ ] Non-admin → 403
- [ ] Admin-only nav link present for admin only

## 6. Cross-cutting
- [ ] Language switcher: de, en, bo all work
- [ ] bo: Tibetan text renders, Tibetan font loads, `lang` attribute set (translation is unreviewed by a native speaker)
- [ ] Mobile width layouts of student pages
- [ ] RLS spot-check with anon key: cannot read another class's rows
- [ ] `npm test` passes with local Supabase running (else `rls.spec.ts` silently skips) ⚠️ 2026-09-23: 76 passed, 97 skipped (no local Supabase; RLS suite not exercised)
- [x] `npm run check` passes (2026-09-23: 0 errors, 0 warnings)

## Expected failures (known gaps, not bugs)
- No `seed.sql` / seeded accounts
- Data-deletion feature not built (story name mentions it; only the dashboard shipped)
- `/signup` stays open: anyone can self-register a teacher account
- No PIN rate-limiting; no credential reissue flow
- No landing page after guardian confirms email (lands on `/` with unconsumed `?code=`)
- Guardian registering a second child before the first is approved → email-collision message
- No PWA icons in manifest
- Story 5-1 RLS test block never run

Sources: `_bmad-output/specs/spec-class-tracker/stories/`, `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`.
