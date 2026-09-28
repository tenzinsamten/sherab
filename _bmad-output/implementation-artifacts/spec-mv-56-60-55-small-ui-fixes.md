---
title: 'Manual-verification B1: clickable child card, requests pill, joined class on approval'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'oneshot'
baseline_commit: '0b809c46c72ebdfa7110b54bc7b56b04724e417a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three small UI gaps from manual verification (issues #56, #60, #55 in `_bmad-output/manual-verification-issues.md`).

**Approach:**
- **#56 `/parent`:** each approved child's whole card is a single accessible link to `/parent/children/[id]`, with a visible focus ring. Pending ("Waiting for approval") cards stay plain. The small "Details" text link is no longer needed.
- **#60 Requests count:** the nav item shows the plain label "Requests" plus an `ix-pill` with the pending count when it's above 0 (no "(n)" in the label text). The `/requests` page header counter uses the same pill.
- **#55 Student approval on `/requests`:** each pending student row shows "Joined: <class name>" as a clear, readable label next to the team picker (read-only; enrollment unchanged), instead of only the muted `code · name · date` line.
- **i18n:** new or changed strings exist in en, de and bo.

</frozen-after-approval>

## Implementation Notes

- #56 `src/routes/parent/+page.svelte`: approved child cards are wrapped in one `<a class="tile-link child-card">` (the existing global clickable-card style) with a visible `:focus-visible` outline; pending cards are `passive` and unlinked. The "Details" link and its key `parent_card_sessions_link` are removed.
- #60 `src/routes/+layout.svelte`: the Requests item uses the iX menu item's native `notifications` count badge (omitted at 0) with a plain "Requests" label, plus an sr-only "{count} pending" inside the item. `nav_requests_with_count` removed. `src/routes/requests/+page.svelte`: the header number is now a warning `ix-pill` with an aria-label, hidden at 0 (`pendingTotal`, the same sum as before).
- #55 `src/routes/requests/+page.svelte`: pending student rows show "Joined: <class> <code>" on its own line above the muted date (new key `requests_joined_class`).
- New keys: `requests_pending_count`, `requests_joined_class` (en/de/bo). JSON edited textually to keep the files' blank-line grouping.
- Review patches: bo `requests_pending_count` restored to the Tibetan nav wording ("རེ་སྐུལ། {count}"); nav's extra sr-only span dropped (iX renders the badge as text); header pill uses an sr-only span, not aria-label; parent cards get a chevron and a global `.tile-link:focus-visible` ring in `app.css` (benefits every whole-card link); the joined line is one message with `{code}`.

## Review Triage Log

- bo got English for the nav count, where the removed key was Tibetan — medium, patched (restored Tibetan wording; `requests_joined_class` stays English like the other `join_*` bo strings).
- `aria-label` on `ix-pill` (a generic element) may not be announced — medium, patched (sr-only span).
- sr-only count inside the `ix-menu-item` slot may show in the collapsed tooltip or be read twice — maybe-false/medium, patched by removing it (the iX `notifications` badge is rendered text).
- No visual sign the card is clickable — medium, patched (chevron).
- Focus ring only on this page with hard-coded values — low, patched (moved to a global `.tile-link:focus-visible` with theme tokens).
- The joined line's word order is fixed in markup — low, patched (`{code}` is a message parameter).
- Long accessible name for the card link — low, rejected: name, classes and counts are what a parent needs to hear; `aria-label` would hide the counts.
- Joined label not beside the team picker — low, rejected: it's in the same row as the picker; the approver reads the row.
- Header count and nav badge computed separately — low, rejected: existing design; the sums are unchanged by this change.
- No tests for these UI changes — low, rejected: no component-test setup; parent-page browser tests are already deferred (deferred-work.md).
