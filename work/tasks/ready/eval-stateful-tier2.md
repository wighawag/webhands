---
title: 'Tier-2 eval: a stateful/branching flow with per-run account hygiene (AutomationExercise and/or ParaBank)'
slug: eval-stateful-tier2
prd: agent-capability-eval-harness
blockedBy: [eval-harness-foundation]
covers: [7, 11]
---

## What to build

A Tier-2 eval covering a CONSEQUENTIAL, strongly-stateful, branching flow, with the D2 per-run account hygiene that makes it safely re-runnable. Pick ONE target to ship first (the other can follow as a second entry):

- **AutomationExercise (`automationexercise.com`):** full e-commerce, persistent account state, with an in-flow account-deletion step. Goal e.g. "register a new account, add a product to the cart, complete the address + payment + order steps, and confirm the order." End state asserted by the harness via read verbs: the order-confirmation / order id present.
- **ParaBank (`parabank.parasoft.com`):** fake bank, strongly stateful/consequential, shared public instance with NO clean delete. Goal e.g. "register an account, open a second account, transfer $500 between your two accounts, and confirm the transaction." End state asserted via read verbs: the nonce-tagged transaction row present in the account activity.

D2 hygiene (from the prd) is the heart of this task and must be implemented in this STRICT order:

1. **Create a fresh, per-run-NONCE-tagged identity every run** (and, where the artifact is a value, tag it too, e.g. a transfer amount/memo carrying the nonce). This is the CORRECTNESS mechanism: the harness asserts against THIS run's artifact, never a leftover.
2. **Assert the end state (and milestones) BEFORE any cleanup.**
3. **Then best-effort DELETE the account where the site supports it** (AutomationExercise's in-flow delete-account). ParaBank has no clean delete, so it relies on the nonce-tagged artifact. A failed/absent delete NEVER flips the verdict.
4. **A FAIL or INCONCLUSIVE run does NOT delete** (leave state for inspection). Only a clean PASS triggers best-effort cleanup.

Ordered milestones give partial credit (e.g. reached-registered, reached-logged-in, reached-action-done, confirmed). Non-gating as ever: live site, own runner, pass/fail/INCONCLUSIVE (a site outage or signup rate-limit is INCONCLUSIVE, not a capability fail).

## Acceptance criteria

- [ ] At least one Tier-2 eval entry exists (AutomationExercise OR ParaBank) running through the foundation runner + shell adapter against the live site, with the end-state asserted by the HARNESS via webhands read verbs.
- [ ] A FRESH, per-run-nonce-tagged account/identity is created each run; the end-state assertion targets THIS run's nonce-tagged artifact (so re-runs are independent and unambiguous).
- [ ] The order is enforced: assert end state FIRST, best-effort delete SECOND; a failed/absent delete never changes the verdict; a non-PASS run does NOT delete (state kept for inspection); only a clean PASS triggers cleanup.
- [ ] Ordered milestones are reported for partial credit.
- [ ] A signup rate-limit or site outage reports INCONCLUSIVE (the foundation's precheck/retry), never a capability fail.
- [ ] No selectors / steps / site-DOM foreknowledge are passed to the agent (the no-priming property holds).
- [ ] NON-GATING: not invoked by `pnpm test`; runs only via the harness's own runner. No automated test added here hits the live Tier-2 DOM inside the gate.
- [ ] Shared-write isolation: profile/config/serve-endpoint dirs are temp; the real `~/.webhands` is untouched.

## Blocked by

- `eval-harness-foundation`, this eval plugs into that task's eval contract, runner, launch seam/shell adapter, end-state-assertion machinery, milestone scoring, and pass/fail/INCONCLUSIVE outcome (D2 hygiene is implemented on top of it here).

## Prompt

> Goal: ship a Tier-2 stateful/branching eval per the prd `work/prds/tasked/agent-capability-eval-harness.md` (User Stories 7 and 11; ## Resolved decisions D2). Pick ONE target to ship first: AutomationExercise (full e-commerce, persistent account, in-flow delete) or ParaBank (fake bank, register + open accounts + transfer funds + confirm transaction, no clean delete). It plugs into the foundation task (`eval-harness-foundation`).
>
> READ FIRST: the prd's ## Resolved decisions D2 (in full) and User Stories 7/11, plus the completed `eval-harness-foundation` task + done record (the eval-entry contract, runner, shell adapter, read-verb assertion, milestone scoring, and pass/fail/INCONCLUSIVE outcome live there). The Tier-2 target detail (the AutomationExercise-vs-ParaBank shapes, their state/cleanup differences) is inlined in this task's ## What to build above; the prd's tiered-target assessment was trimmed into the tasks at tasking-time. Domain reminder: agent gets ONLY the goal-prompt + verb surface; the HARNESS checks the END STATE via webhands read verbs.
>
> D2 ACCOUNT HYGIENE is the crux and has a STRICT order: (1) fresh per-run NONCE-tagged identity every run (tag the artifact too, e.g. a transfer amount/memo with the nonce), which is the correctness mechanism, so the assertion targets THIS run's artifact; (2) assert end state + milestones BEFORE any cleanup; (3) best-effort delete where supported (AutomationExercise's delete-account; ParaBank has none, so lean on the nonce-tagged artifact), a failed/absent delete NEVER flips the verdict; (4) a FAIL/INCONCLUSIVE run does NOT delete (keep state for inspection), only a clean PASS triggers cleanup.
>
> NON-GATING: live site, own runner, not in `pnpm test`. A signup rate-limit or outage is INCONCLUSIVE (not a capability fail). Isolate profile/config/serve dirs to temp; never touch the real `~/.webhands`.
>
> What "done" means: a Tier-2 eval runs against the live site through the foundation harness; a fresh nonce-tagged account is created per run and the assertion targets that run's artifact; the assert-then-best-effort-delete order holds with delete never affecting the verdict and non-PASS runs keeping state; milestones reported; non-gating; isolation holds.
>
> FIRST, check this task against current reality: confirm `eval-harness-foundation` landed with the assumed contract/runner/adapter; confirm the chosen target's signup + (for AutomationExercise) delete-account flow still exist. If anything drifted, reconcile rather than build on a stale premise (WORK-CONTRACT.md). RECORD non-obvious in-scope decisions (which target shipped first, the nonce scheme, the exact end-state check).
