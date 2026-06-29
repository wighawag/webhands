---
title: Record agent TOKEN usage in eval output (the webhands-vs-Playwright-only "does webhands deliver?" measure)
slug: eval-token-accounting-for-webhands-vs-baseline
blockedBy: []
covers: []
---

## What to build

Make the eval harness record and report **how many tokens the agent-under-test burned** to reach (or fail) the goal, so a run's result carries a COST alongside its pass/fail/milestones. The motivating use is comparison: run the same goal with a **webhands** agent vs. a **Playwright-only** agent (no webhands) and compare tokens + pass-rate. If the webhands agent reaches the goal in far fewer tokens, the verb surface is earning its keep; that is the concrete answer to "does webhands deliver?" (the prd `agent-capability-eval-harness` north star). This task builds ONLY the token accounting + reporting; the Playwright-only baseline configuration is a separate follow-on (captured as an idea) that DEPENDS on this.

End-to-end vertical slice:

- **A `usage` field on the launch result.** Extend the `AgentUnderTest` seam's `LaunchResult` with an optional, structured token-usage record (input / output / cached / total tokens, and cost if available). It is OPTIONAL because token capture is inherently **adapter-specific**: an adapter that cannot observe its agent's usage reports `undefined` (honest "unknown"), never a fake zero.
- **Adapter-specific capture (best-effort, honest).** The capture lives in the adapter that knows the agent:
  - The generic SHELL adapter cannot in general know an arbitrary command's token usage, so by default it reports `usage: undefined` (unknown). If it is driving an agent whose stdout is a parseable usage stream (e.g. pi `--mode json`, whose events already carry a `usage` object with `input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens`/`cost`), it MAY sum those events into the usage record. Keep this parsing clearly OPT-IN / best-effort, not a hard dependency on any agent's output shape.
  - This is additional motivation for the deferred pi-native adapter (`work/notes/ideas/pi-native-adapter-for-eval-harness.md`): a pi-native adapter parses pi's `--mode json` event stream as a first-class capability and gets exact, structured usage for free. This task does NOT build that adapter; it only adds the usage field the adapter would later fill exactly.
- **Report the usage in the eval result + the runner output.** The `EvalRunResult` carries the usage; the `run-eval` CLI prints it on the result line (e.g. `... -> PASS (milestones 3/4) [tokens: in 12.3k / out 4.1k / total 16.4k]`, or `[tokens: unknown]` when the adapter could not capture them). Keep it a plain, machine-readable-ish summary so runs are comparable across agents.
- **Toolkit-agnostic by construction.** Nothing here may assume webhands: the usage field + reporting must be identical whether the agent used webhands or only Playwright, so the two configurations are directly comparable on the SAME field. (This is the agent-toolkit-agnostic stance recorded in `work/notes/observations/eval-end-state-assertion-needs-the-agent-to-leave-the-session-open.md`.)

This stays NON-GATING and lives entirely under `evals/` (outside `packages/*`), like the rest of the harness. The deterministic D3 self-test gains a small unit covering the usage plumbing (a fake adapter returns a known usage; the result + the printed line reflect it; an adapter returning `undefined` prints `unknown`), runnable under the `evals` `self-test` script (never `pnpm test`).

## Acceptance criteria

- [ ] `LaunchResult` carries an OPTIONAL structured token-usage record (input/output/cached/total, cost optional); `undefined` means "the adapter could not observe usage" (never a fake zero).
- [ ] The generic shell adapter reports `usage: undefined` by default, AND can OPT-IN to summing usage from a parseable agent stream (pi `--mode json` `usage` events) without hard-depending on any agent's output shape.
- [ ] `EvalRunResult` carries the usage and the `run-eval` CLI prints a compact, comparable token summary on the result line (and `unknown` when uncaptured).
- [ ] The usage field + reporting are toolkit-agnostic (identical for a webhands agent and a Playwright-only agent), so the two are directly comparable.
- [ ] A deterministic self-test covers the usage plumbing (a fake adapter with known usage -> result + printed line reflect it; an `undefined` adapter -> `unknown`), under the `evals` `self-test` script, NOT `pnpm test`.
- [ ] Stays non-gating and under `evals/` (outside `packages/*`); no live-site test enters the gate.
- [ ] No new webhands verb; the harness charter (a measurement tool, adds no verbs) is unchanged.

## Blocked by

- None, can start immediately. (It is independent of the per-tier eval tasks; it touches the foundation's seam + runner.)

## Prompt

> Goal: add agent TOKEN-USAGE accounting to the eval harness output, so each run reports how many tokens the agent burned alongside its pass/fail/milestones. The motivating use is the "does webhands deliver?" comparison: the same goal run by a webhands agent vs. a Playwright-only agent, compared on tokens + pass-rate (the prd `work/prds/tasked/agent-capability-eval-harness.md` north star). Build ONLY the token accounting + reporting here; the Playwright-only baseline configuration is a separate follow-on that depends on this.
>
> READ FIRST: the eval-harness foundation (`evals/src/agent-under-test.ts` for the `AgentUnderTest` seam + `LaunchResult`; `evals/src/run-eval.ts` for `EvalRunResult`; `evals/src/bin/run-evals.ts` for the result line) and `work/notes/observations/eval-end-state-assertion-needs-the-agent-to-leave-the-session-open.md` (the agent-toolkit-agnostic stance: the harness must treat webhands and Playwright-only agents identically). For pi's usage shape, note that `pi --mode json` emits NDJSON events carrying a `usage` object (`input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens`/`cost`) per message (confirmed live 2026-06-29); the generic shell adapter MAY sum those when driving pi, but must NOT hard-depend on any agent's output shape.
>
> KEY DESIGN POINTS: token capture is ADAPTER-SPECIFIC and BEST-EFFORT. Add an OPTIONAL structured usage record to `LaunchResult`; `undefined` = "could not observe" (honest unknown, never a fake zero). The shell adapter defaults to `undefined` and opt-in parses pi's json `usage` events when applicable. Surface the usage on `EvalRunResult` and print a compact comparable summary on the `run-eval` line (or `tokens: unknown`). Everything must be toolkit-agnostic so a webhands run and a Playwright-only run are comparable on the SAME field. Stay NON-GATING and under `evals/`; add a deterministic self-test (fake adapter with known usage; the result + printed line reflect it; an `undefined` adapter prints `unknown`) under the `evals` `self-test` script, never `pnpm test`. Add NO new webhands verb.
>
> What "done" means: an eval run reports the agent's token usage (or a clear `unknown`) in a comparable form, captured adapter-specifically and honestly, toolkit-agnostic, non-gating, with a self-test covering the plumbing.
>
> FIRST, check this task against current reality: confirm the foundation's `LaunchResult` / `EvalRunResult` / runner shapes are as described (they may have evolved); if a sibling change (e.g. a pi-native adapter) already landed usage capture, reconcile rather than duplicate (WORK-CONTRACT.md "Drift is a needs-attention signal"). RECORD non-obvious in-scope decisions (the usage record shape, the exact result-line format, how the shell adapter opts into pi json parsing).
