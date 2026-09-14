# Epic 1 Context: Accounts & Roles (CAP-1)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic covers CAP-1 — the account/identity foundation Sherab needs before any other capability can function. Story 1-1 (done) scaffolded the SvelteKit + Supabase project, bootstrapped the first admin, and gave the admin the tools to create classes and create/verify teacher accounts with many-to-many class assignment — but it deliberately stopped before any student existed. Story 1-2 (not started) closes that gap: a prospective student self-registers with a class code and guardian consent, lands Pending (invisible everywhere, no activity) until their class teacher or the admin (as backup) approves or rejects them, with team assignment folded into that same approval action. It matters because every later epic — roster/skill tracking, homework, gamification, admin oversight — needs approved, properly-scoped students to exist before it can build anything on top.

## Stories

- Story 1-1: Teacher & student account management (done)
- Story 1-2: Student self-registration & approval (not started)

## Requirements & Constraints

- Teachers are created/verified admin-side only, never self-registered; a class can have multiple teachers and a teacher multiple classes.
- Students self-register with name + class code + guardian consent and start Pending — invisible on every roster/leaderboard, cannot log any progress — until a class teacher or the admin approves them; team assignment happens at that same approval moment and is fixed for the school year afterward (admin-only override to change it later).
- Rejected/unrecognized registration entries must be easy to clear out; a rejection still leaves a visible decided-history record, it isn't a silent delete.
- Once approved, the student picks a nickname/avatar for day-to-day use (not their real registration name).
- Visibility is class-scoped: every teacher assigned to a class shares full view/edit of it; only the admin has cross-class visibility.
- Student sign-in mechanism is username + short PIN — decided during Story 1-1 but not built there; Story 1-2 is where it must actually ship.
- Minimize personal data collected on minors (nickname + progress only); no public-facing profile.
- Must support German/English/Tibetan UI; run as a low/near-free-cost installable PWA on existing family phones/tablets; be usable by non-technical volunteer teachers; tolerate two teachers concurrently editing the same class.

## Technical Decisions

- SvelteKit PWA talks directly to one Supabase Postgres project via its SDK — no hand-rolled REST/GraphQL layer. All authorization is enforced by Postgres RLS keyed on the authenticated user's identity/role; frontend may hide UI but is never the sole barrier.
- Identity model already built in Story 1-1: `profiles` (PK = auth user id, `role` enum already includes `student`) and `class_teachers` (many-to-many). Two `SECURITY DEFINER` helpers, `is_admin()` and `is_teacher_of_class()`, back every RLS policy today — Story 1-2 should extend this pattern to students/registrations rather than inventing a parallel check.
- A student's `team_id` may only be set **from `NULL`** through the normal client path (the approval action); changing an already-set `team_id` later requires an explicit admin-only override, not a routine update.
- Whether a minimal `teams` table (name only) needs to be scoped into Story 1-2 as prerequisite schema, or whether approval can proceed without a team assignment for now, is explicitly unresolved — investigate and flag as an open question rather than assuming either way.
- Conventions already in place: `snake_case` DB tables/columns, kebab-case routes, `PascalCase` Svelte components; UUID PKs; `timestamptz` UTC; ISO 8601 dates; UI strings keyed through Paraglide (Inlang), never inline literals; admin-tunable values live in `app_settings`, never hardcoded.
- Current environment is local Supabase dev only — no production project/hosting has been provisioned yet (that remains the school's own action, outside any story's scope).

## UX & Interaction Patterns

- Visual system is a bold, high-contrast, editorial/brutalist look (poster/zine-like, sharp rectangular edges, zero border-radius anywhere, no shadows/elevation) — this supersedes any earlier reference to a claymorphism style, which does not apply to this project. One accent color (Signal Blue) marks the single primary action per screen; Attention Amber means "waiting on a person" (e.g. a PENDING count); Error Red is field-validation only.
- Join flow (`(auth)/join`) is a 3-step wizard: class code (validated server-side; an unknown code blocks advancing with a red-underline inline error) → full name (nickname choice is explicitly deferred to post-approval) → guardian consent (a required checkbox paired with plain-language data-use copy: what's stored, that nothing is public, that deletion is available on request).
- `/join/pending` shows a clear "PENDING" status receipt (name, class, consent) explaining who reviews it and what the student still can't do — not a spinner or vague "thanks" page.
- `/requests` is one shared approval-queue component for both the teacher (own assigned classes) and the admin (every class, as an explicit backup path); only the dataset scope and header copy differ. Each row shows name, class-code link, submitted date, and an immediate APPROVE/REJECT action pair with no confirmation dialog; an `aria-live="polite"` banner announces the outcome as a full sentence, the decided row moves into a DECIDED history section with a status chip (solid blue APPROVED / muted gray REJECTED), and badge-counted nav/home-screen counts decrement live. A "CLEAR REJECTED" action appears once a rejection exists.
- The observed approval-queue row does **not** yet include a team picker — Story 1-2 must add one inline at the moment of approval (not a separate screen) per the architecture's team-assignment rule above; this is new interaction surface to design, not something to copy from the existing prototype as-is.
- Open, unresolved by any planning doc: what a rejected student sees on their own pending-status screen afterward; error/validation states for sign-in failure and duplicate-email; the Tibetan-script fallback for the all-caps display type.

## Cross-Story Dependencies

- Story 1-2 builds directly on Story 1-1's schema/RLS pattern (`profiles`, `class_teachers`, `is_admin()`/`is_teacher_of_class()`) rather than reinventing it for students.
- Story 1-2's completion is what unblocks Story 2-1 (roster & skill tracking), which needs approved students to exist and cannot proceed without this story.
- The future team-leaderboard story depends on the team-picker seam being built into Story 1-2's approval flow itself, not added later as a disconnected admin screen.
- The future admin-oversight story reuses Story 1-2's approval mechanism for its own backup-approve capability rather than building a parallel path.
