# goto-wait navigation-form test flaky under full-suite load (2026-06-29)

`packages/core/test/goto-wait-verbs.test.ts > wait > navigation form: blocks
until the pending JS redirect settles` intermittently times out at its 5000ms
`testTimeout` when run as part of the full `pnpm --filter @webhands/core test`
suite (many real-browser tests contend for CPU). In isolation the same test
passes in ~360ms, and a re-run of the whole core suite passed 218/218. Looks
like a load-dependent timeout, not a logic bug. Spotted while running the gate
for the eval-harness-foundation task (which adds no `packages/core` code); not
investigated or fixed (out of scope).
