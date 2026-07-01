---
title: distill --test validates the emitted scaffold via the script verb
slug: distill-test-validates-scaffold-via-script
prd: distill-session-into-hand
blockedBy: [distill-verb-emits-hand-scaffold]
covers: [5]
---

## What to build

Add validation to the `distill` verb so it hands the human a TESTED scaffold, not
a guess: `distill --test` runs the just-emitted hand scaffold against the LIVE page
through the EXISTING `script` verb (ADR-0012) and reports pass/fail LOUDLY.

- **Reuse `script` verbatim.** No new execution surface: the scaffold's hand
  function is a driver-context function of the live Playwright `page`, which is
  exactly what `script` already runs (ADR-0012, file-path-only driver context).
  `--test` executes the emitted module's function via that same mechanism against
  the live served page and captures its serializable result.
- **Report clearly.** A scaffold that replays correctly reports PASS; a broken one
  reports FAIL loudly (reuse `script`'s structured-error path, a throwing scaffold
  is a clean typed failure, not a silent pass).
- **Still emit-and-test only.** `--test` changes NOTHING about the trust line: it
  runs the scaffold in the sandboxed page-context tier; it does NOT write
  `hands.json` and does NOT `import()`/load the module as a hand. Adoption remains
  the human's operator-scoped act.

## Acceptance criteria

- [ ] `distill --test` runs the emitted scaffold against the live page via the
      `script` mechanism and reports PASS when the replay succeeds.
- [ ] A scaffold that throws / fails reports FAIL loudly with a typed, clear error
      (reusing `script`'s error path), never a silent pass.
- [ ] `--test` writes NO `hands.json` and does NOT load/`import()` the module (the
      prd's HARD INVARIANT still holds, assert it, as in the emit task).
- [ ] Tests cover both the PASS and the FAIL path (mirror the repo's existing
      `script` + verb test style), driving against a served page / fixture flow.
- [ ] **Shared/global write isolation:** any files the test emits go to a
      temp/scratch dir; assert no real home/config write and specifically no
      `hands.json` write.

## Blocked by

- `distill-verb-emits-hand-scaffold`, `--test` validates the scaffold that task
  emits.

## Prompt

> Add `distill --test`: validate the hand scaffold `distill` just emitted by running
> it against the LIVE page through the existing `script` verb (ADR-0012), reporting
> pass/fail loudly. See the prd `work/prds/tasked/distill-session-into-hand.md`.
>
> FIRST, check against reality (launch snapshot, may have DRIFTED): confirm the
> `distill` emit task landed as assumed (in `work/tasks/done/`) and re-read how the
> `script` verb runs a driver-context function of the live `page` (ADR-0012,
> file-path-only) and how it returns / errors. If `script` or the emit task differs
> from what this task assumes, route to needs-attention rather than building on a
> stale premise.
>
> Domain vocabulary: `script` runs a caller JS function handed the full live
> Playwright `page` in ONE call and returns a serializable result (ADR-0012); a
> **hand** scaffold's function is that same driver-context shape, so validating it
> is just running it via the `script` mechanism. The HARD INVARIANT still holds:
> `--test` never writes `hands.json` and never loads the module as a hand, it only
> RUNS it in the sandboxed page-context tier.
>
> Seams to test at: the PASS path (a good scaffold replays and reports success) and
> the FAIL path (a throwing scaffold reports a clean typed failure, not a silent
> pass). Keep any emitted files in a temp dir and assert real locations + `hands.json`
> are untouched.
>
> RECORD non-obvious in-scope decisions (how `--test` selects/loads the scaffold to
> run it without treating it as an adopted hand, the pass/fail result shape) in a
> `## Decisions` note or an ADR if it meets the gate.
>
> Every change requires a changeset (`pnpm changeset`).
