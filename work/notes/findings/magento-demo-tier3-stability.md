---
title: The Magento demo store (magento.softwaretestingboard.com) is Cloudflare-fronted and FLAKY; observed hard-down with a Cloudflare 526 (origin SSL invalid) across all paths on 2026-06-29, which is exactly why the Tier-3 eval leans on the foundation's INCONCLUSIVE precheck rather than reporting a capability FAIL
slug: magento-demo-tier3-stability
type: finding
status: incubating
source: 'live probe 2026-06-29 while building the eval-magento-tier3 task: curl -sS -A "Mozilla/5.0 Chrome/120" against https://magento.softwaretestingboard.com/ and several paths (/catalogsearch/result/?q=jacket, /women.html, /checkout/cart/), each returned HTTP 526 (server: cloudflare, body "error code: 526") consistently across repeated attempts. Cross-checked with web search: the domain is a known live Luma/Adobe-Commerce demo store ("This is a demo store to test your test automation scripts. No orders will be fulfilled."); 526 = Cloudflare cannot validate the origin SSL cert (origin-side outage), not a client problem.'
---

## What this settles

The Tier-3 eval task's explicit ASSESSMENT requirement: "assess Magento's
stability/rate-limits and record the finding; a flaky/down Magento must report
INCONCLUSIVE, never a capability fail." This is the durable external ground truth
behind that decision.

## Result (observed, not assumed)

On 2026-06-29 the Magento demo store was HARD DOWN: every request (root,
`/catalogsearch/result/?q=jacket`, `/women.html`, `/checkout/cart/`) returned
**HTTP 526** from Cloudflare (`server: cloudflare`, body `error code: 526`),
repeatably over several minutes. A 526 means Cloudflare reached the edge but
could not validate the ORIGIN's SSL certificate, i.e. an origin-side outage, not
a transient network blip and not anything the eval harness can fix.

The domain is otherwise the well-known stable Luma/Adobe-Commerce demo store
(self-described "demo store to test your test automation scripts. No orders will
be fulfilled."), so the target choice is right; it is just **measurably flakier
than the sandbox tiers** (Tier-1 SauceDemo, Tier-2 ParaBank), exactly as the prd
(User Story 8) and the task warned. It is Cloudflare-fronted, so on top of plain
downtime it can also rate-limit / challenge automated traffic.

## Consequence for the Tier-3 eval (why this is load-bearing, not trivia)

This is precisely the condition the foundation's three-state outcome exists for.
The Tier-3 `magento-checkout` eval declares a health probe ("the Luma `#search`
box rendered on the entry page"); on a 526/Cloudflare-blocked Magento the
precheck's `goto` (or the landmark probe) fails, so `runPrecheck` returns
unhealthy and `evaluateOutcome` reports **INCONCLUSIVE** (retried, bounded),
**never a capability FAIL**. A capability FAIL is reserved for a HEALTHY Magento
the agent still could not drive. So a Magento outage shows up as INCONCLUSIVE on
the scoreboard, never as a false capability regression.

Operational note for whoever runs the standing eval: because Magento can be down
or rate-limited for extended windows, an INCONCLUSIVE run here is the EXPECTED
signal to widen the run interval (or retry later), not a harness bug. If Magento
proves chronically down, that is a signal to revisit the Tier-3 target (a
self-hosted Luma instance would remove the Cloudflare/origin flakiness), but the
INCONCLUSIVE handling means a flaky target degrades gracefully rather than
reddening anything.

## Provenance

Live probe 2026-06-29 while building `work/tasks/ready/eval-magento-tier3.md`
(the Tier-3 messy-real DOM regression-catcher eval). Pairs with the eval entry
`evals/src/catalogue/magento-checkout.eval.ts` and its offline test
`evals/test/magento-eval.test.ts`. The probe was plain `curl` (throwaway, not
committed).
