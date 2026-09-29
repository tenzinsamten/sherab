---
title: 'B9 — /join registration as iX workflow steps (#63)'
type: 'feature'
created: '2026-09-29'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The student registration flow on /join shows its progress with a hand-made, screen-reader-hidden step list, not the iX workflow component, and /join/pending shows no progress at all (#63).

**Approach:** Show the flow with `ix-workflow-steps` / `ix-workflow-step` on both pages. Sign-in stays a single form. Fields, validation, server actions and posted values are unchanged.

**Decisions (user, 2026-09-29):**
- Four steps: Class code → Your name → Parent consent → Waiting for approval. On /join, steps 1–3 follow the current step; step 4 is shown but not reached. On /join/pending, steps 1–3 are done and "Waiting for approval" is the current step.
- Finished steps are clickable on /join to go back to them, keeping typed values; the current and later steps are not. The existing Back buttons stay.
- Progress stays announced to screen readers (the current step is marked `aria-current="step"` by iX; the existing polite "Step N of …" line is kept and updated for four steps).

</frozen-after-approval>

## Implementation Notes

2026-09-29:
- New `src/lib/components/JoinSteps.svelte` renders `ix-workflow-steps` with four `ix-workflow-step`s and the polite "Step N of 4" line.
  - Steps before `current` are `status="success"` (check icon).
  - When `onselect` is given, steps after `current` are `disabled` and `clickable` is on. `stepSelected` is cancelled for the current and later steps, so iX doesn't move the selection.
  - Wrapped in `{#key current}`: `ix-workflow-steps` applies `selected-index` only on load and child-list changes; it has no watcher.
- `src/routes/(auth)/join/+page.svelte`: the hand-made `ol.join-steps` and its sr-only line are replaced by `<JoinSteps current={step} onselect={goToStep} />`. `goToStep` only goes back. Code, name, email and consent live in page state, so they survive going back.
- `src/routes/(auth)/join/pending/+page.svelte`: `<JoinSteps current={4} />` (not clickable).
- messages en/de/bo:
  - `join_step_progress` is now "…of 4".
  - New keys: `join_step_code`, `join_step_name`, `join_step_consent`, `join_step_waiting`.
  - bo uses English placeholders, as its neighbours do.
- `src/app.css`: the `.join-steps` list rules are removed.
- `e2e/auth-fields.e2e.ts`, two tests:
  - The steps follow the flow. A later step can't be picked. Clicking step 1 from step 3 keeps the code, and after Continue the name is still there. "Step N of 4" is shown.
  - /join/pending has 4 steps: the first three are `success` and "Waiting for approval" is current.
  - The current step is read from iX's inner `aria-current="step"`. Labels are read from the light DOM, because Playwright text includes the shadow DOM's icon names.
- Review fixes:
  - The steps are `vertical`. Horizontal iX steps are a fixed 12rem each with one-line, ellipsised labels, so four overflowed the card: at 360px the steps were 768px wide and the page scrolled sideways.
  - The steps aren't clickable while the code is checked or the form is sent.
  - Going back focuses that step's field (the native input, via `getNativeInputElement`).
  - The live line names the step ("Step 2 of 4: Your name").
  - e2e additions:
    - email and consent survive going back to step 1 and returning;
    - the Back button moves the steps;
    - later steps are `disabled`;
    - `currentStep` fails loudly if iX's markup changes;
    - a 360px viewport has no sideways scroll.
  - #63 marked "fixed, to verify".

## Review Triage Log

- high · patch — Four horizontal steps overflowed the card and scrolled the page sideways (768px wide at a 360px viewport; the card is narrower than 4×12rem on desktop too). Fixed with `vertical`, plus an e2e check at 360px.
- medium · patch — The steps were clickable while the code was being checked or step 3 was posting, so going back would unmount the form mid-request. `onselect` is now withheld while busy.
- medium · patch — Picking a step rebuilt the steps and dropped focus to <body>. Focus now moves to that step's input.
- medium · patch — Step 3's email and consent surviving a trip back was untested. Test added.
- low · patch — The live line didn't name the step. It now reads "Step N of 4: <label>".
- low · patch — The disabled-step check used `force: true` only. It now also asserts the `disabled` property.
- low · patch — `currentStep` returned 0 silently if iX's markup changed. It now throws.
- low · patch — #63 was still `open` in the tracker. Updated.
- low · rejected — "Step 4 of 4" on /join/pending reads oddly. With the step named ("Step 4 of 4: Waiting for approval") it is clear.
- low · rejected — The `goToStep` cast hides the page/component step type difference. It is guarded by `target < step`, so it is only a style point.
- low · rejected — The Tibetan step labels are English placeholders. That is existing practice for bo.json.
