# setup-profile headed-browser test flaky under full-suite load (2026-06-29)

`packages/core/test/setup-profile.test.ts > setupProfile (real headed browser,
local fixture) > "creates and opens the dedicated profile dir headed, and
prompts"` intermittently times out at its 5000ms `testTimeout` when run as part
of the full `pnpm --filter @webhands/core test` suite (many real-browser tests
contend for CPU). The timeout then cascades into an `ENOTEMPTY: directory not
empty, rmdir '.../profiles/default'` on teardown, because the still-running
headed browser is holding the profile dir open when the test's `afterEach`
cleanup races to remove it.

In isolation the same file passes 5/5 in ~6s (verified by re-running
`pnpm --filter @webhands/core test setup-profile` off the exact branch tip).
Load-dependent timeout, not a logic bug.

Same pattern as `goto-wait-navigation-test-flaky-timeout-under-load.md`: a
real-browser test with a tight 5000ms `testTimeout` that wins in isolation but
loses under whole-suite CPU contention. Two instances now share this signature;
a fix would likely be a generous-per-test-timeout pass (or serialising the
real-browser tests) across `packages/core`, not a per-test patch.

Spotted while running dorfl's acceptance gate for
`eval-playwright-only-baseline-comparison` (an evals-ONLY task that touches no
`packages/core` code, so the flake is unrelated to the diff under review). The
PR's own change is green: the evals self-test passed 62/62 off the branch, and
this `packages/core` flake passed on isolated re-run. Treated as a flake (the
PR was merged on a sound Gate-3); not investigated or fixed (out of scope).

UPDATE (2026-06-29, `eval-baseline-shared-driving-surface-over-cdp`): a THIRD
test now shows the same signature. Two consecutive full
`pnpm --filter @webhands/core test` runs each failed a DIFFERENT real-browser
test (`tier4-coordinate-screenshot.test.ts` shared-write isolation on run 1,
`setup-profile.test.ts` headed-prompt on run 2), and BOTH pass 10/10 and 5/5
respectively in isolation; my own new CDP tests passed 14/14 twice. So the
full-suite failures are this same load-contention flake, not a regression from
this task's diff. Reinforces the suggested fix (generous per-test timeout or
serialising the real-browser tests across `packages/core`); still out of scope
here.
