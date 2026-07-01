---
'@webhands/core': minor
'webhands': minor
---

Add `distill --test`: validate the just-emitted hand scaffold by running its replay against the LIVE page through the existing `script` verb (ADR-0012), reporting pass/fail loudly. This is the validation half of the `distill-session-into-hand` prd (story 5); it reuses `script` verbatim and adds no new execution surface.

- **Reuse `script`, no new surface.** `distillTrace(...)` now also returns `replayScript`: the SAME distilled replay rendered as the `script` verb's driver-context shape (an `async (page) => { ... }` function of the live Playwright `page`). It is built from the SAME per-step replay lines as the emitted `Hand` scaffold, so the tested source and the scaffold cannot drift. Exposed as `renderReplayScript` alongside `distillTrace`.
- **`distill --test`.** When `--test` is passed, the verb runs `replayScript` against the served session via `page.script(...)` (the exact ADR-0012 mechanism) and reports the outcome in a new optional `test` field: `{passed: true, result}` on a clean replay (PASS) or `{passed: false, error}` on a throw (FAIL), reusing `script`'s structured-error path. A throwing scaffold is a clean, typed FAIL surfaced loudly (a `--test` cta line), never a silent pass. Omitting `--test` leaves the emit-only output shape unchanged.
- **HARD INVARIANT preserved.** `--test` only RUNS the replay in the sandboxed page-context tier: it never writes `hands.json` and never `import()`s the emitted module. Adopting a hand (naming it in `hands.json`) stays the operator's explicit trust act (ADR-0007). Tested: with `--test`, no `hands.json` is written anywhere and only the scaffold + notes land under `--out`.
- **PASS + FAIL are tested** against a real served browser on the local fixture (mirroring the `script` verb's seam test): a good scaffold replays and reports PASS; a broken step (a `select` on a non-`<select>`) throws fast and reports a typed FAIL. Shared-write isolation holds (temp `--out`, no real home/config write).
