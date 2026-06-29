# Locator expressions need a `page.` prefix; bare `getByRole(...)` / `#id` forms fail confusingly, costing an unaided agent several wasted turns

2026-06-29 (noticed during a live SauceDemo eval run with pi as the agent-under-test)

## What was seen

In a live `run-eval` of `saucedemo-core-flow` (pi driving the published webhands verbs, no priming), the agent reached a working login only AFTER ~5 reasoning turns spent discovering how to express locators. Its own words from the run:

- "The `getByRole` form isn't resolving as a bare expression."
- "The locator is being eval'd as JS. The CSS `#` is interpreted as a private field." (i.e. `#login-button` parses as a JS private-field reference, not a CSS id selector.)
- "The error 'getByRole is not defined' suggests it's being evaluated in a context without the page object."
- Resolution it found by trial: "The locator must be prefixed with `page.`" (e.g. `page.getByRole('button', { name: 'Finish' })`).

And it flagged it explicitly at the end: "A note on the CLI: locator expressions had to be prefixed with `page.` ... the bare `getByRole(...)` form documented in the manifest threw 'getByRole is not defined' in this build."

So a capable agent recovered, but only after burning turns (and tokens) probing the grammar. A less capable agent could get stuck here.

## Why this matters

This is exactly the kind of agent-facing friction the eval harness exists to surface, and it is a TWO-fold problem:

1. **Docs vs. reality drift.** The agent says the manifest/help DOCUMENTS a bare `getByRole(...)` form, but the running build REQUIRES `page.getByRole(...)`. If the documented form throws "getByRole is not defined", either the docs are wrong (should show the `page.` prefix) or the resolver should accept the bare form. A documented-but-broken form is the worst case (it actively misleads).
2. **`#id` footgun.** A bare `#login-button` in the locator expression is parsed as a JS private field (the expression is eval'd as JS), not a CSS selector, so the most natural thing an agent reaches for fails opaquely. The `page.locator('#login-button')` form works, but nothing steers the agent there first.

Both cost tokens and risk a stuck agent, and both are precisely measurable once the token-accounting task lands (`work/tasks/ready/eval-token-accounting-for-webhands-vs-baseline.md`): "turns/tokens wasted on locator-grammar discovery" is a concrete cost the verb surface imposes.

## Candidate fixes (for whoever picks this up; NOT a harness change)

This is a webhands VERB-SURFACE / DOCS issue, not an eval-harness issue (the harness adds no verbs; it just measured the friction). Options to weigh:

- **Fix the docs/help/`--llms-full` manifest** so the canonical locator form shown to agents is the one that actually works (`page.getByRole(...)`, `page.locator('#id')`), removing the bare form that throws. Cheapest, highest-leverage.
- **Make the resolver accept the bare form** (`getByRole(...)`, `locator('#id')`) by evaluating it with `page`/`p` in scope so a missing prefix is not a hard error. Richer, but changes the addressing contract (see ADR-0004 on locator-expression addressing) and must stay consistent across all locator-taking verbs.
- At minimum, **a clearer error**: "getByRole is not defined" should hint "did you mean `page.getByRole(...)`?" so an agent self-corrects in one turn instead of five.

The choice (docs-only vs. resolver-accepts-bare vs. better-error) is a real fork with an ADR-0004 implication; capture the decision in whatever task picks this up.

## Scope

Surfaced during a human-driven live demo, not a task build. It concerns `packages/core`'s locator resolution + the CLI help/`--llms-full` manifest, NOT the eval harness. Worth a verb-surface/docs task; pairs with the token-accounting task (which will quantify the cost) and the eval harness's missing-verb-as-FINDING convention (a real-DOM friction the scoreboard caught).
