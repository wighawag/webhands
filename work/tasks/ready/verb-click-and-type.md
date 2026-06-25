---
title: click and type verbs (raw Playwright locator addressing)
slug: verb-click-and-type
prd: browser-controller-cli
blockedBy: [playwright-launch-transport-and-profile]
covers: [8]
---

## What to build

The `click <locator>` and `type <locator> <text>` verbs in `core`, behind the seam.
Elements are addressed by a **raw Playwright locator string** (e.g.
`getByRole('button', { name: 'Search' })`) which the active transport resolves —
NOT a reduced selector subset and NOT a structured JSON locator (see
`docs/adr/0004`). Handle hidden custom inputs where a normal click would time out
by dispatching a click (an escape path the prd calls out explicitly).

A thin vertical slice through the seam: each verb runs against a real local
browser driving the local fixture page and its effect is asserted — `click`
triggers the element's behaviour (including a hidden-input dispatch case), `type`
fills the addressed input.

## Acceptance criteria

- [ ] `click` and `type` accept a RAW Playwright locator string and resolve it via the active transport (ADR-0004) — not a reduced subset or structured JSON.
- [ ] A hidden custom input is handled via a dispatched click where a normal click would time out, and a fixture exercises that path.
- [ ] `type` fills the addressed input with the given text.
- [ ] Both verbs are exposed through the `core` seam; the seam's public types stay CDP/Chromium-free (ADR-0003), even though the locator string is Playwright-grammar.
- [ ] Tests drive a real local browser against the local fixture page and assert each verb's effect at the `core` `Driver` seam (including the hidden-input dispatch case).
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `playwright-launch-transport-and-profile` (needs a real transport to drive in tests).

## Prompt

> Goal: implement the `click` and `type` verbs with raw-Playwright-locator
> addressing. Read the prd `work/prds/ready/browser-controller-cli.md`
> (User Story 8) and ADR `0004` (the verb surface exposes Playwright-equivalent
> locator semantics — raw locator STRING, the chosen option; structured/CSS-subset
> were rejected) plus ADR `0003` (no CDP/Chromium-only types in the public seam).
> Read `CONTEXT.md` (`verb`, element addressing is Playwright-equivalent).
>
> Depends on `playwright-launch-transport-and-profile`: drive a REAL local browser
> against the LOCAL FIXTURE PAGE. Include a fixture with a HIDDEN custom input to
> exercise the dispatch-click path (a normal click times out; the prd calls this
> out). Assert effects against the controlled fixture, not third-party DOM.
>
> KEY: the locator is a raw Playwright expression the controller resolves (sibling
> to `eval`); do not invent a reduced dialect.
>
> "Done" = `click`/`type` resolve raw locator strings, the hidden-input dispatch
> case works, both tested at the seam against the fixture page.
>
> FIRST, check this task against current reality. RECORD non-obvious in-scope
> decisions (e.g. how the locator string is safely resolved, the dispatch trigger).
