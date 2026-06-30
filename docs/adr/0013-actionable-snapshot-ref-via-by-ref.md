---
status: accepted
---

# `snapshot`'s `[ref=eN]` is directly actionable via `--by-ref` (an actionable snapshot ref ALONGSIDE the locator grammar; adds to ADR-0004, not replaces it)

`snapshot` tags every node with Playwright's native `[ref=eN]` (from `ariaSnapshot({mode: 'ai'})`). An agent that READS the page and wants to ACT on `[ref=e3]` can now pass that bare `e3` (or the fuller `aria-ref=e3`) straight to `click`/`type` `--by-ref`, so "read the page with `snapshot`, then act on what you read" is ONE loop with no detour through `query --with-refs` or `eval`. The `core` interaction hand normalizes a snapshot ref to `page.locator('aria-ref=eN')` (Playwright's `aria-ref=` locator engine) and resolves it through the SAME single resolver and the SAME exactly-one fail-loud guard (`assertRefResolvesToOne` / `StaleRefError`) the durable `query` ref already uses. We did this because the scoreboard transcripts (`work/notes/findings/scoreboard-api-friction-from-transcripts-ref-collision-and-page-prefix.md`) showed the agent reading a snapshot ref, being unable to act on it, and falling back to `eval` + `querySelectorAll` to rediscover real selectors, a recurring round-trip tax (a "two-ref collision": the same word `ref` for two things, only one actionable).

## What it is (the resolved design)

- **Option A (chosen): reuse `--by-ref`.** A `--by-ref` target is now one of TWO kinds of ref, unified at a single normalization point (`normalizeRefToLocator` in `hand-host.ts`):
  - a `snapshot` `[ref=eN]` ref, accepted as the bare `eN` OR `aria-ref=eN`, rewritten to `p.locator("aria-ref=eN")` (the id JSON-encoded into the call so nothing can break out of the expression);
  - a durable `query` ref, already a `p.locator(...)` expression, passed through UNCHANGED.
  Both then go through the existing `assertRefResolvesToOne` (resolve-to-zero / resolve-to-many => typed `StaleRefError`) and the one `resolveLocator`. The SAME normalized expression is used for the assert AND the act, so the fail-loud check and the action can never resolve different elements.
- **A spike confirmed the mechanism** (recorded inline in the task `## Decisions`): `page.locator('aria-ref=eN')` resolves the element a snapshot just showed (count 1, clicks/fills it); a removed element / out-of-range / never-minted / malformed `eN` all resolve to count 0 (never throw on `.count()`), so they surface as a clean `StaleRefError(matched: 0)`; and Playwright RE-KEYS `eN` on each `ariaSnapshot`, so an old snapshot ref goes stale after a re-snapshot.

## The honest durability distinction (load-bearing; do not let one do the other's job)

A snapshot `aria-ref=eN` is **snapshot-scoped**: it is an "act on what I just saw" handle, re-keyed every `ariaSnapshot`, so it correctly goes stale after a DOM change or a re-snapshot. The durable `query` ref deliberately **survives list mutation** (a reused stable attribute or a minted `data-webhands-ref`, ADR's R4 ladder). They share the SAME `--by-ref` flag and the SAME exactly-one fail-loud contract, but they are DIFFERENT durability models, and the docs/help say so. Neither silently does the other's job: a snapshot ref that has gone stale fails LOUD (it does not silently survive), and the durable path is byte-for-byte unchanged (its tests prove it).

## Relationship to ADR-0004 (this ADDS, it does not replace)

ADR-0004 ("the verb surface exposes Playwright-equivalent locator semantics") explicitly CONSIDERED and REJECTED "CSS selector + snapshot ref-ids ONLY" as THE addressing model, because that would force a snapshot round-trip to address anything blind and cannot express compound/positional locators. Making the snapshot ref actionable revisits that boundary, so we record the decision here. The point is decisive: we ADD an actionable snapshot ref ALONGSIDE the full locator grammar, we do NOT replace it. The locator-expression addressing of ADR-0004 stays the primary, blind-addressable surface; the snapshot ref is an additive convenience for the read-then-act loop, gated behind the `--by-ref` opt-in (the default `click`/`type` argument is still a raw locator expression). ADR-0004's rejection of "ref-ids ONLY" therefore stands; this is "ref-ids ALSO".

## Considered options

- **(A) Accept the snapshot `aria-ref=eN` in the action verbs (chosen):** minimal and honest. The spike proved `page.locator('aria-ref=eN')` already resolves a snapshot ref, so the work is wiring + the same fail-loud guard + docs, no new addressing engine. Stays in ADR-0003 (the ref crosses the seam as an opaque string; no Playwright type leaks) and ADR-0004 (locator-expression addressing).
- **(B) Make `snapshot` emit the durable `data-webhands-ref` refs (rejected):** heavier, and it MUTATES the page (mints attributes) during what is a pure READ, conflating the two distinct durability models. The snapshot ref's value is exactly "act on what I just saw"; it does not need durable-ref machinery.
- **(C) Docs-only disambiguation (rejected as the primary fix):** cheapest, lowest value. It would leave the agent typing `page.locator('aria-ref=eN')` by hand. We keep the disambiguation (the honest durability framing in docs) but pair it with the actual actionable path (A), which is the leverage the finding asked for.

## Consequences

- ADR-0003 STANDS: the ref is an opaque string both ways across the seam and the RPC wire; no Playwright/CDP type leaks (the normalization is server-side in the hand, the wire request is unchanged: `{verb: 'click', locator: 'e3', options: {byRef: true}}`).
- ADR-0004 STANDS and is ADDED TO (not superseded): an actionable snapshot ref now sits alongside the locator grammar; "ref-ids ONLY" remains rejected.
- The durable `query --with-refs` + `click/type --by-ref` path and its `StaleRefError` fail-loud safety are UNCHANGED.
- FOLLOW-UP (separate task): re-measure on the scoreboard (a cold-vs-fixed `--compare`) to quantify the cut in `eval`-fallback round-trips. Not built here.
