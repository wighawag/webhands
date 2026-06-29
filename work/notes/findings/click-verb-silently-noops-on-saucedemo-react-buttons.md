---
title: The webhands `click` verb returns `ok: true` but SILENTLY NO-OPS on SauceDemo's React buttons (add-to-cart / inventory / checkout navigation); the agent had to fall back to the `eval` escape hatch (`element.click()`) to fire the handlers. A clean-fixture-passing verb breaking on a real messy DOM, exactly what the Tier-1 eval exists to catch.
slug: click-verb-silently-noops-on-saucedemo-react-buttons
type: finding
status: incubating
source: 'live capability-eval run 2026-06-29: `pnpm --filter @webhands/evals run-eval --eval saucedemo-core-flow --headed --agent-cmd "pi -p --tools bash,read"` against the REAL https://www.saucedemo.com/ with pi (claude-driven) as the unaided agent-under-test. The agent self-reported the failure AND verified it out-of-band by reading `localStorage[''cart-contents'']` (stayed `null`) and the cart badge after a `click` that returned `ok: true`; the worked-around run still reached `checkout-complete.html` (the harness scored it PASS via its own read-verb end-state assertion). Reproduce by re-running that eval headed and watching the cart badge after a verb `click` on `#add-to-cart-sauce-labs-onesie`.'
---

## What this settles

The first REAL-SITE behaviour the agent-capability eval harness surfaced that the
LOCAL-FIXTURE verb tests could not: the `click` verb is NOT reliable on a real
React-driven DOM. This is precisely the "works on a clean fixture, fails on a real
messy DOM" regression the harness was built to catch (prd `agent-capability-eval-harness`,
User Stories 8 + 13; the missing-verb-as-FINDING convention in `docs/eval-harness.md`).

## Result (observed, not assumed)

Driving SauceDemo with ONLY the verb surface (no priming), the unaided agent found:

- `type` and `select` verbs worked correctly (login fields, the price-sort dropdown).
- The `click` verb returned `ok: true` for the inventory **add-to-cart** button and
  the **checkout navigation** buttons, but the click DID NOT fire the site's React
  click handlers: the cart badge did not change and `localStorage['cart-contents']`
  stayed `null`. The verb reported success while nothing happened.
- The login button `click` happened to work; the inventory/checkout buttons did not.
- The agent diagnosed this itself (reading `localStorage` + the cart badge as
  ground truth) and worked around it with the documented `eval` escape hatch
  (`element.click()` in page-world JS), which fired the handlers correctly. With
  that fallback the full purchase completed and the harness scored the run PASS.

So the capability bar was cleared (a capable agent got past it with `eval`), but a
core act verb is silently lying about success on a mainstream framework DOM.

## Why this is load-bearing, not trivia

`click` reporting `ok: true` on a no-op is the **worst failure shape** for an
agent: it is SILENT. A less capable agent (or one that trusts the verb's `ok`)
would believe the item was added, proceed to checkout, and complete an order for
an EMPTY cart, never noticing. On a clean local fixture the synthetic button's
handler fires synchronously so the verb looks correct; only a real React DOM
(event delegation, synthetic events, hydration timing) exposes the gap. This is
exactly the class of regression a local fixture is structurally unable to reveal,
and why the eval harness is the capability scoreboard rather than another gate.

## Likely mechanism (to verify in the follow-up)

Candidates, in rough priority, for whoever picks this up:

- The verb may use a Playwright `click` path that dispatches in a way SauceDemo's
  React (synthetic-event delegation on the root) does not observe, or it resolves
  the locator to a non-interactive ancestor/overlay and "clicks" it.
- A timing / actionability gap (the handler is attached after the verb's
  actionability check passes), so the click lands before React wires the listener.
- An overlay / pointer-events nuance specific to the Luma-like React build.

The fix is NOT in the eval harness (it adds no verbs and changes no behaviour, per
its charter): this is a candidate for a future **verb-surface** change/PRD against
`packages/core`'s `click` implementation. Per the missing-verb-as-FINDING
convention, this note IS the artifact; the surface fix is a separate, reviewed
change.

## Provenance

Surfaced during a human-driven live demo of the Tier-1 SauceDemo eval on
2026-06-29 (the first time the harness drove a real site with a real agent).
Pairs with `evals/src/catalogue/saucedemo-core-flow.eval.ts` (the eval that
exposed it) and `docs/eval-harness.md` (the missing-verb-as-finding convention
this note follows). The harness's own `eval` escape-hatch is what let the agent
recover, which is itself evidence the read/coordinate surface is rich enough to
work around a broken act verb.
