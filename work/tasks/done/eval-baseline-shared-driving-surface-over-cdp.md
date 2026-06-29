---
title: Give the Playwright-only baseline a SHARED driving surface (connect the agent's Playwright to the harness's served browser over CDP) so its verdict is trustworthy
slug: eval-baseline-shared-driving-surface-over-cdp
blockedBy: []
covers: []
---

## What to build

Fix the load-bearing flaw the first live `run-eval --compare` exposed: the
Playwright-only baseline agent drives its OWN browser while the harness asserts
against a DIFFERENT one, so the baseline scores a FALSE FAIL even when it
completes the goal perfectly (finding:
`work/notes/findings/baseline-comparison-needs-a-shared-driving-surface-not-two-browsers.md`).
Until this is fixed the "does webhands deliver?" comparison is not measurable:
the baseline's outcome is an artifact of the harness, not a capability signal.

The fix is a SHARED DRIVING SURFACE both toolkits act on, so the harness's
end-state assertion reads the page the agent actually drove, REGARDLESS of
toolkit. The agent stays genuinely Playwright-only (raw Playwright, no webhands
verbs); it just drives the SAME browser the harness serves instead of launching
its own.

End-to-end vertical slice:

- **Serve exposes a CDP endpoint.** The harness's webhands `serve` session
  (launched in `runEval` via `launchPersistentContext`) is started with Chromium
  remote debugging enabled (e.g. `--remote-debugging-port=<port>` in the launch
  args, or the persistent-context CDP endpoint), and the resolved endpoint URL is
  surfaced to the harness so it can hand it to the baseline agent. This reuses the
  CDP machinery webhands ALREADY has for `attach`
  (`packages/core/src/playwright-attach-transport.ts`, task
  `attach-transport-cdp-chromium`); the serve side is the new bit.
- **The Playwright-only preamble tells the agent to CONNECT, not launch.** The
  `PLAYWRIGHT_PREAMBLE` (in `evals/src/no-priming.ts`) changes from "launch your
  own browser" to "connect your Playwright to the browser at this CDP endpoint
  (`chromium.connectOverCDP(<endpoint>)`) and drive the existing page." The
  endpoint is passed to the agent the SAME way the webhands command is today (via
  env into the launch, e.g. a `WEBHANDS_CDP_ENDPOINT` the preamble references), so
  it is administered as PROTOCOL, not goal priming (the no-priming rule still
  binds the goal). The agent still writes raw Playwright and never touches a
  webhands verb, so it remains an honest baseline; it simply acts on the harness's
  page.
- **The harness reads that same page for its verdict, unchanged.** Because the
  agent now drives the served browser, the existing end-state assertion (webhands
  read verbs against the serve session) sees the agent's result with NO change to
  the scoring path. A baseline that completes the goal now correctly scores PASS.
- **Re-validate with a real `--compare`.** After the fix, a live
  `saucedemo-core-flow --compare` (same agent + model both legs) must score the
  Playwright-only leg's genuine completion as PASS (not the previous false FAIL),
  so the two legs are finally comparable on outcome + tokens. This run is the
  durable BASELINE for future webhands improvement: it is the reference number a
  later verb-surface change is measured against.
- **(Secondary, in-scope if cheap) the milestone-scoring smell.** The same finding
  notes milestones read `0/4` even on a PASS, because intermediate-page milestones
  are only scored against the FINAL page. Either score milestones progressively
  during the run, or drop them from the comparison line so the comparison reduces
  to the meaningful axes (outcome + tokens). If this turns out non-trivial, split
  it out and surface it rather than expanding this task.

Stays NON-GATING and under `evals/` for the harness wiring; the serve-side CDP
exposure is a `packages/core`/`packages/cli` change (it DOES touch the gated
packages, so it carries real unit coverage there). No new webhands VERB (CDP
exposure is a serve/transport capability, not an agent-facing verb). The
deterministic evals self-test gains coverage of the new preamble wording +
endpoint plumbing (a fake adapter asserting the connect-over-CDP preamble +
endpoint pass-through) under the `evals` `self-test` script, never `pnpm test`.

## Acceptance criteria

- [ ] The harness's `serve` session can expose a Chromium CDP/remote-debugging
      endpoint, and `runEval` resolves that endpoint and makes it available to the
      Playwright-only agent (via env/preamble, the same channel the webhands command
      uses today).
- [ ] The `PLAYWRIGHT_PREAMBLE` instructs the agent to `connectOverCDP` to the
      supplied endpoint and drive the EXISTING page, NOT to launch its own browser;
      it still teaches raw Playwright only and never points the agent at a webhands
      verb. The no-priming rule still binds the GOAL (the endpoint is protocol, not
      priming).
- [ ] The harness's end-state assertion is UNCHANGED and now reads the page the
      baseline agent actually drove (shared surface), so a baseline run that
      completes the goal scores PASS.
- [ ] A live `saucedemo-core-flow --compare` scores BOTH legs' genuine completions
      correctly (the Playwright-only leg PASSes when it finishes the purchase), and
      the side-by-side outcome + token comparison is apples-to-apples. (This run is
      recorded as the reference baseline.)
- [ ] Serve-side CDP exposure carries real unit coverage in `packages/core`/`cli`
      (it is in the gated packages); the evals plumbing (preamble + endpoint
      pass-through) is covered by the `evals` `self-test`, NOT `pnpm test`.
- [ ] No new webhands verb; non-gating live comparison stays out of `pnpm test`.
- [ ] (If cheap) milestones are scored meaningfully OR dropped from the comparison
      line; otherwise this is split out and surfaced, not forced.

## Blocked by

- None. The serve-side CDP work can start immediately; it builds on the existing
  `attach` CDP transport (`tasks/done/attach-transport-cdp-chromium.md`) and the
  shipped baseline-comparison harness (`tasks/done/eval-playwright-only-baseline-comparison.md`).

## Prompt

> Goal: make the Playwright-only baseline's verdict TRUSTWORTHY by giving both
> toolkits a SHARED driving surface. Today the baseline agent launches its own
> browser while the harness asserts against a different one, so a baseline that
> completes the goal scores a FALSE FAIL (finding:
> `work/notes/findings/baseline-comparison-needs-a-shared-driving-surface-not-two-browsers.md`).
> Fix: the harness's webhands `serve` session exposes a Chromium CDP endpoint;
> the Playwright-only agent `chromium.connectOverCDP(<endpoint>)`-s to it and
> drives the harness's EXISTING page (raw Playwright only, no webhands verbs), so
> the harness reads the page the agent drove and scores it correctly. This makes
> "does webhands deliver?" finally measurable and establishes the durable baseline
> for future webhands improvement.
>
> READ FIRST: the finding above (the root cause + fix options); the shipped
> baseline harness (`evals/src/no-priming.ts` PLAYWRIGHT_PREAMBLE / buildAgentInput,
> `evals/src/agent-under-test.ts` PlaywrightAdapter, `evals/src/run-eval.ts` runEval
> + serve lifecycle, `evals/src/bin/run-evals.ts` --compare); the serve launch path
> (`packages/core/src/playwright-launch-transport.ts` launchPersistentContext) and
> the existing CDP attach transport (`packages/core/src/playwright-attach-transport.ts`,
> `tasks/done/attach-transport-cdp-chromium.md`) for how webhands already speaks CDP;
> and `work/notes/observations/eval-end-state-assertion-needs-the-agent-to-leave-the-session-open.md`
> (preamble-vs-priming, leave-open-as-protocol).
>
> KEY DESIGN POINTS: the agent must stay genuinely Playwright-only (raw Playwright,
> never a webhands verb) but act on the harness's served browser via CDP, NOT its
> own. Expose the CDP endpoint from serve (remote-debugging-port / persistent-context
> endpoint) and pass it to the agent as PROTOCOL (env + preamble), not goal priming;
> the no-priming guard still binds the goal. Keep the harness's end-state assertion
> unchanged. Serve-side CDP exposure is a gated-packages change with real unit
> coverage; the evals preamble/plumbing gets a deterministic self-test (never
> pnpm test). Re-run a live saucedemo-core-flow --compare to confirm the baseline now
> PASSes its genuine completions, and record that as the reference baseline. Add NO
> new webhands verb.
>
> What "done" means: a live --compare scores the Playwright-only baseline's real
> completions as PASS (no more false FAIL) on a shared CDP-driven surface, the
> comparison is apples-to-apples on outcome + tokens, serve-side CDP exposure is
> unit-covered, and the run stands as the durable webhands-vs-baseline reference.
>
> FIRST, check this against current reality: confirm serve still launches via
> launchPersistentContext and the attach transport's CDP path is as described
> (they may have evolved); reconcile rather than duplicate. RECORD the non-obvious
> decisions (how serve exposes the endpoint, how it reaches the agent, the exact
> preamble wording, and the milestone-scoring call).
