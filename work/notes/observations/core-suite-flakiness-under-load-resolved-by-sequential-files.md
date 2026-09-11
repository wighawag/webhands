---
title: 'The whole class of "flaky under load" core tests was file parallelism; fixed by fileParallelism:false'
slug: core-suite-flakiness-under-load-resolved-by-sequential-files
type: observation
status: spotted
created: 2026-09-11
---

Five separate observations in this folder report the same shape: a real-browser test
passes alone in a few seconds and times out when the full `packages/core` suite runs
(`goto-wait-navigation-test-flaky-timeout-under-load`,
`setup-profile-headed-test-flaky-timeout-under-load`,
`setup-profile-test-flaky-under-load`,
`tier4-coordinate-screenshot-test-flaky-under-load`,
`tier4-screenshot-flaky-under-full-suite`).

They are one cause, not five. Vitest runs test FILES in parallel workers, and a large
share of this suite starts a real browser, so 48 files at once means many concurrent
Chromium processes on one box. The scarce resource is browser processes, not CPU time,
and raising `testTimeout` (already 60s) only moves the cliff.

Measured here while adding the real-Chrome work, which spawns an additional system
Chrome per test and so pushed the suite past the cliff: a full parallel run produced
EIGHT failures across unrelated files (attach, frame-scoped eval, input-over-RPC,
real-chrome, dom-escape), in a different subset each run, while the same suite was
green sequentially. That is the worst kind of gate: red often enough to be ignored,
never the same red twice.

Fixed by setting `fileParallelism: false` in `packages/core/vitest.config.ts`, with
the reasoning recorded there. Cost is about 100s for the full suite (versus ~65s
parallel-with-failures), which is a fair trade for failures that mean something.
Individual files still run their tests normally, and `--file-parallelism` is still
available for a fast local loop.

The five older notes should be checked and most likely discharged: if they were all
this cause, they are now moot. Not done here because each deserves a re-run to
confirm, and this note is the capture rather than the verdict.
