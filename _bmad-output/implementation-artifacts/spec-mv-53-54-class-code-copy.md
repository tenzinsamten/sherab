---
title: 'Manual-verification B3: class code with copy button (student class page, admin classes)'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'oneshot'
baseline_commit: 'f53992af3f68c5abc869719ad8a171a9080d96bf'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can't see their class's join code to share it (#53). The admin sees codes only as plain text in the classes list, and not at all on a class's page (#54).

**Approach:** Reuse `CopyField` (label + value + copy icon, `copyText` with toast and select fallback) to show the class code with a copy button in three places:
- **Student class page** (`/student/classes/[classId]`): below the heading. The code is loaded with the class (students can already read their classes under RLS; no migration).
- **Admin classes list** (`/admin/classes`): the code cell becomes code + copy button, with the label visually hidden but still accessible.
- **Admin class Students page** (`/admin/classes/[id]/students`, the admin's page for one class): in the header next to the class name.
- **i18n:** reuse the existing class-code label keys where they fit; any new string in en, de and bo.

</frozen-after-approval>

## Implementation Notes

- `CopyField` gains `hideLabel` (label rendered `sr-only`, still read by screen readers), used in the admin classes table whose column header already says "Code".
- The student class loader selects `code` too (RLS already lets enrolled students read their classes; no migration).
- Admin has no class detail page; the per-class page is `/admin/classes/[id]/students`, whose header now shows the code with copy (the loader already read `code`).
- Labels: new `class_code_label` ("Class code" / "Klassencode") for the page headers, decoupled from the join wizard's `join_code_label`; the admin table's hidden label is `classes_col_code` ("Code"), matching its column header.
- `CopyField`'s 9rem label width now applies only inside `.credential-fields` (stacked credentials), so single fields in page headers have no gap.

## Review Triage Log

- The label's 9rem min-width leaves a gap in page headers — low, patched (width scoped to stacked credential fields).
- The hidden table label ("Class code") differs from the column header ("Code"), and the label key is coupled to the join wizard — low, patched (`classes_col_code` in the table, a new `class_code_label` in headers).
- The teacher class page still shows the code without copy — low, deferred (outside #53/#54; a direct `CopyField` swap later).
- The copied code doesn't lead anywhere (no join link, `/join` doesn't pre-fill `?code=`) — low, deferred (enhancement; pairs with #67).
- No tests for the student loader returning `code` or for `hideLabel` — low, rejected: the route has no spec file; RLS read access is unchanged and already covered; `hideLabel` is a class toggle.
- `.credential` styling and comment mean one-time secrets — low, rejected: monospace bold suits a code; comment-only.
- The `copyText` comment is stale; select-on-failure in table cells unchecked — low, rejected: comment-only; the failure path still shows an error toast.
