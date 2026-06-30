# tier4-coordinate-screenshot test flaky under heavy parallel load

2026-06-30: `packages/core/test/tier4-coordinate-screenshot.test.ts` failed once
(`page.screenshot` at `src/hand-host.ts:1336`) during a full `pnpm test` run that
was contending with other parallel headless-browser work; it passed 10/10 in
isolation and the immediately-following full `pnpm test` was green (241/241 core).
Looks like a resource-contention/timeout flake under load, same family as the
existing `setup-profile-headed-test-flaky-timeout-under-load.md` /
`goto-wait-navigation-test-flaky-timeout-under-load.md` notes, not a logic
regression. Noted while building the evals-only `messy-dom-explore` tier-3 task
(which touches no `packages/` code).
