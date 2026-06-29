# run-eval.ts: temp-home cleanup is unreachable dead code

2026-06-29 (noticed while building `eval-saucedemo-tier1`)

In `evals/src/run-eval.ts`, `runEval` has a `return {...}` immediately before the
"Assert FIRST, clean SECOND" block that removes the isolated `home` on a clean
PASS, so that cleanup (the `rm(home, ...)` on PASS) and the second `return` are
UNREACHABLE. Effect: the isolated temp `WEBHANDS_HOME` is never removed even on
PASS (it relies on the OS temp dir being reaped), and the prd D2
"only a clean PASS removes the home; FAIL/INCONCLUSIVE keeps it" intent is not
actually exercised. Landed in the `eval-harness-foundation` task; out of scope
for the SauceDemo eval task. Worth a small follow-up to drop the premature
return (or hoist the cleanup before it).
