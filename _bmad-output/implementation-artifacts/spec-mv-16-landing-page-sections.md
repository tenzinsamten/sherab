---
title: 'Landing page: How joining works and What Sherab tracks (#16)'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: '75f5fd495cc1ad3f45ed594086e07f051a9972c6'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The signed-out landing page `/` is a lone welcome card with Sign in and Join a class, so a new parent learns nothing about how joining works or what the app is for (#16, user 2026-09-23: "home page looks very empty"). The stacked full-width buttons are already done; the two content sections the user decided on are not.

**Approach:** Below the welcome card, add two static sections: **How joining works** (three numbered steps) and **What Sherab tracks** (four icon cards: attendance, homework, skills, streaks with the team leaderboard). Text only, no data loading; phone-first, a card grid from tablet up.

**Decided (user, 2026-10-22): the joining steps, option A, parent account first.** 1. **Create your parent account**: on Sign in choose "Parent? Create an account"; the school approves it. 2. **Register your child**: "Join a class" with the class code from the teacher, your child's name and your email; write down the username and PIN shown. 3. **The teacher approves**: your child signs in and sees the class.

## Boundaries & Constraints

**Always:** Current components only (Tailwind utilities, `ui` classes from `src/lib/ui/classes.ts`, Lucide icons with `aria-hidden`). Every new string in `messages/en.json`, `de.json` and `bo.json` (key parity is 1176 today). Sections use real headings (h2 for each section, h3 per step/card) under the card's h1. No horizontal scroll at 375px in en, de and bo. The page keeps exactly one `main > [data-ui="new"][data-hydrated]` root (e2e `ready()` waits on it).

**Never:** No iX. No server load or DB query on `/` (signed-in users are still redirected by `+page.server.ts`). No signed-in summary cards (superseded by #18). No change to the welcome card's content or buttons, or to other pages using `AuthCard` beyond what the shared root needs.

</frozen-after-approval>

## Code Map

- `src/routes/+page.svelte` -- the landing page: `AuthCard` with title, blurb, Sign in / Join buttons, Help footer. Sections go here.
- `src/lib/components/AuthCard.svelte` -- its root div (`data-ui="new" data-auth-card data-hydrated`, `flex justify-center px-4 py-8 md:py-12`) wraps a `max-w-md` card. Add an optional `after` snippet rendered inside the root, below the card, so the page keeps one new-UI root. Change the root to `flex-col items-center` (same centring for every other auth page).
- `src/lib/ui/classes.ts` -- reuse `ui.card`, `ui.cardTitle`, `ui.muted`, `ui.heading`; no new entries unless reused.
- `messages/{en,de,bo}.json` -- new `home_join_*` and `home_tracks_*` keys next to `home_welcome_*` (line ~89). Facts for the wording: `help_parent_1_body`–`help_parent_4_body` (lines ~1025–1032), `login_register_parent_link`.
- `e2e/auth-mobile.e2e.ts:612` -- "every auth page at 375px … fits" loops over `/` in en, de, bo; extend it, do not duplicate it.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/AuthCard.svelte` -- add optional `after?: Snippet`, render it below the card inside the root; root becomes a centred column -- one hydrated root, wider content allowed
- [x] `messages/en.json`, `de.json`, `bo.json` -- section headings, step titles + bodies, four card titles + one-line bodies -- en/de/bo parity
- [x] `src/routes/+page.svelte` -- `{#snippet after()}` with the two sections: an ordered list of the three steps; four cards in a 1-column grid, 2 columns from `sm`, at most `max-w-5xl` wide; Lucide icons (e.g. CalendarCheck, BookOpen, Music, Flame/Trophy) -- the content
- [x] `e2e/auth-mobile.e2e.ts` -- on `/`, assert both section headings, 3 steps and 4 cards are visible in each locale; the existing fit check covers overflow -- regression net

**Acceptance Criteria:**
- Given a signed-out visitor at 375px, when they open `/`, then they see the welcome card with its buttons first, then "How joining works" with three numbered steps, then "What Sherab tracks" with four cards in one column, with no horizontal scroll.
- Given 820px or wider, when `/` opens, then the four cards sit in two columns and the sections are no wider than `max-w-5xl`.
- Given the interface in de or bo, when `/` opens, then every new text is in that language and fits.
- Given a signed-in user, when they open `/`, then they are still redirected to their role's start page.
- Given any other `AuthCard` page (login, register, forgot password), when it opens, then it looks as before.

## Implementation Notes

- 16 new keys (`home_join_heading`, `home_join_{1,2,3}_{title,body}`, `home_tracks_heading`, `home_tracks_{attendance,homework,skills,streaks}_{title,body}`); parity is now 1192 in en/de/bo.
- Tibetan (bo) texts are drafted by the assistant from existing terms (help_parent_*, help_teacher_5, leaderboard_*, student_streak_*) and are **not reviewed by a Tibetan reader**.
- Steps are `<ol>` items with an `aria-hidden` number badge; cards are a `<ul>` grid (1 column, 2 from `sm`), wrapper `max-w-5xl`. Sections carry `data-testid="home-join"` / `"home-tracks"` for the e2e check.
- Review fixes: step 1 now includes confirming the email link before school approval; step 2 follows `help_parent_4_body` (sign out once approved, class code, child's name, parent-account email, consent box, username and PIN shown only once); step 3 says the child can sign in right away; the streaks card says attending class and finishing homework in the same week. Section h2s are `text-xl` (one step below the card's h1); step/card h3s use `cn(ui.cardTitle, 'mb-0 wrap-break-word')`. The e2e loop on `/` now also checks, at 820px, that the cards are in two columns and the sections come after the welcome card, and at 1440px that `home-sections` is at most 1024px wide. The revised bo strings are still the assistant's draft, not reviewed by a Tibetan reader.
- Measured: no horizontal scroll at 375/820/1440 in en, de, bo; one column at 375, two at 820 and 1440; section width 343/788/1024px.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind | Step 1 omits confirming the email before approval | low | `help_parent_2_body`: approval follows the email link; `home_join_1_body` skips it. Direct text fix. | patch |
| 2 | blind | Step 2 omits signing out and ticking the consent box | medium | `(auth)/join/+page.server.ts:104-108` redirects a signed-in user away from `/join`; consent is required (`join_error_consent_required`). An approved, signed-in parent following the steps cannot reach the form. | patch |
| 3 | blind | "your email" should be the parent account's email | low | `help_parent_4_body` says "the email of your parent account"; the join form matches it against that account. | patch |
| 4 | blind | Username and PIN drop "shown once" | low | `help_parent_4_body`: "shown once: write them down". One-word fix. | patch |
| 5 | blind | Step 3 body hides that the child can sign in right away | low | `help_parent_4_body`: "can sign in right away and sees the class once the teacher has approved them". Title is the user's decided wording, kept; body text fix. | patch |
| 6 | blind | No link to `/help` from the sections | false | The card footer right above already links to `/help` (`+page.svelte` footer snippet). | reject |
| 7 | blind | h2s as large as the page h1 | low | Both use `text-2xl font-bold`; cosmetic, direct class change. | patch |
| 8 | blind | h3s repeat `ui.cardTitle` inline | low | Code Map said reuse `ui.cardTitle`; a later card-title change would miss this page. Direct change. | patch |
| 9 | blind + verification-gap | e2e does not check two columns at 820px, the width cap or card-before-sections order | medium | Pre-verified by the verification-gap layer: test opens `/` only at 375px; removing `sm:grid-cols-2` or moving `after` above the card passes. | patch |
| 10 | blind | Nothing guards other AuthCard pages after the root change | false | `e2e/login-visual.e2e.ts` screenshots `[data-auth-card]` on `/login` and passed after the change. | reject |
| 11 | blind | bo copy mixes registers; e2e hard-codes bo headings | maybe-false | Needs a Tibetan reader; the unreviewed status is already recorded per project convention. If true only low (wording, test edit). | reject (noted for the Tibetan review) |
| 12 | blind | Streak card says "Class and homework" instead of attending | low | `student_streak_empty` / `help_student_5_body` say "Attend … and finish homework in the same week". Direct text fix (en/de/bo). | patch |
| 13 | edge-case | (no findings) | — | Layer returned an empty list. | — |

## Design Notes

The sections sit outside the 28rem card because four cards in a phone-wide card read as a wall; on a phone they simply follow the card at full width. Steps use `<ol>` with a visible number badge so the order survives screen readers. Tibetan texts follow the project convention: the assistant drafts them and the log flags them as not reviewed by a Tibetan reader.

## Verification

**Commands:**
- `npm run supabase:reset && npm test && npm run check && npm run lint && npm run build` -- expected: each exits 0
- `npx playwright test e2e/auth-mobile.e2e.ts` -- expected: all pass

**Manual checks (if no CLI):**
- `/` at 375, 820 and 1440px in en, de and bo: sections readable, Atisha on Tibetan text.
