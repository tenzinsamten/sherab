---
title: 'No interface text left in English under Tibetan by accident (#128)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After the user's Tibetan revision (b600ec1), `roster_upcoming_leave_heading` and `roster_upcoming_leave_empty` were still English in `messages/bo.json`, and `home_poster_hero` ("Class Tracker") was English too.

**Approach:** The two roster texts take the user's own Tibetan from their `/requests` twins (same English): "ཡོང་རྒྱུའི་གུང་གསེང་" and "རྗེས་མའི་བདུན་ཕྲག་ ༡༢ རིང་གུང་གསེང་སྙན་ཞུ་རྒྱབ་མི་འདུག།". `home_poster_hero` stays English on purpose. A unit test (`src/lib/messages.spec.ts`) fails when a Tibetan text equals its English one and is not on an explicit list of intentional ones (the logo, the tagline, units such as KB/MB/PIN and pure placeholders).

**Decisions (2026-10-24):** The user keeps "Class Tracker" in English under Tibetan. On the current branch, as the remaining items.

</frozen-after-approval>

## Implementation Notes

- `messages/bo.json`: the two roster keys. `src/lib/messages.spec.ts`: the leftover check (Latin words outside `{placeholders}`) against `SAME_ON_PURPOSE` (12 keys), and the roster texts equal the Requests ones.
- Review fixes: variant messages (plurals) compared by their `match` texts (declarations and selectors skipped); a second test fails on stale allowlist entries; the allowlist is the five real ones (logo, tagline, KB, MB, PIN) — pure placeholders are never flagged; the comment states the real rule and that it covers Tibetan only. The check catches the bug: run over the old `bo.json` it listed exactly the two roster keys.

## Review Triage Log

- Variant messages never checked — medium (plurals could keep English). Patched.
- Partly translated texts not caught — low; rejected (needs an allowlist of ~45 brand and technical words; exact copies are the common slip).
- Allowlist can go stale — low, direct. Patched (and it found seven unneeded entries).
- `de` not checked — low; rejected (German keeps loanwords such as "Teams"); the comment says Tibetan only.
- Roster equals Requests test pins wording — low; rejected (the two pages show the same notice; kept as a guard).
- No red-then-green proof — low. Answered: the old `bo.json` gave exactly the two roster keys.
- Comment does not match the rule — low, direct. Patched.
- Branch — false: the user asked for the remaining items on this branch.
- Paperwork — false: the spec and this log are committed with the change.
