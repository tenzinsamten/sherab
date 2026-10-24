---
title: 'Ask before leaving a changed homework or syllabus form (#121)'
type: 'bugfix'
created: '2026-10-24'
status: 'done'
baseline_commit: 'a4005f101391db206c69c911e48d5b65f1fc133c'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The homework create and edit forms and the syllabus section form have no guard: one tap on the always-visible bottom nav, a link, or Back drops what the teacher typed.

**Approach:** A shared guard (`src/lib/unsaved.svelte.ts`) for these three forms. A form is changed when its posted values (FormData: fields, the rich-text editor's hidden JSON, chosen files by name and size) differ from a snapshot taken before the teacher's first edit. Leaving a changed form inside the app (nav, link, Back) is cancelled and the page's ConfirmDialog asks "Leave this page? What you typed is not saved." with a red "Leave" (stay = Cancel); Leave continues to the same address. Reload or closing the tab use the browser's own prompt (SvelteKit `cancel()` on an unloading navigation); a link to an outside address asks the same in-app question (amended 2026-10-24 by the user: SvelteKit's `cancel()` there only drops the click), and Leave opens it. Submitting the form never asks (its own redirect after a save passes), and a successful save takes a new snapshot.

## Boundaries & Constraints

**Always:** New texts `unsaved_leave_confirm`, `unsaved_leave_okay` in en, de, bo (Tibetan: the assistant's draft for the user to review). One question at a time: reuse the page's existing `createConfirm` / `ConfirmDialog` where there is one (homework edit page, `SyllabusDetail`), add one to the create page.

**Never:** No guard on other forms (admin, account, requests, the homework edit page's pause/end/archive/status forms). No autosave or draft storage. No change to the actions or `createPending`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unchanged | form opened, nothing typed, tap bottom nav | leaves without asking | N/A |
| Changed, in-app | title typed, tap a nav link | dialog; Cancel stays with the text; Leave goes to that link | N/A |
| Changed, Back | text in the editor, browser Back | dialog; Cancel stays; Leave goes back | N/A |
| Typed then undone | value changed and changed back | leaves without asking | N/A |
| Changed, reload | title typed, reload | browser's own leave prompt | N/A |
| Save | changed, submit, server redirects (create) or answers (edit, syllabus) | no question; after an edit/syllabus save, leaving asks nothing until a new change | a failed save keeps the guard |

</frozen-after-approval>

## Code Map

- `src/lib/confirm.svelte.ts` -- `createConfirm()`: `ask(message, okay, { destructive })` resolves true/false; `ConfirmDialog.svelte` renders it.
- `src/routes/teacher/classes/[id]/homework/new/+page.svelte` -- create form l.146-150 (`enctype="multipart/form-data"`, `use:enhance={submitCreate}`, success redirects to the list); no ConfirmDialog yet.
- `src/routes/teacher/classes/[id]/homework/[assignmentId]/+page.svelte` -- the edit form inside `<details>` l.212-221 (`pending.submit('edit', { reset: false })`); page has `confirm` (l.41) and `<ConfirmDialog>`; other forms on the page are not guarded.
- `src/lib/components/SyllabusForm.svelte` -- form l.53-59 (`pending.submit(() => saveKey, { reset: false })`), one per open section; rendered by `SyllabusDetail.svelte:155`, which owns `confirm` (l.95) and `<ConfirmDialog>` (l.342): pass the confirm down or ask through it.
- `src/lib/components/RichTextEditor.svelte:316` -- `<input type="hidden" {name} value={json} />`. The editor may normalise its JSON on mount: take the snapshot after mount (e.g. at the form's first `focusin`/`pointerdown`, before any edit), so an untouched form is not "changed".
- `src/lib/components/PageTour.svelte` -- the only existing `beforeNavigate`; it must keep working.
- SvelteKit 2.70: `beforeNavigate(({ cancel, to, willUnload, type }) => …)`; `goto(to.url)` after Leave (set a bypass flag so the guard does not ask again).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/unsaved.svelte.ts` -- the guard: snapshot, changed check, `beforeNavigate` with confirm or browser prompt, bypass while submitting and after Leave, re-snapshot on a successful save.
- [x] the three forms -- use it; the create page gets a `ConfirmDialog`.
- [x] `messages/{en,de,bo}.json` -- the two texts.
- [x] `src/lib/unsaved.spec.ts` -- the changed check (fields, hidden JSON, files, typed-then-undone).
- [x] an e2e file or test (e.g. in `e2e/teacher-mobile.e2e.ts` or a new `e2e/unsaved.e2e.ts`) -- the matrix rows on the create page, and one changed syllabus section; reload via `page.on('dialog')`.

**Acceptance Criteria:**
- Given a changed homework title on a phone, when the teacher taps the bottom nav and then Cancel, then the page and the title are still there.
- Given a homework created successfully, when the server redirects to the list, then no question appears.
- Given the page under Tibetan, when the question shows, then it is the Tibetan text.

## Implementation Notes

- Implementation (agent): `src/lib/unsaved.svelte.ts` (`createUnsavedGuard(confirm)` with `track` action and `submit` wrapper; `formSignature`, `isChanged`), used by the create page (new ConfirmDialog), the edit form only on the edit page, and `SyllabusDetail` → `SyllabusForm` (`unsaved` prop). Same-page hash links never ask. Another form's redirect on the edit page asks if the edit form is changed. A file set by script without a touch is not counted. A running tour stops even when the teacher stays.

## Spec Change Log

- 2026-10-24: outside links. The frozen Approach said an outside address gets the browser's prompt; in SvelteKit 2.70 `cancel()` there only drops the click (no prompt). The user chose the in-app question for outside links; Approach amended. KEEP: everything else as built.

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind + edge | Syllabus delete redirect asks "Leave?" after a confirmed delete | medium | The hidden delete form (`SyllabusDetail.svelte:339`) is not wrapped; `deleteSyllabus` redirects | patch |
| 2 | blind + edge | `submitting > 0` exempts every navigation during a save | medium | Nav during a slow save leaves silently; a failed save then loses the text | patch |
| 3 | blind + edge | Editor typed-then-undone counts as changed | medium | `RichTextEditor.svelte:56` starts from the server's JSON string, `:104` re-serialises with `getJSON()`; breaks a frozen matrix row | patch |
| 4 | verification-gap + blind | Failed save keeping the guard untested | medium | Frozen matrix row with no test | patch |
| 5 | blind + edge | `bypass` stays on if an outside address does not unload | low | Needs a download/204 link on these forms (none); a reset risks a second prompt during a real unload | reject |
| 6 | blind + edge | Replay after Leave drops goto options; popstate without delta pushes | low | Plain links on these pages; SvelteKit sets `delta` on its popstate navigations | reject |
| 7 | blind + edge | Browser-restored or autofilled values before the first touch become the baseline | low | Real, rare on these teacher forms; documented in the docblock | patch (doc) |
| 8 | blind | Guard logic has no unit tests | low | Behaviour covered end to end; the failed-save test added | reject |
| 9 | blind | Section's in-page Cancel discards without asking | low | Deliberate (an explicit discard); documented | patch (doc) |
| 10 | blind | `changed` returned but unused | low | Direct deletion | patch |
| 11 | blind | Shared confirm: a navigation during an open Pause/End question replaces it | low | Needs a swipe-back while a modal dialog is open; `createConfirm` answers the old question no | reject |
