---
name: Sherab
status: final
sources:
  - '{planning_artifacts}/../specs/spec-class-tracker/SPEC.md'
  - '{planning_artifacts}/../specs/spec-class-tracker/roles-and-permissions.md'
  - '{planning_artifacts}/../specs/spec-class-tracker/stories/1-1-teacher-student-account-management.md'
  - '{planning_artifacts}/architecture/architecture-tib-class-2026-09-13/ARCHITECTURE-SPINE.md'
  - imports/story-1-1-prototype (Claude Design prototype, https://claude.ai/design/p/5cdf70fd-e423-42c0-a485-8f80c0e7c2ab, republished as https://claude.ai/code/artifact/55945e66-4957-4bf7-a10b-8689518d4568)
updated: 2026-09-14
---

# Sherab — Experience Spine

> Munich Tibetan Sunday School class tracker. Single-surface responsive PWA (SvelteKit), phone-first with a desktop breakpoint. From-scratch component system — see `DESIGN.md` for the visual identity this spine references by `{path.to.token}`.

## Foundation

Responsive web PWA (installable, no app store) built on SvelteKit 2.x + Supabase, per the architecture spine. Three roles share one codebase with role-scoped route trees (`admin/`, `teacher/`, `student/` — per `ARCHITECTURE-SPINE.md`'s `src/routes/` layout): **admin** (school-wide oversight, creates teachers and classes), **teacher** (manages assigned classes), **student** (self-registers, tracks own progress). `DESIGN.md` is the visual identity reference; this spine specifies information architecture, behavior, and states only. Two confirmed breakpoints: phone (~390-430px single column) and desktop (wide single column, horizontal nav, tables/stat-grids gain a second dimension) — see `DESIGN.md.Layout & Spacing`.

## Information Architecture

Route paths below are observed directly from the Story 1-1 prototype (SvelteKit route-group syntax already in use, e.g. `(auth)`):

| Surface | Route | Reached from | Purpose |
|---|---|---|---|
| Landing / marketing header | `/` | App open, logged out | "MUNICH TIBETAN SUNDAY SCHOOL — CLASS TRACKER" hero + tagline, leads into sign-in or joining a class |
| Sign in | `(auth)/login` | Landing / "SIGN IN" nav button | Email + password sign-in for any role |
| Join a class (student self-register) | `(auth)/join` | Landing / "JOIN A CLASS" nav button (top-level, alongside Sign In) | 3-step wizard: class code → name → guardian consent. See Key Flows. |
| Join — pending | `/join/pending` | Automatic, after submitting the join wizard | Status receipt ("PENDING") confirming the request was sent, who reviews it, and what the student still can't do yet |
| Admin bootstrap | `(auth)/signup` | One-time only; reached via a distinct "ADMIN BOOTSTRAP" button, separate from "JOIN A CLASS" | Promotes the *first* signup to admin via a documented one-time SQL statement. Every subsequent teacher account is created by an admin from `/admin/teachers`, never through this form. [ASSUMPTION] Still not verified whether this route self-disables/redirects once an admin exists — see Open Questions. |
| Admin dashboard | `/admin` | Post sign-in (admin) | Stat tiles (classes / teachers / assignments / **pending** / students) + entry points to Manage Classes / Manage Teachers / Review Requests |
| Admin — classes | `/admin/classes` | Admin dashboard, "MANAGE CLASSES" / nav tab | Create a class (name → system generates an invite code); table of existing classes (name, code, created date) |
| Admin — teachers | `/admin/teachers` | Admin dashboard, "MANAGE TEACHERS" / nav tab | Create a teacher (email, optional display name, assign to one or more classes via checklist); list of all teachers with their class code(s) |
| Requests (admin, backup approval) | `/requests` | Admin dashboard, "REVIEW REQUESTS" / nav tab (badge-counted) | Same route as the teacher's queue below, but scoped to **every class** as an explicit backup path — copy reads "Normally the class's own teacher acts on these." |
| Teacher home | `/teacher` | Post sign-in (teacher) | Greeting ("SIGNED IN AS TEACHER" + name), "SEE MY CLASSES" primary action, "REVIEW REQUESTS" secondary action (badge-counted) |
| Requests (teacher) | `/requests` | Teacher home, "REVIEW REQUESTS" / nav tab (badge-counted) | Pending self-registration requests for classes this teacher is assigned to; approve puts the student on the roster, reject does not |
| Teacher — classes | `/teacher/classes` | Teacher home / nav | List of classes this teacher is assigned to, each showing its invite code; roster/attendance tracking is explicitly out of scope here (belongs to Story 2-1) |

→ Composition reference: `imports/landing-hero-signin-desktop.png`, `imports/admin-dashboard-desktop.png`, `imports/admin-classes-desktop.png`, `imports/join-pending-phone.png`, `imports/admin-requests-backup-phone.png`. Spine wins on conflict.

**[RESOLVED]** The self-registration + pending-approval gap flagged in the prior draft is closed — the user extended the source prototype with `(auth)/join`, `/join/pending`, and the shared `/requests` queue. See Key Flows for the full walk-through and Component/State Patterns below for the new interaction and feedback rules it introduced.

## Voice and Tone

Terse, instructive, no exclamation points, no emoji. Brand voice/aesthetic posture lives in `DESIGN.md`; this is the microcopy behavior.

| Do | Don't |
|---|---|
| "Use the email and password your admin gave you." | "Welcome! Let's get you signed in 🎉" |
| "No students yet — roster tracking arrives in a later story." | "Nothing here yet!" (no context) |
| "This form exists only for the one-time admin-bootstrap step: …" (explain *why* a restricted action exists) | Hide the reasoning and just disable the control |
| Plain role labels: "SIGNED IN AS TEACHER" / "SIGNED IN AS ADMIN" | Cutesy role names |

[ASSUMPTION] "No students yet — roster tracking arrives in a later story." is prototype-internal scaffolding language (explaining to the *reviewer* what's deferred). Do not ship this literal sentence to real users — production empty states should describe the *user's* situation ("No students in this class yet"), not the project's roadmap. Flagged as a Do/Don't rather than silently rewritten, since it's currently the only empty-state example on record.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Primary button | One per screen | Fires the screen's one primary action (sign in, create class, create teacher). Full-width on phone. |
| Secondary (outline) button | Screen's non-default action | Never the only action on a screen; always paired with a primary button elsewhere on the same screen or its parent. |
| Nav tabs | Top bar, role-scoped | Tabs shown are exactly the routes that role can reach (`CLASSES`/`TEACHERS` for admin; none for teacher beyond the brand mark — teacher nav is single-purpose). Active tab = solid `{colors.primary}` fill. |
| Stat tile | Admin dashboard | Read-only. Zero value renders visibly de-emphasized (see `DESIGN.md.Components.stat-tile`) rather than hidden — a "00" still tells the admin the count exists and is legitimately zero. |
| Data table (desktop) / stacked rows (phone) | Classes list, Teachers list | Same dataset, two renderings by breakpoint — not two different information sets. Row order observed as creation order (numbered `01`, `02`, ...), not alphabetical. |
| Invite/class code | Classes list, Teachers list, class-assignment checklist, join wizard, request rows | Rendered as a distinct tracked/blue "code" style. [ASSUMPTION] Intended as click-to-copy (it's the artifact a teacher/admin needs to hand a student to join a class) — not verified interactively in the prototype; confirm before build. |
| Class-assignment checklist | Create-teacher form | Multi-select checkboxes, one row per existing class, each row showing class name + its code so the admin can visually confirm which class they're assigning without leaving the form. |
| Join wizard (3 steps) | `(auth)/join` | Step 1 validates the class code server-side before advancing (observed: unknown code blocks progress with an inline error, see State Patterns); step 2 collects the student's real full name with copy explicitly deferring nickname choice to post-approval; step 3 is a required consent checkbox gating the submit button, paired with a plain-language data-use explanation (what's stored, that nothing is public, that deletion is available on request). |
| Approval queue row | `/requests` (teacher: own classes; admin: all classes as backup) | One row per pending request: name, class-code link, submitted date, APPROVE (primary) / REJECT (secondary) pair. Same component serves both roles — only the dataset scope and the header copy change. |
| Badge-counted nav item | Top nav, home-screen secondary button | "REQUESTS" carries a live count badge (e.g. "REQUESTS 2") on both the nav tab and the home-screen "REVIEW REQUESTS" button; the count decrements immediately as items are decided, in both places at once. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Empty roster | `/teacher/classes` | Class card still renders (name + code); body copy explains the deferred feature rather than showing a blank card. |
| Zero-count stat | `/admin` stat tile | Number renders, visibly de-emphasized in tone (see `DESIGN.md`) rather than a dash or hidden tile. |
| Pending-count stat | `/admin` "PENDING" stat tile | Number renders in `{colors.attention}` (amber) instead of ink — the one stat tile that means "acts as a call to action," not just a fact. |
| One-time gate | `(auth)/signup` | [OPEN QUESTION — still unresolved] What happens when a second person visits this route after an admin already exists? Not shown even in the updated prototype. Needs an explicit decision. |
| Invalid class code | `(auth)/join` step 1 | Input underline turns `{colors.error}` red; inline red text below the field: "No class has that code. Check it with your teacher." Blocks advancing to step 2. |
| Request pending (student's own view) | `/join/pending` | Status badge "PENDING" + a receipt-style summary (name, class, consent) + explanation of who reviews it + "you cannot log homework until a teacher approves you" + a "START OVER" secondary action. |
| Request decided (teacher/admin action) | `/requests` | Immediate, no confirmation dialog. `aria-live="polite"` banner announces the outcome in a full sentence. Nav/home badge counts decrement live. Row relocates from "PENDING" to a "DECIDED — N APPROVED · M REJECTED" section with a status chip (solid blue "APPROVED" / muted gray "REJECTED", the latter also dimming the row's own name text). A "CLEAR REJECTED" secondary action is available once at least one rejection exists. |
| Empty request queue | `/requests` | Distinct from the stat-tile zero treatment: a thin hairline-bordered panel, bold "Nothing waiting" heading, one sentence of body copy. |
| Other form validation / auth errors | `(auth)/login`, `(auth)/signup`, create-class, create-teacher | [OPEN QUESTION — still unresolved] Only the join-wizard class-code field has a demonstrated error state (see above). Sign-in failure, duplicate-email, and create-class/create-teacher validation states remain unobserved — extend the same red-underline-plus-message pattern rather than inventing a new one, but confirm with the user before building. |

## Interaction Primitives

Touch/click-first, no keyboard-shortcut surface — appropriate for the stated audience ("simple enough for non-technical volunteer teachers," SPEC.md). No command palette, no multi-select bulk actions, no drag interactions observed anywhere.

- Tap/click a primary or secondary button to submit/navigate.
- Tap a nav tab to switch section; active state is a solid fill, not an underline.
- Tap an invite/class code to copy it (assumption — confirm).
- Forms are single-column, top-to-bottom, no inline multi-step wizard observed (admin's create-teacher form is one screen: email → display name → class checklist → submit).

**Not yet defined:** any keyboard-only path, screen-reader announcement pattern, or focus-order rule — none of these were exercisable through the read-only prototype exploration. Do not assume shadcn/ARIA defaults are inherited; there is no UI-library dependency in this system (see `DESIGN.md`), so accessibility behavior must be built and specified explicitly.

## Accessibility Floor

WCAG 2.2 AA is the baseline for this project — no lower floor is defensible for a school-facing civic tool. Concretely, still open (not invented here):

- Verify `{colors.primary}` (Signal Blue) against `{colors.surface-base}` (white) meets 4.5:1 for the body-sized text it's used on (invite codes, links) — vivid blues at this apparent saturation are often borderline and may need darkening for text use even if fine for large button fills.
- Verify `{colors.warning}` (Amber) + `{colors.warning-foreground}` meets AA for the banner's body text, not just its heading.
- All-caps display type must not be the *only* signal for headings — retain real heading semantics (`<h1>`/`<h2>`) under the visual treatment, since screen readers should still get "heading level 1: Class Tracker," not a wall of capitalized text.
- Tibetan-script accessibility (line-height, screen-reader language tagging per locale) is an open item tied to the Typography open question in `DESIGN.md`.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| Desktop (observed ~1000px+ content) | Nav goes horizontal (brand + tabs + sign-out in one bar). Stat tiles form a 2×2 grid. Tables render with a dark full-width header row and horizontal columns. |
| Phone (observed ~390-430px) | Nav stacks (brand row, then tabs/sign-out below). Stat tiles still 2×2 but narrower. Tables collapse to stacked, hairline-divided label/value rows. |

[ASSUMPTION] No intermediate tablet breakpoint was demonstrated; treat the layout as fluid between the two observed states rather than assuming a hard third breakpoint until tested.

## Key Flows

### Flow 1 — Admin bootstrap and first teacher (Pemba, volunteer coordinator, setting up for the first Sunday of term)

1. Pemba opens the app for the very first time — no accounts exist yet. He navigates to the one-time bootstrap form.
2. He reads the amber notice explaining this form only works once, then creates his account with the school's admin email.
3. Someone (per AD-4/the architecture) runs the documented one-time SQL statement to promote his account to admin. He signs in.
4. **Climax:** He lands on `/admin` and sees the stat grid at zero — CLASSES 00, TEACHERS 00 — a blank slate that still looks intentional, not broken, because the empty numbers render in the same grid a populated dashboard would use. He goes to Manage Classes, creates "Tibetan Language — Beginners," and the system hands him back an invite code (`4KTM7X`) he can read out to families.
5. He goes to Manage Teachers, creates Dechen's account, checks the box assigning her to that class, and submits. Dechen's row now appears under "ALL TEACHERS" with her class code visible.

Failure: [not designed] what Pemba sees if he mistypes an email that's already registered, or if class creation fails — no error state exists in the source material yet.

### Flow 2 — Teacher checks in on a brand-new class (Dechen, teacher, first login after Pemba creates her account)

1. Dechen receives her login and signs in via `(auth)/login`.
2. **Climax:** `/teacher` greets her by name ("DECHEN WANGMO") and offers exactly one thing to do — "SEE MY CLASSES." There's no dashboard to parse, no navigation to figure out; the single-purpose home screen matches a volunteer teacher who logs in once a week and needs to get to her class instantly.
3. She taps through to `/teacher/classes` and sees "Tibetan Language — Beginners" with its code, and an honest note that roster tracking isn't built yet rather than a confusing blank list.

Failure: [not designed] what Dechen sees if she's assigned to zero classes, or if her session expires mid-flow.

### Flow 3 — A student joins and gets approved (Tenzin Dolma, new student, and Dechen, her teacher)

1. Tenzin's family heard about the class from Dechen, who read out a six-character code at the end of Sunday session: `4KTM7X`.
2. Tenzin opens the app, taps "JOIN A CLASS" from the landing header, and types the code. She mistypes it first — the field turns red with "No class has that code. Check it with your teacher." — corrects it, and the step accepts it, showing the class name back to her ("Tibetan Language — Beginners · 4KTM7X") so she knows she has the right one before continuing.
3. She enters her full name (told explicitly she can pick a nickname later, after approval — the system isn't asking her to commit to a public identity yet).
4. On the consent step, a parent reads the plain-language explanation of what's stored and that it can be deleted on request, checks "I am the parent or guardian, and I consent to this," and submits.
5. **Climax:** Tenzin lands on `/join/pending` — a clear, honest "PENDING" status, not a spinner or an ambiguous "thanks!" page. She knows exactly what she can't do yet (no roster, no leaderboard, no homework log) and who's responsible for changing that.
6. Meanwhile, Dechen's `/teacher` home now shows "REVIEW REQUESTS" with a live badge count. She opens `/requests`, sees Tenzin's row (name, class code, date), and taps APPROVE. A confirmation sentence appears immediately ("Tenzin Dolma was approved — they can now appear on the roster."), the badge count drops, and Tenzin's row moves into the DECIDED history with a blue "APPROVED" chip — a permanent, visible record that this decision was made and by implication who's accountable for it.

Failure: Dechen taps REJECT instead — no confirmation dialog, immediate effect ("will not appear on any roster"), the row still lands in DECIDED history (not silently deleted) with a muted gray chip, so there's always a record even of a rejection. [OPEN QUESTION] What the rejected student sees on their own `/join/pending`-equivalent screen after rejection is not shown — the prototype only demonstrates the reviewer's side of a rejection.

## Open Questions (carried forward, not resolved by invention)

1. ~~Student self-registration + Pending-approval queue~~ — **RESOLVED.** See `(auth)/join`, `/join/pending`, `/requests`, and Flow 3 above.
2. **Admin-bootstrap route behavior after an admin already exists** — redirect? Disable? Still not shown, even in the updated prototype.
3. **Remaining error/validation/loading states** — only the join-wizard's class-code field has a demonstrated error treatment now. Sign-in failure, duplicate-email on create-teacher, create-class validation, and any loading/pending-network state remain unobserved.
4. **What a rejected student sees.** The teacher/admin side of rejection is fully specified; the student-facing consequence (does `/join/pending` update to show rejection? can they resubmit?) is not shown.
5. **Tibetan-script typography fallback** for the all-caps display system (see `DESIGN.md`).
6. **Exact hex/type-family precision** — current values are screenshot-approximated; confirm against the design tool's own export if pixel-perfect fidelity matters for v1, or accept the approximation and move on.
