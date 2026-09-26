---
type: review
reviews: '../ARCHITECTURE-SPINE.md'
reviewer: web-verification-check
purpose: 'Verify the 2026-09-26 Parent-role update relies on web-verified / reality-checked platform behavior, not training-data assertion'
date: '2026-09-26'
---

# Web Verification Review: Parent Role update (2026-09-26)

## Verdict

The technology choices still hold. SvelteKit 2.x, `@vite-pwa/sveltekit` 1.1.0, Paraglide 2.x, Supabase `pg_cron`, RLS and security-definer functions all exist, are current, and are already in the repo. The update's gaps are in platform behavior, not in the choice of technology. The memlog (line 60) says "No web verification needed" because no new technology was added. But the update relies on four Supabase behaviors that were never checked:

1. Auth email delivery to real parent addresses.
2. `signUp` / `createUser` behavior when an email already exists (the dual-role case).
3. `pg_cron` behavior across an auto-pause.
4. Supabase's current guidance on security-definer functions in exposed schemas.

Two of these (email delivery and missed cron runs) can break a Parent-role requirement in production without anyone noticing.

## What the repo actually uses (checked 2026-09-26)

| Item | Spine says | Repo reality |
| --- | --- | --- |
| SvelteKit | 2.x pinned | `@sveltejs/kit` ^2.63.0, installed 2.70.3. npm `latest` = 2.70.3, `next` = 3.0.0-next.29, and 3.0 is still not stable. The pin is still correct. |
| @vite-pwa/sveltekit | latest v1.x; peers cover SvelteKit 1-2 | Installed 1.1.0 (published 2025-11-27, still `latest`). Peer `@sveltejs/kit: ^1.3.1 \|\| ^2.0.1` is confirmed from the npm registry and node_modules. The bundled `vite-plugin-pwa` 1.3.0 accepts Vite ^8, which matches the installed vite 8.3.0. |
| Paraglide | "latest, via `svelte add paraglide`" | `@inlang/paraglide-js` ^2.18.2, installed 2.25.2 (npm latest 2.25.4), wired via `paraglideVitePlugin`. The messages live at the repo root in `messages/{locale}.json` (project.inlang/settings.json), not in `src/messages/` as the Structural Seed says. |
| pg_cron | recurring homework + sick auto-approval | Enabled in `0005_recurring_homework.sql` (`create extension if not exists pg_cron`). The one job, `generate-recurring-homework-instances`, runs daily `0 3 * * *`. Its comment already reasons that a daily schedule plus a catch-up loop survives auto-pause. No sick-leave job exists yet. |
| Service-role / admin API | "account minting only" (AD-1, AD-11) | `src/lib/supabase/admin.ts` is used by `admin/teachers` (`auth.admin.createUser({ email_confirm: true })`), `requests` (raw Admin REST update for synthetic email, `deleteUser`) and `admin/classes`. Students still register via public `signUp` with the guardian's real email (`(auth)/join`), so AD-11 is a real behavior change. |
| Security-definer functions | AD-14 masking function | Existing functions (0018, 0019) are `security definer` in `public` with `set search_path = public`. |
| Postgres | managed | `supabase/config.toml` `major_version = 17`, so `security_invoker` views are available. |
| SMTP | not mentioned | No custom SMTP decision anywhere in the spine, memlog, or `_bmad-output`. |

## Findings

### HIGH-1: Parent sign-up depends on Auth confirmation emails, but the spine never requires custom SMTP

AD-4 makes a parent approvable "only after the email is confirmed", and AD-11 retires the student guardian confirmation "because the parent's confirmed email replaces it". So every parent onboarding, plus every rejected-then-resubmitted parent (PRD line 97), depends on Supabase Auth delivering a confirmation email to an arbitrary address. Supabase's built-in email service does not deliver to arbitrary addresses:

- "Unless you configure a custom SMTP server for your project, Supabase Auth will refuse to deliver messages to addresses that are not part of the project's team."
- It is rate-limited to 2 emails per hour and is described as "best-effort only... non-production".

A school-year kickoff with dozens of parents signing up would fail completely without custom SMTP. The repo may already have SMTP configured in the hosted dashboard for the 0006 guardian flow, but nothing in the planning artifacts records it, and the spine now makes it load-bearing.

- Sources: https://supabase.com/docs/guides/auth/auth-smtp , https://supabase.com/docs/guides/auth/rate-limits
- **Suggested spine fix:** Add to AD-6 (or a new AD-15 "Transactional email"): "Supabase Auth sends through a custom SMTP provider (free tier of a transactional provider, account under the org per AD-7), with the Auth email rate limit raised to cover a sign-up burst. The built-in email service is never used in production. Parent onboarding (AD-4) and guardian-email changes depend on it." Add a Stack row for the SMTP provider.

### HIGH-2: The sick auto-approval job must be written as catch-up, because pg_cron skips runs while the project is paused and never backfills them

- AD-6 accepts free-tier auto-pause "as an operational quirk".
- AD-13 says "a `pg_cron` job inserts an automatic approval after 2 weeks undecided".
- pg_cron runs only while the database is up, and it has no catch-up: a run missed during downtime is simply gone, with no alert (cron.job_run_details just shows a gap).

A school holiday longer than 7 days is exactly when the project pauses (AD-6), and it is also when pending Sick leave from the last Sunday before the break would reach its 2-week deadline. If the job is written as "approve rows that turned 14 days old today", those rows are never approved.

Supabase's pause criterion is "sufficient **user** database activity". The docs do not say whether internal pg_cron activity counts, and community guidance treats it as not keeping the project awake. So the spine must not assume its own cron jobs prevent pausing.

The existing recurring-homework job already handles this well (daily schedule plus a catch-up loop, see its 0005 comment). AD-13 should say the same explicitly so story authors don't write an edge-triggered job.

- Sources: https://crontap.com/guides/supabase-cron-jobs , https://www.cronguard.app/blog/pg-cron-production-failure-modes , https://philipmcclarence.com/pg-cron-scheduled-jobs-postgresql-guide/ , https://supabase.com/docs/guides/platform/free-project-pausing
- **Suggested spine fix:** In AD-13, replace the job sentence with: "A daily `pg_cron` job approves **every** Sick leave whose latest decision is still pending and whose `set_at` is at least 14 days old (a level-triggered predicate, not 'exactly 14 days'). A missed or paused run is caught up on the next run, and the insert is idempotent (no second auto-approval for the same leave row). The auto-approval row records a system actor (`decided_by` NULL / `auto`) and fires the same streak-recompute trigger." In AD-6, add: "pg_cron does not run while the project is paused and does not backfill. Every scheduled job must be catch-up safe. Supabase emails a pause warning about a week ahead to the org account (AD-7), so that inbox must be monitored."

### HIGH-3: The dual-role (same email) flows collide with real Auth behavior, and the spine does not name the path

AD-4 says "a teacher or admin gains parent capability by adding a `parents` row for the same auth user". That is the correct data model: one `auth.users` row per email, with capability held in tables. But the spine says nothing about how the row gets added. Real Auth behavior blocks the obvious paths in both directions:

- **Teacher then parent.** If the teacher uses the public parent sign-up form, `signUp` with an already confirmed email and confirmations enabled (`config.toml` `enable_confirmations = true`) returns an obfuscated fake user with no error and sends no email, as anti-enumeration. The teacher sees "check your inbox" and nothing ever arrives.
- **Parent then teacher.** When the admin creates a teacher for an email that already has a parent-only login, `auth.admin.createUser` fails with `email_exists`. The admin-teachers action has no "promote existing login" path, and AD-4's single primary `profiles.role = 'parent'` would have to change.

- Sources: https://supabase.com/docs/reference/javascript/auth-signup ("you may get back an error message that attempts to hide this information"), https://github.com/orgs/supabase/discussions/29327 , https://github.com/orgs/supabase/discussions/26899 , installed `@supabase/auth-js` GoTrueAdminApi.createUser remarks
- **Suggested spine fix:** Add to AD-4:
  - "A signed-in teacher/admin requests the parent role from inside the app. An RLS policy allows inserting their own `parents` row as `pending` only, and it goes to the admin queue. The public parent sign-up form is for new logins only, and its success message must not promise an email when the address already exists."
  - "Admin teacher creation first looks for an existing login with that email. If a parent-only login exists, the admin action promotes it (changes the primary role to teacher and keeps the `parents` row) instead of calling `createUser`."

### MEDIUM-1: AD-14's masking function conflicts with Supabase's current security-definer guidance, and the existing convention is weaker than the docs

Supabase's RLS docs now say: "A `security definer` function in an exposed schema is callable over the Data API with the creator's privileges. Never create one in a schema listed under 'Exposed schemas'." They also say to always `set search_path = ''`. The repo's existing functions sit in `public` with `search_path = public`. The AD-14 function must be callable by classmates, so it will be exposed.

RLS is also row-only. Masking a column value (sick becomes on_leave) cannot be done by a policy. That makes the function approach correct, but the spine should say why, and say what the function must check.

- Source: https://supabase.com/docs/guides/database/postgres/row-level-security
- **Suggested spine fix:** In AD-14, add:
  - "The masking reader is a `security invoker` RPC in `public` that calls a `security definer` helper in a non-exposed `private` schema. Alternatively, it is a single `public` definer function whose `search_path = ''` is pinned and whose EXECUTE is revoked from `public` and `anon`."
  - "The function checks internally that the caller is enrolled in the session's class or on the student's team, and returns only `student_id`, `class_session_id` and the masked answer (never `set_by`, `classification` or decisions)."
  - "No view is used for this (views bypass RLS unless `security_invoker = true`)."
  - Apply the same `search_path` and EXECUTE rule to AD-11's registration function. It is called only via the service role, so revoke it from `anon` and `authenticated`.

### MEDIUM-2: The memlog's "no web verification needed" rationale is the process gap

Memlog line 60 treats verification as needed only when new technology is added. This update adds new reliance on existing technology: Auth email delivery, duplicate-email semantics, pg_cron downtime semantics, and definer-function exposure. Those behaviors are exactly what HIGH-1 to MEDIUM-1 found wrong or unstated.

- **Suggested spine fix:** Add memlog `(version)` entries that record these checks with their sources, and change line 60's wording to "no new technology; platform behaviors verified: ...".

### MEDIUM-3: Synthetic student emails must never trigger an Auth email

The AD-11 synthetic emails are created via `auth.admin.createUser`. That call does not send a confirmation email: "`createUser()` will not send a confirmation email to the user", and `email_confirm` defaults to false. The spine's approach is therefore sound, and this is verified.

But if any flow later calls `resetPasswordForEmail`, `signUp`, `updateUser({email})` or `inviteUserByEmail` on a synthetic address, it will bounce. With a custom SMTP provider (HIGH-1), bounces to an undeliverable domain count against sender reputation and suppression. Pending students would also be able to sign in immediately if they are created with `email_confirm: true` before teacher approval, unless app/RLS gating covers it. The current flow relies on the pending, unconfirmed state.

- Sources: installed `node_modules/@supabase/auth-js/src/GoTrueAdminApi.ts` (createUser remarks), https://supabase.com/docs/reference/javascript/auth-admin-createuser , https://supabase.com/docs/guides/troubleshooting/not-receiving-auth-emails-from-the-supabase-project-OFSNzw
- **Suggested spine fix:** In AD-11, add:
  - "Synthetic student emails use a domain the org controls (or a reserved non-routable one), and no Auth email flow is ever invoked for them. Password/PIN resets go through the admin action."
  - "A pending student's login is created with `email_confirm: false` (or an equivalent ban/gate) until teacher approval, so the pending state is enforced by Auth and RLS, not by the UI."

### LOW-1: The Stack table's Paraglide row is unpinned and slightly inaccurate

"latest, via `svelte add paraglide`" is not what is installed. The repo runs Paraglide JS **2.x** (`paraglideVitePlugin`), and 2.25.4 is the current npm latest.

- Source: https://registry.npmjs.org/@inlang/paraglide-js/latest
- **Suggested fix:** Change the row to "Paraglide JS 2.x (`@inlang/paraglide-js`, Vite plugin); re-verify before a 3.x major".

### LOW-2: The Structural Seed path is wrong for messages

The seed shows `src/messages/`, but the repo uses root `messages/{en,de,bo}.json` (per `project.inlang/settings.json`) with compiled output in `src/lib/paraglide`.

- **Suggested fix:** Correct the tree.

### LOW-3: The Stack pins are re-verified and still valid (no change needed, just a date refresh)

- SvelteKit 3 is still pre-release (`3.0.0-next.29`).
- `@vite-pwa/sveltekit` has not shipped since 1.1.0 (2025-11-27), and its peer range is still `^1.3.1 || ^2.0.1`. There is no public SvelteKit 3 support.
- The spine's pin and caveat are accurate. Given 10 months without a release, add a watch item: if SvelteKit 3 goes stable before `@vite-pwa/sveltekit` updates, the fallback is `vite-plugin-pwa` directly (it supports Vite 8).
- Sources: https://registry.npmjs.org/@sveltejs/kit , https://registry.npmjs.org/@vite-pwa/sveltekit , https://github.com/vite-pwa/sveltekit/releases

### LOW-4: AD-6's pause facts could be sharper

The current docs say:

- The pause criterion is low **user** database activity over 7 days.
- A warning email is sent about a week before the pause.
- A paused project can be restored with one click for **1 year**.

AD-6 is correct in spirit. Add the warning-email detail, and tie it to the AD-7 org inbox and to HIGH-2.

- Source: https://supabase.com/docs/guides/platform/free-project-pausing

### LOW-5: pg_cron time zone

Supabase pg_cron schedules are evaluated in UTC/GMT, while the spine's cutoffs are in Europe/Berlin. The 14-day predicate (HIGH-2) should compare `timestamptz` values, not Berlin calendar dates, or should explicitly convert. This matters only at the day boundary.

- Source: https://supabase.com/docs/guides/cron
- **Suggested fix:** Add one clause to AD-13.

## Verified OK (no action)

- **pg_cron on the free tier.** It is available on all tiers and limited only by resources (Supabase collaborator in https://github.com/orgs/supabase/discussions/37405). Recommended limits are at most 8 concurrent jobs and at most 10 minutes per run (https://supabase.com/docs/guides/cron). It is already in use in 0005.
- **The table-based role model (AD-4).** Using `parents`/`profiles` lookups in helpers, rather than JWT custom claims, avoids the stale-claims-until-token-refresh problem that Supabase documents for the Custom Access Token hook, so a parent approval takes effect immediately. It also keeps authorization out of `user_metadata`, which users can edit. Sources: https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac , https://supabase.com/docs/guides/database/postgres/row-level-security
- **The service-role key in SvelteKit server actions on Cloudflare Pages.** This pattern is already proven in the repo (`admin.ts`, with the `$env/static/private` build guard). `createUser` is documented as server-only.
