---
title: 'Tier-3 eval: messy-real DOM regression catcher (Magento demo)'
slug: eval-magento-tier3
prd: agent-capability-eval-harness
blockedBy: [eval-harness-foundation]
covers: [8]
---

## What to build

A Tier-3 eval against a MESSY, production-like DOM: the Magento demo store (`magento.softwaretestingboard.com`). Its job in the scoreboard is precisely to catch the "works on a clean fixture, fails on a real messy DOM" regression that local fixtures structurally cannot reveal, exercising the agent-facing verb surface against a real, heavy, framework-rendered e-commerce DOM.

An eval entry with a high-level goal-prompt (e.g. "find a specific kind of product, add it to the cart, and reach the checkout") handed to the unaided agent; the harness asserts the END STATE via webhands read verbs (cart contains the expected item / the checkout step is reached). Ordered milestones for partial credit (e.g. reached-search-results, reached-product, reached-cart, reached-checkout).

Before committing Magento as a STANDING eval, assess its stability and rate-limits: it may be flakier than the sandbox tiers, so the foundation's INCONCLUSIVE handling matters most here (a flaky/down Magento must report INCONCLUSIVE, never a capability fail). If the goal can be completed without creating an account, prefer that (avoid unnecessary state); if account creation is needed, apply the D2 hygiene from the foundation/Tier-2 pattern. Non-gating as ever (live site, own runner).

## Acceptance criteria

- [ ] A Magento-demo eval entry exists and runs through the foundation runner + shell adapter against the live site, with the end-state asserted by the HARNESS via webhands read verbs.
- [ ] Ordered milestones are reported for partial credit.
- [ ] Magento's stability/rate-limit fitness is assessed and recorded; a flaky/down Magento reports INCONCLUSIVE (the foundation's precheck/retry), never a capability fail.
- [ ] The goal avoids creating account state where possible; if account state is unavoidable, the D2 per-run hygiene (fresh nonce-tagged identity, assert-then-best-effort-delete) is applied.
- [ ] No selectors / steps / site-DOM foreknowledge are passed to the agent (the no-priming property holds), this is the whole point on a messy DOM.
- [ ] NON-GATING: not invoked by `pnpm test`; runs only via the harness's own runner. No automated test added here hits the live Magento DOM inside the gate.
- [ ] Shared-write isolation: profile/config/serve-endpoint dirs are temp; the real `~/.webhands` is untouched.

## Blocked by

- `eval-harness-foundation`, this eval plugs into that task's eval contract, runner, launch seam/shell adapter, end-state-assertion machinery, milestone scoring, and pass/fail/INCONCLUSIVE outcome.

## Prompt

> Goal: ship a Tier-3 messy-real eval against the Magento demo (`magento.softwaretestingboard.com`) per the prd `work/prds/tasked/agent-capability-eval-harness.md` (User Story 8). Its purpose is to catch the "clean fixture passes, messy real DOM fails" regression that local fixtures cannot reveal. It plugs into the foundation task (`eval-harness-foundation`).
>
> READ FIRST: the prd's User Story 8 and the completed `eval-harness-foundation` task + done record (the eval-entry contract, runner, shell adapter, read-verb assertion, milestone scoring, pass/fail/INCONCLUSIVE outcome). The Tier-3 target detail (Magento's messy production-like DOM as the regression catcher, and the stability/rate-limit caveat) is inlined in this task's ## What to build above; the prd's tiered-target assessment was trimmed into the tasks at tasking-time. Domain reminder: agent gets ONLY the goal-prompt + verb surface (no selectors, no steps), which matters MOST here because the DOM is messy; the HARNESS checks the END STATE via read verbs.
>
> Build a goal like "find a specific kind of product, add it to the cart, reach the checkout" with ordered milestones (reached-search-results / reached-product / reached-cart / reached-checkout). ASSESS Magento's stability/rate-limits and record the finding; a flaky/down Magento must report INCONCLUSIVE, never a capability fail. Prefer a goal that needs no account; if account state is unavoidable, apply the D2 hygiene (fresh nonce-tagged identity, assert-then-best-effort-delete).
>
> NON-GATING: live site, own runner, not in `pnpm test`. Isolate profile/config/serve dirs to temp; never touch the real `~/.webhands`.
>
> What "done" means: a Magento eval runs through the foundation harness against the live site; the harness asserts the end state via read verbs and reports binary + milestones; Magento's fitness is assessed (flaky/down → INCONCLUSIVE); no priming leaks to the agent; non-gating; isolation holds.
>
> FIRST, check this task against current reality: confirm `eval-harness-foundation` landed with the assumed contract/runner/adapter. If drifted, reconcile rather than build on a stale premise (WORK-CONTRACT.md). RECORD non-obvious in-scope decisions (the exact goal + end-state check, and the Magento stability finding, which may warrant a `work/notes/findings/` note if it is durable external ground truth).
