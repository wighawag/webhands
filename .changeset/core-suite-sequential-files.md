---
'@webhands/core': patch
---

Run the `packages/core` test files sequentially (`fileParallelism: false`).

A large share of that suite drives a real browser, so the scarce resource is concurrent browser processes rather than CPU time. With the real-Chrome work adding a spawned system Chrome per test, a fully parallel run produced eight failures across unrelated files in a shifting random subset, while the same suite was green sequentially: a gate that is red often enough to be ignored and never the same red twice. Raising timeouts (already 60s) only moves the cliff.

Cost is roughly 100s for the full suite. This also very likely subsumes the five standing `work/notes/observations/*flaky*under*load*` notes, which all describe this one cause. No test or product behaviour changes.
