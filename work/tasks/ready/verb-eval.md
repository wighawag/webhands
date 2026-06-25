---
title: eval verb (run JS in the page context, return the result)
slug: verb-eval
prd: browser-controller-cli
blockedBy: [playwright-launch-transport-and-profile]
covers: [9]
---

## What to build

The `eval <js>` verb in `core`, behind the seam: run JavaScript in the active
page's context and return the (serializable) result, as the escape hatch for cases
no other verb covers.

A thin vertical slice through the seam: `eval` runs against a real local browser
driving the local fixture page and the returned value is asserted (e.g. evaluating
an expression against fixture-page state returns the expected serialized value).

## Acceptance criteria

- [ ] `eval` runs a JS expression in the page context and returns its serializable result.
- [ ] The verb is exposed through the `core` seam (transport-neutral; no CDP/Chromium-only types leaked).
- [ ] Tests drive a real local browser against the local fixture page and assert the returned result at the `core` `Driver` seam.
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `playwright-launch-transport-and-profile` (needs a real transport to drive in tests).

## Prompt

> Goal: implement the `eval` verb. Read the prd
> `work/prds/ready/browser-controller-cli.md` (User Story 9) and `CONTEXT.md`
> (`verb`). The verb lives in `core` behind the transport seam (ADR-0003) — keep
> CDP/Playwright types out of the public surface. `eval` is the escape hatch and
> sits naturally beside the raw-locator addressing (ADR-0004), both being
> page-context expressions the controller resolves.
>
> Depends on `playwright-launch-transport-and-profile`: drive a REAL local browser
> against the LOCAL FIXTURE PAGE and assert the returned value against controlled
> fixture state — not third-party DOM.
>
> "Done" = `eval` runs JS in the page and returns a serializable result, tested at
> the seam against the fixture page.
>
> FIRST, check this task against current reality. RECORD non-obvious in-scope
> decisions (e.g. how non-serializable results are handled).
