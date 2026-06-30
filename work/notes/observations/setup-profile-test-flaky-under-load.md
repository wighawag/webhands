# `packages/core` `setup-profile.test.ts` flaked once under machine load

2026-06-30. During a full `pnpm test` run that overlapped with live eval agent
runs, one test in `packages/core/test/setup-profile.test.ts` failed and that
suite reported `1 test | 1 failed` with a ~14s duration (vs ~4.7s normally).
Re-running the file in isolation, and a clean full `pnpm test`, both passed
241/241. Looks like a load/timeout flake, not a real regression (my task only
touched `evals/`). Flagging in case it recurs and wants a longer timeout.
