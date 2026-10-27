# Web-verification review: ARCHITECTURE-SPINE amendment 2026-10-27 (second parent)

- **Reviewed:** `ARCHITECTURE-SPINE.md` (AD-10 rewritten, AD-16 new, AD-4/9/11/12/13 amended), `.memlog.md` entries from "2026-10-27 Update run started"
- **Lens:** were the committed decisions checked against the web, the repo, and current package versions, or asserted from memory? Reality-check of the Postgres and Supabase mechanisms the ADs rely on.
- **Evidence used:** PostgreSQL 17 docs (CREATE TRIGGER, ALTER TABLE, dependency tracking, explicit locking, CREATE INDEX), PostgREST transaction docs, `supabase/migrations/0020, 0023, 0024, 0029, 0032, 0033, 0037, 0042, 0052`, `supabase/config.toml` (`major_version = 17`), `npm view` run on 2026-10-27.
- **Date:** 2026-10-27

## Verdict

The mechanisms are the right ones and mostly hold up. Partial unique indexes as the two-link cap, a deferred constraint trigger that sees cascaded deletes, and `FOR UPDATE` inside security-definer RPCs all work as AD-10 and AD-16 assume. But the memlog line "(version) No new technology ... no web verification needed" let three real gaps through: (1) the column rename silently breaks every function body that names `parent_id`, including the guard trigger that fires on every `profiles` UPDATE; (2) the renamed column keeps `ON DELETE RESTRICT`, which contradicts AD-10's parent-deletion rule; (3) an expired invite still blocks the one-pending partial index. One stack fact is also out of date: SvelteKit 3 is no longer pre-release.

## Verified (no action)

| Claim in the amendment | Check | Result |
| --- | --- | --- |
| Partial `UNIQUE(student_id, slot)` / `UNIQUE(student_id, parent_id) WHERE removed_at IS NULL` stop a third active link "whatever the concurrency" | PG docs: a unique index check waits for the conflicting in-progress transaction and raises once it commits. Partial unique indexes are documented (indexes-partial, Example 11.3). The repo already uses one (0042). The predicate `removed_at IS NULL` is immutable, so it is allowed. | **Holds**, as long as `slot` has `CHECK (slot IN (1,2))`. Without that check the slot index caps nothing. Say so in AD-10. |
| A deferred constraint trigger fires for `student_parents` rows removed by `ON DELETE CASCADE` from `profiles` / `parents` | PG 17 CREATE TRIGGER: "Row updates or deletions caused by foreign-key enforcement actions ... are treated as part of the SQL command that caused them (note that such actions are never deferred). Relevant triggers on the affected table will be fired." | **Holds.** The cascade itself is immediate. The AFTER ROW constraint trigger on `student_parents` is queued and runs at commit. |
| At commit, the trigger can tell that the student row is gone | A deferred trigger runs in the same transaction at commit and sees that transaction's own deletes, so `NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.student_id)` is true after a student delete. | **Holds.** The trigger must test the student's existence first and return when the student is gone. |
| Constraint trigger shape | PG 17: constraint triggers must be `AFTER ... FOR EACH ROW`; `WHEN` is evaluated immediately, not deferred; `CREATE OR REPLACE` is not supported for constraint triggers. | **Holds.** A later change must use DROP + CREATE (same as 0020 did for `on_auth_user_created`). |
| `SELECT ... FOR UPDATE` inside a security-definer function called through Supabase RPC | PostgREST runs each request in one transaction. VOLATILE functions called by POST get READ WRITE; STABLE/IMMUTABLE functions get READ ONLY, where `FOR UPDATE` fails with SQLSTATE 25006. The repo already does this (0032 `for update`, 0052). | **Holds, with one condition.** See M1. |
| "Deferred constraint triggers ... already in use" (memlog) | `0020_signup_role_from_app_metadata.sql:117` makes `on_auth_user_created` a DEFERRABLE INITIALLY DEFERRED constraint trigger. | **True.** See L1 for what this means for AD-11. |
| Renamed column vs RLS policies, views, indexes, CHECK, FK | PG stores parsed column references (by attnum) for policies, views, indexes, CHECK and FK constraints, so they follow a rename. `grep -rn parent_id supabase/migrations` finds **no** policy or view that names `parent_id`. Policies go through `is_parent_of()`. The 0042 index and the 0024 `profiles` CHECK (`... and parent_id is null`) follow the rename. | **Policies, index and CHECK are safe.** Function bodies are not. See H1. |
| Stack pins | `npm view` 2026-10-27: `@vite-pwa/sveltekit` 1.1.0, peer `@sveltejs/kit ^1.3.1 \|\| ^2.0.1`; Paraglide 2.29.2 (2.x); supabase-js 2.118.0; Supabase local Postgres 17. | Pins still valid. One rationale is stale. See M5. |

## Critical

None.

## High

### H1. Renaming `profiles.parent_id` breaks every function body that names it, including the guard trigger on every `profiles` UPDATE

- **Where:** AD-10 last bullet ("The migration renames it ... Story 1 renames references mechanically"); memlog "(version) no web verification needed".
- **Evidence:** PG 17 §5.15 (ddl-depend): "For a user-defined function ... whose body is defined as a string literal, PostgreSQL tracks dependencies associated with the function's externally-visible properties ... but *not* dependencies that could only be known by examining the function body." No migration uses `BEGIN ATOMIC` (grep). `ALTER TABLE ... RENAME COLUMN` therefore succeeds. Every plpgsql or SQL function that names `parent_id` then fails **at call time**:
  - `guard_profile_link_columns()` (0024:212-229). It is a BEFORE UPDATE trigger on `profiles` and reads `new.parent_id`. PL/pgSQL resolves record fields when it prepares the IF expression, so **every** UPDATE on `profiles` fails with `record "new" has no field "parent_id"`, whatever `current_user` is. That covers teacher review, team assignment, the promote/demote RPCs (0033), and service-role updates.
  - `handle_new_user()` (0024:74, latest definition). It inserts into `profiles (..., parent_id)`. It runs from the deferred `on_auth_user_created` trigger, so every sign-up fails at commit.
  - `is_parent_of()` (0024:264) and `linked_children()` (0024:293). Every parent RLS check and the parent landing page fail. Story 2 rewrites these to read links, but they break as soon as story 1's rename lands.
  - `student_registration_state()` (0042:89-110) and the homework push-recipient function (0037:233).
- **Why the spine needs to say it:** "renames references mechanically" reads like a find-and-replace in `src/`. The migration itself must recreate the functions, because between the rename and the recreate nothing works, and `supabase db reset` does not catch a function that only fails when it is called.
- **Fix:** Add to AD-10: "The rename migration `CREATE OR REPLACE`s, in the same migration, every function whose `prosrc` names `parent_id`. It ends with a guard `DO` block that raises when `SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace WHERE n.nspname = 'public' AND prosrc ~ '\mparent_id\M' AND proname NOT IN (<allowed list for student_parents.parent_id users>)` returns rows." Story 1's acceptance must include a profiles UPDATE, a student sign-up, and an `is_parent_of` call against the reset DB. Update `database.types.ts` by hand (project rule). PostgREST's schema cache reloads by itself on hosted Supabase (DDL event trigger). Locally, `db reset` covers it.

### H2. `registered_by_parent_id` keeps `ON DELETE RESTRICT`, which contradicts "deleting a parent account removes only that parent's links"

- **Where:** AD-10 bullet 2 ("`student_parents.parent_id` cascades on parent deletion, so deleting a parent account removes only that parent's links and is refused while they are any student's last link").
- **Evidence:** 0024:41 `add column parent_id uuid references public.parents (id) on delete restrict`. A rename keeps the FK and its action. 0033's header already relies on this: demoting instead of deleting because deletion would "fail on the parent_id RESTRICT FK with linked children". RESTRICT is checked immediately and cannot be deferred. So deleting the parent who registered a child fails **even when the child has a second active parent**. The deferred last-link trigger never gets a say. The ER line `registered_by_parent_id (display + 0042 only)` hides this.
- **Fix:** Decide explicitly and write it into AD-10. Either:
  - (a) Keep RESTRICT and state that "a parent who registered any still-existing child cannot be deleted; the admin removes them by unlinking only". The last-link trigger then matters only for invited parents.
  - (b) Change the FK to `ON DELETE SET NULL`, so registration provenance is lost when the registrant is deleted. The 0042 index already excludes NULL, so that child drops out of the same-name rule. The guard trigger lets this through, because RI actions run as the table owner, not `authenticated`. Verify that in a test.
  
  Option (b) matches the stated intent. Also re-check 0033's demote rationale.

### H3. An expired invite still blocks the "one pending invite per student" partial unique index

- **Where:** AD-16 bullet 1 ("A partial unique index allows one pending invite per student. Expiry is evaluated at read and accept time, so no scheduled job is needed").
- **Evidence:** PG 17 CREATE INDEX: "All functions and operators used in an index definition must be 'immutable'". The same rule applies to a partial index's WHERE clause, so `now()` cannot appear in it (confirmed in pgsql-admin threads, Tom Lane). The index can only be `WHERE status = 'pending'`. An invite past `expires_at` keeps `status = 'pending'`, so `create` either inserts and hits `unique_violation` or, following "refuses unless ... no pending invite", refuses. Either way **a parent can never re-invite after an invite expires** unless someone cancels it.
- **Fix:** Add to AD-16: "create (under the student `profiles` lock) first sets `status = 'expired'` (add the enum value) on that student's pending rows whose `expires_at <= now()`, then applies the 'no pending invite' check and inserts. accept and list-mine treat `expires_at <= now()` as not pending. Every 'pending' check uses one SQL predicate (`status = 'pending' AND expires_at > now()`) defined once." No cron is needed, so the no-job intent survives.

## Medium

### M1. Lock-taking and writing RPCs must stay VOLATILE and be called by POST

- **Evidence:** PostgREST transactions reference: for RPC, STABLE/IMMUTABLE functions run in a READ ONLY transaction, and VOLATILE functions called by POST run READ WRITE. A read-only transaction rejects `SELECT ... FOR UPDATE` and writes with SQLSTATE 25006. Most helpers in this repo are declared `stable` (for example `is_parent_of`, `linked_children`), so copying one as a template is an easy mistake.
- **Fix:** AD-10 and AD-16 conventions: "accept, create, cancel, and the admin link removal are `volatile` (default; never `stable`) and are called with `supabase.rpc()` without `{ get: true }`. Only list-mine may be `stable`." Add a db test that calls each one through supabase-js.

### M2. The last-link refusal surfaces only at COMMIT, through two different error channels

- **Evidence:** The trigger is deferred, so the error is raised at commit. For a parent deletion through `auth.admin.deleteUser`, GoTrue owns the transaction and reports a generic "Database error deleting user". For the admin removal RPC, PostgREST reports the commit-time error. How PostgREST maps a commit-time error was **not confirmed** on the web (no source found), so test it.
- **Fix:** The removal function and the admin delete-parent action pre-check "is this the last active link of an existing student?" while holding the student lock, and raise a specific errcode/hint the UI maps. The deferred trigger stays as the backstop. It must be `AFTER UPDATE OF removed_at OR DELETE`, carry an errcode, and run its "student still exists" test first. Tests must commit. supabase-js calls do, but a pgTAP-in-rollback test would never fire it without `SET CONSTRAINTS ALL IMMEDIATE`.

### M3. The CAP-5 same-name check has no shared lock between registration and accept

- **Evidence:** AD-11 serializes registrations by locking the registering parent's `parents` row. AD-16 accept locks the **student's** `profiles` row. Parent P accepting an invite for child "Tenzin" and P registering a new "Tenzin" at the same moment take different locks, so both checks can pass. The 0042 index only covers `registered_by_parent_id`, not invited links.
- **Fix:** Accept also locks the caller's `parents` row and runs the same-name check. Fix one lock order for every function that takes both locks (`parents` row first, then student `profiles` row) to rule out deadlock. Note that `FOR UPDATE` on the student row also conflicts with the `FOR KEY SHARE` that FK checks take on inserts referencing that student (PG 17 explicit-locking, Table 13.3), so keep the locked section short.

### M4. The memlog's "no web verification needed" assertion is the root cause of H1 to H3

- **Evidence:** The mechanisms are in use (0020, 0042, 0032), but the **new** uses are not: a cascade into a deferred check, a column rename under live function bodies, and time-based expiry against a partial index. None of these were checked.
- **Fix:** Replace the memlog line with a verification entry that cites the PG 17 sections above. Keep the convention that a new *use* of a known mechanism gets a reality check, not only new technology.

### M5. Stale stack fact: SvelteKit 3 is released

- **Where:** Stack table, SvelteKit row: "SvelteKit 3 is pre-release (re-verified 2026-09-26)".
- **Evidence:** `npm view @sveltejs/kit time`: 3.0.0 released 2026-10-01, 3.1.0 on 2026-10-14 (`latest` = 3.1.0). `@sveltejs/adapter-cloudflare` `latest` = 8.0.1, while the project is on ^7.2.8. `@vite-pwa/sveltekit` 1.1.0 is still the latest version and its peer range is still `^1.3.1 || ^2.0.1`, so **the 2.x pin is still correct**. Only the reason given for it is wrong.
- **Fix:** Reword the row: "2.x pinned (latest 2.70.3) — SvelteKit 3.x is released (3.1.0) but @vite-pwa/sveltekit 1.1.0 peers only ^2; re-verified 2026-10-27". Add an adapter-cloudflare row ("7.x; 8.x is for Kit 3, do not take it yet" — check the adapter's own peer range before relying on that).

## Low

- **L1. AD-11 runs at commit.** `handle_new_user` fires from the deferred `on_auth_user_created` constraint trigger (0020). So the slot-1 link insert and the `parents` row lock both happen at commit. Events queued while deferred triggers fire are processed in the same commit, but cover it with a test: a sign-up must leave exactly one slot-1 link. Sign-up refusals reach the server action as GoTrue's generic error, as today, so keep the server-side pre-check for messages.
- **L2. Legacy students with a null `parent_id` get no link** (0024:33: "existing students keep parent_id null"). The deferred trigger never fires for them, so the ER label "student has 1-2 parents" is not an invariant for them. Have the migration report their count, and say "0-2 for students registered before 0024" in the spine.
- **L3. Match accept against `auth.users`, not the profile copy.** "Confirmed profile email" relies on `profiles.email` / `email_confirmed_at` copies staying in sync with `auth.users` after an email change, and nothing checked that. Compare against `auth.users.email` and `email_confirmed_at` inside the definer function.
- **L4. The deletion removes rows only.** AD-10 removal "sets `removed_by`/`removed_at` once". Say how that is enforced: a guard trigger, or the function's `WHERE removed_at IS NULL` plus no client UPDATE grant.
- **L5. The Deferred section contradicts AD-12.** The "Parent notifications — no email/push beyond Supabase Auth" item conflicts with AD-12's "push recipients" and the built 0037 homework push. Not part of this amendment, but the amendment now cites push. Reconcile the Deferred item.

## Sources

- PostgreSQL 17, CREATE TRIGGER (constraint triggers, FK-action firing): https://www.postgresql.org/docs/17/sql-createtrigger.html
- PostgreSQL 17, Dependency Tracking (string-literal function bodies untracked): https://www.postgresql.org/docs/17/ddl-depend.html
- PostgreSQL 17, ALTER TABLE (RENAME COLUMN): https://www.postgresql.org/docs/17/sql-altertable.html
- PostgreSQL 17, CREATE INDEX (immutable functions in predicates): https://www.postgresql.org/docs/17/sql-createindex.html
- PostgreSQL 17, Explicit Locking (row-lock conflict table): https://www.postgresql.org/docs/17/explicit-locking.html
- pgsql-admin thread on `now()` in a partial index: https://www.postgresql.org/message-id/28177.1065201437%40sss.pgh.pa.us
- PostgREST transactions (access mode by volatility): https://docs.postgrest.org/en/stable/references/transactions.html
- npm registry via `npm view` (2026-10-27): @sveltejs/kit, @vite-pwa/sveltekit, @sveltejs/adapter-cloudflare, @inlang/paraglide-js, @supabase/supabase-js
