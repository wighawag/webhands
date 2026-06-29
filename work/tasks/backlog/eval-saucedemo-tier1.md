---
title: 'Tier-1 eval: SauceDemo end-to-end (login + sort + cart + checkout, plus a special-user discovery goal)'
slug: eval-saucedemo-tier1
prd: agent-capability-eval-harness
blockedBy: [eval-harness-foundation]
covers: [6]
---

## What to build

The first REAL capability eval, on the simplest, most stable, reset-free target: SauceDemo (`saucedemo.com`). It plugs into the foundation's eval contract + runner + shell adapter. Two eval entries:

- **A core flow eval:** a high-level goal-prompt like "log in to this store, sort the products by price low-to-high, add the cheapest item to the cart, and complete the checkout" handed to the unaided agent (no selectors, no steps). The harness asserts the END STATE via webhands read verbs: the order-complete confirmation is present (and/or the cart reached the expected count at the cart milestone). Ordered milestones: reached-login, reached-cart, reached-checkout, order-confirmed.
- **A DISCOVERY eval:** a goal whose success requires the agent to DISCOVER special-user behaviour it was NOT told about (e.g. the goal names a task that, under `problem_user` or `performance_glitch_user`, behaves differently, so the agent must notice and adapt). The point is to exercise unaided adaptation, not a scripted path. Pick a concrete, mechanically-checkable end state for it.

SauceDemo is reset-free (fixed demo credentials, no persistent server state), so NO D2 account hygiene is needed here: it is trivially re-runnable. The credentials are public demo credentials; supply them via the goal/config as allowed for a fixed-credential sandbox (this is login, not selector-priming: naming "use the standard demo login" is not site-DOM foreknowledge). Keep the eval OUT of the gate (it hits a live site); it runs via the harness's own runner command only.

## Acceptance criteria

- [ ] A SauceDemo core-flow eval entry exists ({goal-prompt, end-state-assertion, milestones}) and runs through the foundation's runner + shell adapter against the live site.
- [ ] The end-state assertion is made by the HARNESS via webhands read verbs (order-complete confirmation / expected cart count), not the agent's self-report.
- [ ] Milestones reached are reported (reached-login / reached-cart / reached-checkout / order-confirmed) for partial credit.
- [ ] A second DISCOVERY eval entry exists whose success requires the agent to discover special-user (`problem_user` / `performance_glitch_user`) behaviour it was not primed with; its end state is mechanically checkable.
- [ ] No selectors / step lists / site-DOM foreknowledge are passed to the agent (the no-priming property from the foundation holds); fixed public demo credentials supplied via goal/config are acceptable (login, not DOM priming).
- [ ] The eval is NON-GATING: it is not invoked by `pnpm test`; it runs only via the harness's own runner command, and reports pass/fail/INCONCLUSIVE (a SauceDemo outage yields INCONCLUSIVE, not a capability fail).
- [ ] Shared-write isolation: any profile/config/serve-endpoint dir used is a temp dir; the real `~/.webhands` is untouched.
- [ ] No automated test added by this task runs inside `pnpm test` against the live SauceDemo DOM.

## Blocked by

- `eval-harness-foundation`, this eval plugs into that task's eval contract, runner, launch seam/shell adapter, end-state-assertion machinery, milestone scoring, and pass/fail/INCONCLUSIVE outcome.

## Prompt

> Goal: ship the first REAL capability eval on SauceDemo (`saucedemo.com`), per the prd `work/prds/tasked/agent-capability-eval-harness.md` (User Story 6). It plugs into the foundation task (`eval-harness-foundation`): use its eval contract `{goal-prompt, end-state-assertion, milestones}`, its runner, its generic shell/command adapter, its harness-makes-the-assertion-via-read-verbs rule, its milestone scoring, and its pass/fail/INCONCLUSIVE outcome.
>
> TIER-1 TARGET DETAIL (the prd's tiered-target assessment was trimmed into the tasks at tasking-time; the SauceDemo specifics are here): SauceDemo is the simplest, most stable, RESET-FREE target (fixed public demo credentials, no persistent server state), so it is trivially re-runnable and needs NO D2 account hygiene. Its standard login plus several SPECIAL users (notably `problem_user`, whose UI is subtly broken, and `performance_glitch_user`, which is artificially slow) make it ideal for a discovery goal an unprimed agent must work out for itself. The store flow is: login, product sort, add-to-cart, multi-step checkout, order-complete confirmation.
>
> READ FIRST: the prd (User Story 6) and the completed `eval-harness-foundation` task + its done record (the eval-entry format and runner are defined there). Domain reminder: the agent gets ONLY the goal-prompt + the verb surface (no selectors, no steps); the agent's PATH is free; the HARNESS checks the END STATE via webhands read verbs.
>
> Build two eval entries: (1) a core flow (log in, sort by price, add cheapest to cart, complete checkout) whose end state is the order-complete confirmation, with ordered milestones reached-login/reached-cart/reached-checkout/order-confirmed; (2) a DISCOVERY eval whose success requires the agent to discover special-user behaviour (`problem_user`/`performance_glitch_user`) it was NOT told about, with a concrete mechanically-checkable end state.
>
> SauceDemo is RESET-FREE: fixed public demo credentials, no persistent state, so NO D2 account hygiene applies. Supplying the standard demo login via goal/config is fine (that is login, not DOM selector-priming).
>
> NON-GATING: this eval hits a live site, so it must NOT run inside `pnpm test`. It runs only via the harness's own runner. A SauceDemo outage must report INCONCLUSIVE (the foundation's health precheck), never a capability fail. Isolate any profile/config/serve dir to temp; never touch the real `~/.webhands`.
>
> What "done" means: two SauceDemo eval entries (core flow + discovery) run through the foundation harness against the live site, the harness asserts the end state via read verbs and reports binary + milestone results, no priming is leaked to the agent, the eval is non-gating, and shared-write isolation holds.
>
> FIRST, check this task against current reality: confirm `eval-harness-foundation` landed and its eval-entry contract/runner/adapter are as assumed; if they landed differently, reconcile rather than build on a stale premise (WORK-CONTRACT.md "Drift is a needs-attention signal"). RECORD non-obvious in-scope decisions (the exact discovery-goal and its end-state check).
