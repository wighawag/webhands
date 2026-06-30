---
title: A LOCAL messy-DOM tier-3 eval (explore an unfamiliar/hostile DOM to find-then-act) + run the webhands-script-only vs Playwright head-to-head
slug: eval-tier3-local-messy-dom-explore-then-act
blockedBy: []
covers: []
---

## What to build

Add the FIRST stable tier-3 eval that measures webhands' intended edge: driving a
MESSY, unfamiliar DOM where a blind write-once script breaks down because the agent
must EXPLORE the page (snapshot/read) to FIND the right elements before it can act.
The existing tier-3 `magento-checkout` is a live Cloudflare-fronted store that has
been hard-down (HTTP 526) for days (finding
`work/notes/findings/magento-demo-tier3-stability.md`; re-probed 2026-06-30, still
526), so it reports INCONCLUSIVE and yields NO head-to-head reading. Replace that
gap with a LOCAL, host-deterministic, agent-unpredictable messy-DOM fixture (the
SAME proven approach as the dynamic eval `cart-threshold-checkout`:
`evals/src/dynamic-fixture.ts` + its `run-evals.ts` lifecycle), so the tier-3
reading is reproducible and immune to third-party outages.

This DIRECTLY tests the user's hypothesis: webhands should win (or at least not
lose) where "write-a-Playwright-script-once" breaks down because the DOM is messy
and must be explored step by step. It is the natural next measurement after the
clean token tie on the easy/stable dynamic fixture (which came out a TIE; the edge
is expected to show on messier DOMs - see the `### Script-only head-to-head`
re-run note in `evals/SCOREBOARD.md`).

### The fixture: messy DOM, but PLAYWRIGHT-FAIR (this is the load-bearing design)

Build a LOCAL messy-DOM fixture (`evals/src/messy-dom-fixture.ts`, mirroring
`dynamic-fixture.ts`: a nonce-seeded `http.createServer` serving deterministic
HTML; a `resolveMessyModel(nonce)`; a `computeExpected...` the harness re-derives;
a `startMessyDomFixtureServer()`). The DOM must be HOSTILE TO BLIND SCRIPTING but
NOT rigged against Playwright - both legs face the IDENTICAL DOM, so any webhands
edge is about the EXPLORE surface, never a DOM tilted in webhands' favour. Messy
levers (combine several; all nonce-seeded so a cached script is useless):

- **No semantic landmarks / no stable hooks**: no `id`/`data-testid`/`name`/ARIA
  roles on the target controls; the actionable elements are generic
  `<div>`/`<span>` with nonce-RANDOMISED, meaningless class names (e.g.
  `class="x7f3a"`), so neither toolkit can hardcode a selector and BOTH must
  locate by VISIBLE TEXT / structure / position discovered at runtime.
- **The target is identified only by CONTENT the agent must read**: e.g. "click the
  control in the card whose label contains <a nonce word the page shows>", or
  "the row whose status text is <nonce-seeded state>". The agent must SNAPSHOT/READ
  to find which element, then act - a blind script cannot pre-encode the selector.
- **Multi-step explore-to-find navigation**: the target is not on the first view;
  the agent must act (open a section / expand / paginate) to REVEAL it, then read
  again. So the flow is read -> act -> read -> act, not one blind script.
- **Decoys + late content**: several similar-looking elements (only one correct,
  distinguished by the nonce content), and the actionable content arrives via a
  short delayed render (a `setTimeout`-injected fragment) so the agent must pace
  (wait) and re-read - exactly the messy-real-DOM behaviour the tier exists to
  catch.

Keep it DETERMINISTIC for the harness: every value (the nonce word, the correct
target, the decoys, the reveal step) is a pure function of the per-run nonce, and a
`computeExpectedTarget(model)` (like `computeExpectedPlan`) lets the harness CHECK
the end state by READING the page (its own webhands reads), not by re-deriving the
agent's clicks. The end state must be deterministically checkable (e.g. the page
shows a nonce-tagged "done"/"selected <correct>" marker only when the right control
was actioned).

### The eval entry

A new `*.eval.ts` in `evals/src/catalogue/` (mirror
`cart-threshold-checkout.eval.ts`: a BUILDER `(model) => EvalEntry` so the
nonce-seeded entry URL + harness checks bind per run, while the GOAL stays
nonce-free). `tier: 'tier-3'`. The GOAL is OUTCOME-SHAPED and NO-PRIMING-CLEAN:
it names the CONDITION ("select/submit the option described by the page's
instruction", "act on the item whose label matches what the page tells you") and
NO selectors, NO class names, NO step list, NO values. It MUST pass
`assertNoPriming` and be reviewed for method-leak. Wire health/milestones/endState
like the existing entries; the end-state assertion stays the harness's OWN reads.

### Wiring + self-test (no engine change)

- Wire it into `run-evals.ts` the SAME way the dynamic fixture is (a
  `MESSY_DOM_FIXTURE_EVAL_ID` + a `runMessyDomFixtureEval` that starts the server,
  builds the entry against `fixture.url`, runs under the EXISTING
  `--compare`/`--agent-kind` machinery, and `finally`-closes the server). NO
  harness-engine change; it just adds another local-fixture eval id + its
  server lifecycle (mirror `runDynamicFixtureEval`). Register it in the help list.
- A deterministic self-test (under the `evals` `self-test` script, never
  `pnpm test`), mirroring `dynamic-cart-eval.test.ts`: the fixture is
  nonce-deterministic (same nonce -> same DOM + same correct target); the messy
  levers actually hold (NO stable id/testid on the targets; the correct target is
  identified only by nonce content; decoys present; reveal step required); the GOAL
  passes `assertNoPriming` and names no selector/class/URL beyond the entry; a
  PRIMED correct-action trace -> PASS and a wrong-target trace -> FAIL on the
  end-state check.

### The head-to-head run (the measurement - the point)

RUN the new eval `webhands-script-only` vs `playwright` (and `webhands-skilled`
for context if cheap), SAME agent + model + `--parse-usage` as every scoreboard
run (`pi --print --mode json --tools bash,read,write --model
etherplay/claude-opus-4-8`), enough repeats for a small spread. The Playwright leg
now uses the FAIR disconnect-to-exit preamble (task
`playwright-baseline-fair-cdp-lifecycle-and-token-tie-rerun`, merged), so it can
complete. Record a NEW dated `## Tier-3 (messy DOM, explore-then-act) read`
section in `evals/SCOREBOARD.md` with the hypothesis (on a hostile DOM the agent
must explore, webhands' token-cheap `snapshot`/`query` reads should NARROW or FLIP
the gap vs a Playwright agent serialising DOM to find targets) and the ACTUAL
result whichever way it falls - both informative. If a leg cannot complete, record
THAT honestly (do not fabricate). Note explicitly whether webhands' explore reads
(`snapshot`/`query`) were cheaper than the Playwright agent's DOM-serialisation to
locate the same targets - that is the specific edge this eval isolates.

Non-gating, under `evals/` only; no new webhands verb.

## Acceptance criteria

- [ ] A LOCAL messy-DOM fixture (`evals/src/messy-dom-fixture.ts`): nonce-seeded,
      host-deterministic, served per run; the actionable targets have NO stable
      id/testid/role and nonce-randomised class names, the correct target is
      identified only by nonce CONTENT the agent must READ, there are decoys, a
      reveal/navigation step, and short delayed content - so a blind one-shot
      script cannot encode it. Both toolkits face the IDENTICAL DOM (Playwright-fair).
- [ ] A new tier-3 `*.eval.ts` (builder) whose GOAL is outcome-shaped and
      no-priming-clean (names the condition, not selectors/classes/values; passes
      `assertNoPriming`, reviewed for method-leak); health/milestones/endState
      wired; the end-state is deterministically checkable by the harness's OWN reads
      via `computeExpectedTarget(model)`.
- [ ] Wired into `run-evals.ts` under the existing `--compare`/`--agent-kind`
      machinery (a fixture-server lifecycle mirroring `runDynamicFixtureEval`); NO
      harness-engine change; no new webhands verb.
- [ ] A deterministic self-test (under the `evals` `self-test` script, never
      `pnpm test`) covers: nonce-determinism, the messy levers actually hold (no
      stable hooks; correct target by nonce content; decoys; reveal step), the goal
      passes `assertNoPriming`, and primed-correct -> PASS / wrong-target -> FAIL.
- [ ] A live head-to-head run (`webhands-script-only` vs `playwright`, + skilled
      for context if cheap) recorded in a new `## Tier-3 (messy DOM,
      explore-then-act) read` section of `evals/SCOREBOARD.md`, with the
      narrow-or-flip hypothesis and the actual result (or an honest record if a leg
      cannot complete), explicitly noting whether webhands' explore reads were
      cheaper than Playwright's DOM-serialisation to locate the targets.
- [ ] Non-gating, under `evals/` only; `pnpm test` stays green.

## Blocked by

- None. Builds on the dynamic-fixture pattern (`evals/src/dynamic-fixture.ts` +
  its `run-evals.ts` lifecycle), the `webhands-script-only` kind, and the FAIR
  Playwright preamble (all merged). Replaces the head-to-head gap left by the
  hard-down live `magento-checkout` tier-3 eval (finding
  `work/notes/findings/magento-demo-tier3-stability.md`).

## Prompt

> Goal: add the FIRST stable tier-3 eval that measures webhands' intended edge -
> driving a MESSY, unfamiliar DOM where a blind one-shot script breaks down because
> the agent must EXPLORE (snapshot/read) to FIND the right elements before acting -
> then run the `webhands-script-only` vs `playwright` head-to-head on it. The live
> `magento-checkout` tier-3 is hard-down (HTTP 526 for days, re-probed 2026-06-30;
> finding `work/notes/findings/magento-demo-tier3-stability.md`), so it yields no
> head-to-head; build a LOCAL, host-deterministic, agent-unpredictable messy-DOM
> fixture instead (the SAME proven pattern as `cart-threshold-checkout`). This
> directly tests "webhands wins where write-a-script-once breaks down on a messy
> DOM", the natural next measurement after the easy-fixture token TIE (see the
> `### Script-only head-to-head` re-run in `evals/SCOREBOARD.md`).
>
> READ FIRST and mirror (do not duplicate): `evals/src/dynamic-fixture.ts` (the
> nonce-seeded `http.createServer` fixture + `resolveFixtureModel` +
> `computeExpectedPlan` + `startDynamicFixtureServer` - the template);
> `evals/src/catalogue/cart-threshold-checkout.eval.ts` (the BUILDER
> `(model) => EvalEntry`, the no-priming outcome-shaped goal, health/milestones/
> endState); `evals/src/bin/run-evals.ts` (`DYNAMIC_FIXTURE_EVAL_ID` +
> `runDynamicFixtureEval` lifecycle ~line 59/404/425 - the wiring point);
> `evals/test/dynamic-cart-eval.test.ts` (the self-test shape); `evals/src/nonce.ts`;
> `evals/src/no-priming.ts` (`assertNoPriming`); the `## Dynamic (non-scriptable)
> read` + `### Script-only head-to-head` sections of `evals/SCOREBOARD.md`.
>
> KEY DESIGN POINTS: the fixture must be HOSTILE TO BLIND SCRIPTING but
> PLAYWRIGHT-FAIR - both legs face the IDENTICAL DOM, so a webhands edge is the
> EXPLORE surface, not a rigged DOM. Messy levers (nonce-seeded so a cached script
> is useless): NO stable id/testid/role on targets + nonce-randomised meaningless
> class names (force locate-by-visible-text/structure); the correct target
> identified ONLY by nonce CONTENT the agent must read (with decoys); a multi-step
> explore-to-reveal navigation (target not on the first view); short delayed
> content (a setTimeout-injected fragment) so the agent must pace + re-read. Keep it
> DETERMINISTIC: every value a pure function of the nonce; a `computeExpectedTarget`
> lets the harness check the end state by its OWN reads. The GOAL is outcome-shaped
> + no-priming-clean (names the condition, not selectors/classes/values; passes
> `assertNoPriming`). Wire into `run-evals.ts` mirroring `runDynamicFixtureEval` (a
> new fixture-eval id + server lifecycle, NO engine change). Add a deterministic
> self-test (nonce-determinism; the messy levers hold; goal passes assertNoPriming;
> primed-correct PASS / wrong-target FAIL) under the `evals` self-test, never
> `pnpm test`.
>
> THEN run the head-to-head: `webhands-script-only` vs `playwright` (+ skilled for
> context if cheap), same agent+model+--parse-usage, a few repeats for a spread
> (the Playwright leg now uses the FAIR disconnect-to-exit preamble, so it can
> complete). Record a new `## Tier-3 (messy DOM, explore-then-act) read` section in
> `evals/SCOREBOARD.md` with the narrow-or-flip hypothesis and the ACTUAL result,
> explicitly noting whether webhands' `snapshot`/`query` explore reads were cheaper
> than the Playwright agent serialising DOM to locate the same targets. If a leg
> cannot complete, record THAT honestly - do not fabricate.
>
> What "done" means: a stable, reproducible tier-3 messy-DOM eval a blind script
> cannot win; goal no-priming-clean; end-state harness-checkable; runs under the
> existing comparison machinery; a self-test for the plumbing + the messy levers; a
> live head-to-head recorded with the hypothesis and the real result. Non-gating,
> evals-only, no new verb, `pnpm test` green.
>
> RECORD the non-obvious decisions (the messy levers chosen, how the correct target
> is nonce-encoded + checked, and the head-to-head result + what it says about the
> explore-read edge).
