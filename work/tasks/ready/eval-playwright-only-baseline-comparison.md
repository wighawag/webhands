---
title: A Playwright-only baseline agent config for the eval harness (measure "does webhands deliver?" by comparing tokens + pass-rate against a webhands agent)
slug: eval-playwright-only-baseline-comparison
blockedBy: [eval-token-accounting-for-webhands-vs-baseline]
covers: []
---

## What to build

A second agent configuration for the eval harness that drives the SAME eval goals using **raw Playwright only, with NO webhands**, so a run can be compared against a **webhands** agent on the same goal. Combined with the token accounting (the blocking task), this turns "does webhands deliver?" (the prd `agent-capability-eval-harness` north star) into a measured scoreboard number: same goal, two toolkits, compare **token cost** + **pass-rate / milestones**. If the webhands agent reaches goals in materially fewer tokens and/or with a higher pass-rate, the verb surface is demonstrably earning its keep.

End-to-end vertical slice:

- **A Playwright-only adapter/config behind the SAME `AgentUnderTest` seam.** It launches a real unaided agent (a shell command, the generic adapter) but its **protocol preamble teaches raw Playwright** (drive a browser/page via Playwright APIs) instead of the webhands verb surface. The eval's GOAL and the harness's END-STATE ASSERTION are UNCHANGED between the two configs (the harness still validates via its own reads, never the agent's self-report); only the agent's toolkit + preamble differ. The no-priming rule still binds the goal; the toolkit instruction is a per-adapter PROTOCOL preamble, not goal priming (see `work/notes/observations/eval-end-state-assertion-needs-the-agent-to-leave-the-session-open.md`).
- **Give the Playwright-only agent a way to drive Playwright + a live browser/page WITHOUT going through webhands.** Decide and record: does the agent drive its OWN Playwright (it imports/launches Playwright itself), or does the harness hand it a page/endpoint? Either way, the harness must NOT route this agent through the webhands verb surface (that would defeat the baseline), and the harness's end-state assertion must remain the harness's OWN (it MAY still use webhands read verbs for the verdict, since the verdict mechanism is the harness's, not the agent's toolkit — but the AGENT must not).
- **A comparison output.** Running the same eval id under both configs yields two results comparable on the same fields (outcome, milestones, tokens). Provide a simple way to run/compare (e.g. a `--agent-kind webhands|playwright` selector on the runner, or two `--agent-cmd`s, plus a side-by-side summary). Keep the token + outcome fields identical across configs so the comparison is apples-to-apples.
- **Toolkit-agnostic, non-gating, under `evals/`.** No new webhands verb. Live-by-nature, never in `pnpm test`. A deterministic self-test covers the plumbing (a fake Playwright-only adapter runs the machinery; the comparison summary reflects two results) under the `evals` `self-test` script.

## Acceptance criteria

- [ ] A Playwright-only agent configuration drives the same eval goals through the SAME `AgentUnderTest` seam, with a protocol preamble teaching raw Playwright (NOT the webhands verb surface), and is NOT routed through webhands.
- [ ] The eval goal + the harness's end-state assertion are unchanged between the webhands and Playwright-only configs (the harness validates via its own reads either way); only the agent toolkit + preamble differ.
- [ ] Running an eval under both configs yields results comparable on the same fields (outcome, milestones, tokens), with a clear way to run/compare them.
- [ ] The "leave the browser open for verification" instruction is delivered as a per-adapter PROTOCOL preamble (toolkit-specific wording), not as goal-prompt priming; the no-priming rule still binds the goal.
- [ ] Toolkit-agnostic, non-gating, under `evals/` (outside `packages/*`); no new webhands verb; no live-site test in the gate.
- [ ] A deterministic self-test covers the comparison plumbing under the `evals` `self-test` script, NOT `pnpm test`.

## Blocked by

- `eval-token-accounting-for-webhands-vs-baseline` — the comparison needs the token number it adds (and the comparison fields it standardises). Build the token accounting first.

## Prompt

> Goal: add a Playwright-ONLY agent configuration to the eval harness so the same goals can be driven with raw Playwright (no webhands) and compared against a webhands agent on tokens + pass-rate. This is the concrete "does webhands deliver?" measure from the prd `work/prds/tasked/agent-capability-eval-harness.md` (north star). It DEPENDS on `eval-token-accounting-for-webhands-vs-baseline` (the token number + standardised comparison fields).
>
> READ FIRST: the eval-harness foundation (`evals/src/agent-under-test.ts` for the `AgentUnderTest` seam + the generic shell adapter; `evals/src/run-eval.ts`; `evals/src/bin/run-evals.ts`); the completed token-accounting task + its done record (the usage field + comparison fields live there); and `work/notes/observations/eval-end-state-assertion-needs-the-agent-to-leave-the-session-open.md` (the agent-toolkit-agnostic stance + why "leave the session open" is a per-adapter protocol preamble, not goal priming).
>
> KEY DESIGN POINTS: keep the eval GOAL and the harness END-STATE ASSERTION identical between the webhands config and the Playwright-only config; only the agent's toolkit + protocol preamble differ. The Playwright-only agent must NOT be routed through the webhands verb surface (that defeats the baseline) — decide and RECORD whether it drives its own Playwright or a harness-provided page. The harness's verdict stays its OWN (it may still use webhands read verbs to assert, since that is the harness's mechanism, not the agent's toolkit). Provide a clean way to run/compare both configs on the same eval id (e.g. an `--agent-kind` selector + a side-by-side summary), with identical token + outcome fields so the comparison is apples-to-apples. Toolkit-agnostic, non-gating, under `evals/`, no new verb, with a deterministic self-test under the `evals` `self-test` script (never `pnpm test`).
>
> What "done" means: the same eval runs under a webhands agent and a Playwright-only agent, producing comparable outcome+milestone+token results with a clear comparison view; the Playwright-only agent never goes through webhands; the harness's own assertion is unchanged; non-gating; self-test covers the plumbing.
>
> FIRST, check this task against current reality: confirm the token-accounting task landed with the usage + comparison fields this task assumes, and that the seam/runner shapes are as described; reconcile if they drifted (WORK-CONTRACT.md "Drift is a needs-attention signal"). RECORD non-obvious in-scope decisions (how the Playwright-only agent gets its driving surface, the comparison-run UX).
