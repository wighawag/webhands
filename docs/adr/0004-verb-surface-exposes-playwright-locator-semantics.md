# The verb surface exposes Playwright-equivalent locator semantics (refines ADR-0003)

`click`/`type` (and any other element-addressing verb) accept a **raw Playwright locator string** (e.g. `getByRole('button', { name: 'Search' })`), which the active transport resolves. This refines ADR-0003's definition of "transport-neutral": the seam still must not leak *CDP/Chromium-only* types (CDP-attach is Chromium-only and genuinely foreclosing), but "neutral" is now defined as **Playwright-equivalent element addressing** rather than a reduced verb subset. We chose this because a future transport that is a *useful* fallback (including the deferred extension transport) must be Playwright-faithful anyway — a degraded subset is a fallback nobody wants — so exposing the full locator grammar does not raise the bar any real transport must clear; it states honestly what that bar always was. The benefit is maximal, LLM-native expressiveness (agents have deep Playwright training data) with no bespoke addressing dialect to learn, and the locator string sits naturally beside the existing `eval` escape hatch as an expression the controller resolves.

## Considered Options

- **CSS selector + snapshot ref-ids only (rejected):** smallest verb surface; the ref-id already gives churn-proof addressing. But it forces a snapshot round-trip to address anything blind and cannot express compound/filtered/positional locators without dropping to `eval`.
- **Structured locator representation (rejected):** zod-schemable JSON the controller maps to Playwright calls. Safer to schema, but a lossy re-encoding of a grammar Playwright already defines, and less natural for an LLM to emit.
- **Raw Playwright locator string (chosen):** full grammar, LLM-native, honest about being a resolved expression. Cost: the controller effectively executes a locator expression (sibling to `eval`), and a non-Playwright transport must reproduce Playwright locator semantics to qualify — which ADR-0003's fallback transports were always expected to do.

## Consequences

- ADR-0003 stands and is REFINED, not superseded: its load-bearing rule (do not leak CDP/Chromium-only types) is unchanged; only the meaning of "transport-neutral" is sharpened to "Playwright-equivalent locator semantics".
- The `Driver`/`Transport` seam is kept (it remains the highest test seam and the internal structure boundary) and is now explicitly allowed to speak Playwright-locator semantics.
- The deferred extension transport remains a live future path (ADR-0001/0002), now with an explicit capability floor: to qualify as a fallback it must offer Playwright-equivalent addressing.
- Firefox is unaffected: Playwright drives Firefox directly, so locator semantics are identical there; the only Firefox constraint remains CDP-`attach` (Chromium-only), per ADR-0003.
