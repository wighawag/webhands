---
title: A DYNAMIC, non-one-shot-scriptable eval (the goal resolves only from live page state) to measure the verb surface's look->decide->act value
slug: eval-dynamic-non-scriptable-mid-run-goal-shift
blockedBy:
  [
    cut-per-run-context-overhead-cta-and-discovery,
    snapshot-ref-actionable-unify-with-by-ref,
  ]
covers: []
---

## What to build

Add the FIRST dynamic eval that a write-once-run-once script CANNOT win, because
the correct actions depend on information only visible at runtime AND that varies,
so both toolkits must do an observe-then-act loop. This measures where the verb
surface earns its keep, the look->decide->act loop, which the current statically
scriptable evals under-measure (idea
`work/notes/ideas/dynamic-evals-that-cannot-be-one-shot-scripted.md`; the
scoreboard shows raw Playwright wins on static flows precisely BY scripting blind,
`evals/SCOREBOARD.md`).

Build ONE well-designed dynamic eval (a spike that proves the concept), not a
tier. It must combine enough dynamic levers that a single blind script provably
cannot encode the flow:

- **Runtime-revealed, varying target** (the choice is only on the page at run
  time): e.g. "buy the cheapest IN-STOCK item", "transfer your ENTIRE current
  balance", "act on the row whose memo contains <this run's nonce>". The harness
  already mints per-run nonces (`evals/src/nonce.ts`), use that so even a cached
  script from a prior run is useless.
- **Mid-run termination on a LIVE value** (the strongest lever): e.g. "add items to
  the cart until the subtotal shown on the page exceeds the free-shipping threshold
  shown on the page, then check out". The stop condition is a changing on-page
  number no fixed script encodes; the agent must read, decide, loop.

Pick a target that makes the dynamic condition deterministic for the HARNESS to
check yet impossible for the AGENT to precompute. Candidates (decide + record):
ParaBank (balances/amounts are naturally dynamic + nonce-tagged already), a
SauceDemo "cheapest in-stock" variant, OR a small purpose-built LOCAL fixture
whose layout/values randomise per run (host-deterministic, agent-unpredictable,
and immune to a flaky third-party site). A local randomised fixture is the safest
for a deterministic spike; weigh it against the realism of a live sandbox.

End-to-end vertical slice:

- A new `*.eval.ts` in `evals/src/catalogue/` whose GOAL names the dynamic
  CONDITION ("the cheapest in-stock item", "until the on-page subtotal exceeds the
  shown threshold") but NO selectors/specific values, so neither toolkit can
  hardcode (no-priming still binds: the goal is outcome-shaped, run it past
  `assertNoPriming` and review for method-leak).
- The end-state assertion stays the harness's OWN (read via webhands verbs) and
  must be DETERMINISTICALLY checkable despite the dynamic path (e.g. assert "the
  order-complete page shows the cheapest item's price" / "the final subtotal
  exceeds the threshold" by READING the page, not by re-deriving the agent's
  choices). Wire health/milestones/end-state like the existing entries.
- It runs under the EXISTING `--compare`/`--agent-kind` machinery (webhands cold/
  skilled/script-forward vs Playwright) with no harness-engine change; the
  shared-CDP surface already lets the Playwright leg drive the same page.
- A live run is recorded in a new `## Dynamic (non-scriptable) read` section of
  `evals/SCOREBOARD.md`, with the hypothesis stated: on this eval the
  Playwright-vs-webhands token gap should NARROW or FLIP (both must loop; webhands'
  `snapshot`/`query` reads are token-cheaper than a Playwright agent serialising
  DOM to decide). Record whichever way it comes out, both are informative.
- The deterministic self-test covers the new eval's plumbing (the dynamic
  fixture/condition is exercised by a fake/scripted run proving the machinery and
  the end-state check), under the `evals` `self-test` script, never `pnpm test`.

Non-gating, under `evals/` (outside `packages/*`), no new webhands verb.

## Acceptance criteria

- [ ] A new dynamic `*.eval.ts` whose correct flow depends on LIVE, VARYING page
      state (runtime-revealed target AND/OR mid-run termination on an on-page value),
      so a one-shot blind script cannot encode it; the chosen target + levers are
      recorded.
- [ ] The GOAL is outcome-shaped and no-priming-clean (names the condition, not
      selectors/values; passes `assertNoPriming`, reviewed for method-leak).
- [ ] The end-state is DETERMINISTICALLY checkable by the harness's own reads
      despite the dynamic path; health/milestones/end-state wired like existing
      entries.
- [ ] Runs under the existing `--compare`/`--agent-kind` machinery with no
      harness-engine change; the Playwright leg drives the shared page.
- [ ] A live run is recorded in `evals/SCOREBOARD.md` (`## Dynamic (non-scriptable)
      read`), with the narrow-or-flip hypothesis and the actual result.
- [ ] Non-gating, under `evals/`, no new webhands verb; a deterministic self-test
      covers the new eval's plumbing under the `evals` `self-test` script (never
      `pnpm test`).

## Blocked by

- `cut-per-run-context-overhead-cta-and-discovery` and
  `snapshot-ref-actionable-unify-with-by-ref`: this eval's WHOLE POINT is to
  measure the verb surface's look->decide->act value, so it must run against the
  IMPROVED surface (CTA off by default + a complete skill, and actionable snapshot
  refs). Building it before those land would record numbers that are immediately
  stale (the overhead fix shifts every token total; the snapshot-ref fix changes
  the read->act cost this eval specifically stresses). Serialise it LAST so its
  recorded run reflects webhands at its genuine best. (This is a measurement-
  ordering dependency, not a code one: the eval only USES the existing
  `--compare`/`--agent-kind` machinery + adds a new `*.eval.ts`.)
- Otherwise builds on the eval-harness foundation, the nonce machinery
  (`evals/src/nonce.ts`), and the shared-CDP comparison
  (`tasks/done/eval-baseline-shared-driving-surface-over-cdp.md`).

## Prompt

> Goal: add the FIRST dynamic eval that a write-once-run-once script CANNOT win,
> because the correct actions resolve only from live, varying page state, so both
> toolkits must observe-then-act. This measures the verb surface's look->decide->act
> value, which the current statically-scriptable evals under-measure (idea
> `work/notes/ideas/dynamic-evals-that-cannot-be-one-shot-scripted.md`;
> `evals/SCOREBOARD.md` shows raw Playwright wins on static flows BY scripting
> blind). Build ONE well-designed dynamic eval (a spike), not a tier.
>
> READ FIRST: the idea note (the levers + risks); an existing `*.eval.ts`
> (`evals/src/catalogue/saucedemo-core-flow.eval.ts`, `parabank-transfer.eval.ts`)
> for the entry shape (goal, health, milestones, endState, the no-priming rule);
> `evals/src/no-priming.ts` (`assertNoPriming`); `evals/src/nonce.ts` (per-run
> nonce); `evals/SCOREBOARD.md` (where to record the dynamic run);
> `evals/src/bin/run-evals.ts` (`--compare`/`--agent-kind`).
>
> KEY DESIGN POINTS: combine enough dynamic levers that a blind script provably
> cannot encode the flow, a RUNTIME-REVEALED VARYING TARGET (cheapest in-stock /
> entire current balance / the nonce-tagged row) and/or a MID-RUN TERMINATION ON A
> LIVE ON-PAGE VALUE (add to cart until the shown subtotal exceeds the shown
> threshold). Use the nonce machinery so a cached script is useless. The GOAL names
> the CONDITION, never selectors/values (no-priming: outcome-shaped, passes
> assertNoPriming, no method-leak). The end-state must be DETERMINISTICALLY
> checkable by the harness's own reads despite the dynamic path. Pick a target that
> is host-deterministic but agent-unpredictable, a small randomised LOCAL fixture is
> safest for a deterministic spike (weigh vs a live sandbox's realism); decide +
> record. Run it under the existing --compare/--agent-kind machinery (no engine
> change) and record a live run in a new SCOREBOARD `## Dynamic (non-scriptable)
> read` section with the narrow-or-flip hypothesis + actual result. Non-gating,
> under evals/, no new verb, deterministic self-test for the plumbing (never
> pnpm test).
>
> What "done" means: one dynamic eval that a blind script cannot win; goal
> no-priming-clean; end-state deterministically checkable; runs under the existing
> comparison machinery; a live run recorded on the scoreboard with the hypothesis;
> non-gating with a self-test.
>
> FIRST, confirm the eval-contract shape (health/milestones/endState), the nonce
> API, and the --compare machinery are as described (they may have evolved);
> reconcile rather than duplicate. CRITICAL: before building a suite, SPIKE the one
> eval and confirm the Playwright baseline genuinely CANNOT one-shot it (a capable
> script agent can read-and-branch mid-script; the levers must force enough
> re-planning that a single blind script fails). RECORD the target choice, the
> dynamic levers, and the spike result.
