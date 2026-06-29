# `runEval` home-cleanup-on-PASS is dead code

2026-06-29 (noticed while building `eval-stateful-tier2`)

In `evals/src/run-eval.ts`, the `try` block does `return {...}` and *then* has
the `if (ownsHome && !opts.keepHome && outcome.kind === 'PASS') { await rm(home...) }`
cleanup block followed by a second identical `return`. The first `return` makes
the cleanup block (and the second return) unreachable, so the isolated temp home
is NEVER removed on PASS, it is only ever cleaned in the `afterEach` of tests or
left behind by the `run-eval` bin. Harmless-ish (temp dirs accumulate under
`$TMPDIR`) but the documented "remove home on a clean PASS" behaviour did not
actually happen.

NOTE (same day): this exact region had to be restructured to thread the D2
assert-then-best-effort-cleanup hook through `runEval` for `eval-stateful-tier2`,
which incidentally collapsed the duplicate `return` and made the
home-cleanup-on-PASS reachable again. So the dead code is gone as of that task;
kept here as the record of what was originally observed.
