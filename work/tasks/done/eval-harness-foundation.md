---
title: Eval-harness foundation (contract, runner, launch seam + shell adapter, scripted self-test, non-gating home)
slug: eval-harness-foundation
prd: agent-capability-eval-harness
blockedBy: []
covers: [1, 2, 3, 4, 5, 9, 10, 12, 15, 16, 17]
---

## What to build

The spine of the agent capability eval harness: a thin but COMPLETE vertical path that can run ONE eval end to end against a real site and score it, plus the deterministic self-test that proves the machinery without a real agent. Everything a per-tier eval task later plugs into lands here.

The unit is an **eval** = `{goal-prompt, end-state-assertion, milestones[]}` (see the prd). Deliver:

- **A non-gating HOME.** The harness lives OUTSIDE `packages/*` (a top-level `evals/` directory is the intended home). This is load-bearing and verifiable: the repo's gate is `pnpm test` = `pnpm --filter './packages/*' test`, so anything not under `packages/*` is structurally excluded from the gate. The harness has its OWN runner command (e.g. an `evals/` script invoked directly, NOT wired into any `packages/*` `test` script and NOT added to the gate). Do NOT add the harness as a `packages/*` workspace member whose `test` script the gate would pick up.
- **The eval contract + a small catalogue.** A typed contract for an eval entry (its tier, target site + entry URL, the natural-language goal-prompt, the end-state-assertion, an ordered milestone list). One file/entry per eval (no shared manifest, work/ contract rule 2). Ship at least one trivial catalogue entry exercised only by the self-test fixture (the real-site evals are the per-tier tasks).
- **The `AgentUnderTest` LAUNCH SEAM + a generic SHELL/COMMAND adapter (D1).** An interface that, given the goal-prompt + the verb-surface reference, launches a real unaided agent and returns when it reports done (or times out). The v1 implementation is the GENERIC SHELL adapter: it shells out to a configured agent command (with a `{model}` placeholder, the dorfl pattern), feeds the goal-prompt on stdin, and captures output. It is a real agent launcher, not a stub. Model dorfl's `Harness` seam (`~/dev/github/wighawag/dorfl` `packages/dorfl/src/harness.ts`, the `null` adapter) for the shape. The pi-native adapter is explicitly OUT OF SCOPE here (a separate deferred task).
- **The end-state assertion run BY THE HARNESS via webhands read verbs (DECIDED; self-report-trust REJECTED).** After the agent reports done, the harness makes an INDEPENDENT check using webhands' own read verbs (`query`/`snapshot`/`exists`/`count`/`getAttribute`) against the live page the agent left (optionally corroborated by the site's confirmation surface). The agent's self-report only TRIGGERS the check; it never substitutes for it.
- **Milestone partial-credit scoring.** Each eval reports the final binary pass/fail AND which ordered milestones were reached; each milestone is itself a verb-checked end state.
- **A THREE-state outcome: pass / fail / INCONCLUSIVE + a site-health precheck + bounded retry.** Before scoring a FAIL, a cheap reachability/health precheck (entry URL loads, an expected landmark present). If the site is down / rate-limiting / structurally changed, the outcome is INCONCLUSIVE (retried a bounded number of times), never a capability fail. A genuine agent FAIL is not retried.
- **The `serve` lifecycle ownership.** Per ADR-0005 a verb with no live `serve` errors and never auto-spawns, so the harness OWNS bringing a `serve` session up around an eval and tearing it down after (against a warmed, dedicated profile, honoring the existing `--proxy`/stealth options). Isolate the `serve` endpoint/config dir per ADR-0005's shared-write note.
- **The DETERMINISTIC SCRIPTED-RUN self-test fixture (D3).** A SEPARATE fixture (the dorfl `NullHarness` analogue), NOT an adapter and NOT a capability subject: a fixed, PRIMED sequence of `npx webhands <verb>` calls replayed as a pseudo-agent trace, so the harness's OWN logic (contract parsing, end-state assertion, milestone scoring, the pass/fail/INCONCLUSIVE decision, the no-priming guard, the precheck) is exercised deterministically against a LOCAL FIXTURE. A known-good trace must yield PASS + the right milestones; a known-bad trace must yield FAIL. This part runs against a local fixture and is the gate-testable proof of the machinery (it may reuse the existing `startFixtureServer` style). It must remain clearly NOT a capability pass (primed by construction).
- **The no-priming guard.** The agent-under-test receives EXACTLY the goal-prompt text + the verb-surface reference (`npx webhands --llms-full` / `--help`); the harness must not pass selectors, step lists, or site URLs beyond the entry point named in the goal. Encode this as an enforced property, not a comment.

This is the foundation only: the real-site evals (SauceDemo, the stateful tier, Magento) and the docs are separate tasks that depend on this one.

## Acceptance criteria

- [ ] An eval is expressible as a typed `{goal-prompt, end-state-assertion, milestones[]}` entry (one file/entry per eval; no shared manifest).
- [ ] The harness has its own runner command and lives OUTSIDE `packages/*`; running `pnpm test` (= `pnpm --filter './packages/*' test`) does NOT invoke any eval or the live-site harness path. Demonstrate this exclusion is structural (the harness is not a `packages/*` member the gate fans out to).
- [ ] An `AgentUnderTest` launch seam exists with a GENERIC SHELL/COMMAND adapter that launches a real agent from a configured command, feeding the goal-prompt on stdin (D1). The pi-native adapter is NOT added here.
- [ ] The end-state assertion is made BY THE HARNESS via webhands read verbs (not the agent's self-report); the agent's "done" only triggers the check.
- [ ] Scoring reports the final binary pass/fail AND the ordered milestones reached.
- [ ] The outcome has three states pass/fail/INCONCLUSIVE; a site-health precheck gates FAIL vs INCONCLUSIVE; INCONCLUSIVE is retried a bounded number of times and a genuine FAIL is not.
- [ ] The harness owns the `serve` session lifecycle around an eval (start/stop), with the endpoint/config dir isolated to a temp location (ADR-0005), honoring the existing profile/`--proxy`/stealth options.
- [ ] The D3 deterministic scripted-run self-test fixture exists and is gate-testable against a LOCAL FIXTURE: a known-good scripted trace yields PASS + correct milestones, a known-bad trace yields FAIL. It is documented/coded as a machinery check, NOT a capability subject (primed by construction → never a capability pass).
- [ ] The no-priming property is ENFORCED: the agent-under-test's input is only the goal-prompt + the verb-surface reference; no selectors/steps/site URLs beyond the goal's entry point are passed.
- [ ] Tests cover the new behaviour (the machinery, via the D3 fixture against a local fixture page); the gate-testable portions mirror the repo's existing real-browser + local-fixture vitest style where they live under `packages/*`, while the live-site harness path stays non-gating.
- [ ] Shared-write isolation: any test or run that touches a profile/config/serve-endpoint dir points it at a per-test temp dir and asserts the real `~/.webhands` is UNTOUCHED.
- [ ] A changeset is added if shipped product code warrants it.

## Blocked by

- None, can start immediately.

## Prompt

> Goal: build the FOUNDATION of the agent capability eval harness from the prd `work/prds/tasked/agent-capability-eval-harness.md` (User Stories 1,2,3,4,5,9,10,12,15,16,17 and Resolved decisions D1, D3). This is the spine that runs ONE eval end to end against a real site and scores it, plus the deterministic self-test that proves the machinery without a real agent. The real-site evals and docs are SEPARATE dependent tasks.
>
> READ FIRST: the prd (especially ## Resolved decisions D1/D2/D3, ## Solution's four load-bearing properties, and the User Stories; note the prd's ## Implementation Decisions / ## Testing Decisions were trimmed into these task files at tasking-time, so the build-level detail lives HERE in this task, not in the prd), `CONTEXT.md` (domain glossary: verb, profile, serve, the work/ contract), ADR-0005 (serve hosts the long-lived session; a verb with no live serve ERRORS and never auto-spawns, so the harness must own serve start/stop), ADR-0002 (real-session / personal-use scope), ADR-0009 (opt-in SOCKS proxy), and `tasks/done/docs-tos-humility-and-kayak-smoke.md` (the non-CI live-by-nature stance). For the launch-seam shape, read `~/dev/github/wighawag/dorfl` `packages/dorfl/src/harness.ts` (the `Harness` interface + the `null` GENERIC SHELL adapter: shells out to a configured `agentCmd` with `{model}` substitution, feeds the prompt on stdin, captures output; it is a REAL agent launcher, not a stub).
>
> KEY DOMAIN FACTS: an **eval** = `{goal-prompt, end-state-assertion, milestones[]}`. The agent's PATH is free; only the END STATE is checked, and the HARNESS checks it via webhands' own read verbs (`query`/`snapshot`/`exists`/`count`/`getAttribute`), NOT the agent's self-report. The harness drives webhands through its EXISTING surface (`npx webhands <verb>`, the README's primary usage) against a warmed profile; it adds NO new verbs.
>
> NON-GATING IS STRUCTURAL: the gate is `pnpm test` = `pnpm --filter './packages/*' test`. Put the harness OUTSIDE `packages/*` (a top-level `evals/` dir) with its own runner command so the gate cannot reach the live-site path. Do NOT make it a `packages/*` member whose `test` the gate fans out to. The gate-testable MACHINERY proof (the D3 scripted self-test against a LOCAL fixture) is allowed to run in the gate; the live-site evals never are.
>
> D3 IS SEPARATE FROM D1: the shell adapter (D1) launches a REAL unaided agent (a capability subject, bound by the no-priming rule). The scripted self-test (D3) replays a FIXED primed verb sequence as a pseudo-agent trace to prove the harness's own logic deterministically (a machinery check, NOT a capability subject). Keep them distinct so a primed script can never masquerade as a capability pass.
>
> What "done" means: an eval is a typed contract; the harness has its own runner outside `packages/*` (proven excluded from `pnpm test`); a generic shell/command adapter launches a real agent with goal-prompt on stdin (no pi-native adapter here); the harness makes the end-state assertion itself via read verbs; scoring is binary + ordered milestones; the outcome is pass/fail/INCONCLUSIVE with a health precheck + bounded retry; the harness owns the serve lifecycle with an isolated temp endpoint/config; the D3 scripted self-test passes a known-good trace and fails a known-bad one against a local fixture; the no-priming property is enforced; profile/config writes are isolated from the real `~/.webhands`; a changeset if product code changed.
>
> FIRST, check this task against current reality: confirm `pnpm test` still filters to `packages/*` only, confirm the serve/verb CLI surface and the read verbs are as the prd/ADR-0005 assume, and confirm `startFixtureServer` (in `packages/core` test fixtures) is the local-fixture style to mirror. If anything landed differently, reconcile rather than building on a stale premise (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions (the eval-entry file format, the exact non-gating mechanism, the serve-lifecycle ownership shape, the agent-command config shape): if a decision meets the ADR gate (hard to reverse + surprising + a real trade-off), write an ADR in `docs/adr/`; otherwise note it in the done record.
