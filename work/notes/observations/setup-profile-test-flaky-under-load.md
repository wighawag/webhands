# `packages/core` `setup-profile.test.ts` flaked once under machine load

2026-06-30. During a full `pnpm test` run that overlapped with live eval agent
runs, one test in `packages/core/test/setup-profile.test.ts` failed and that
suite reported `1 test | 1 failed` with a ~14s duration (vs ~4.7s normally).
Re-running the file in isolation, and a clean full `pnpm test`, both passed
241/241. Looks like a load/timeout flake, not a real regression (my task only
touched `evals/`). Flagging in case it recurs and wants a longer timeout.

2026-07-01 (recurred, different symptom, same root cause). During the full
`pnpm --filter './packages/*' test` gate, `setup-profile.test.ts >` "is
idempotent: re-running against an already-set-up profile is fine" failed with
`ENOTEMPTY: directory not empty, rmdir '.../profiles/again/Default'` (a temp-dir
cleanup race, not a timeout). Re-running the file in isolation passed 5/5. Same
pattern: flaky only under full parallel suite load, green alone. Noticed while
working the `env-placeholder-substitution-and-dotenv-loading` task, which does
NOT touch `setup-profile`. The teardown `rm(..., {recursive:true})` likely races
the still-closing headed browser flushing its profile dir; a retry or a
wait-for-close before cleanup would harden it.
