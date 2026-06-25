---
title: goto and wait verbs (navigate + settle, pace actions)
slug: verb-goto-and-wait
prd: browser-controller-cli
blockedBy: [playwright-launch-transport-and-profile]
covers: [6, 10]
---

> FORWARD-NOTE (conductor, after `playwright-launch-transport-and-profile` landed):
> `navigate` (goto, `waitUntil: 'load'`) and `wait` (timeout/locator/navigation)
> already have working bodies in `makeSession`
> (`packages/core/src/playwright-launch-transport.ts`). REFINE + fully TEST those
> against the fixture (add delayed/XHR fixtures for the three `wait` forms); do NOT
> write a parallel second implementation. Confirm "settled" semantics (load vs
> networkidle) and the `wait` API shape are right; tighten if needed.

## What to build

Two page verbs in `core`, behind the seam:

- **`goto <url>`** — navigate the active page and wait for it to settle so
  subsequent reads see rendered content.
- **`wait`** — wait for a selector, a navigation, or a timeout, so an agent can
  pace actions like a human and let XHR-rendered content load.

A thin vertical slice through the seam: each verb runs against a real local
Playwright browser (launch transport) driving the local fixture page, and its
effect is asserted (after `goto` the page is at the URL and settled; `wait` blocks
until the selector/navigation/timeout condition is met).

## Acceptance criteria

- [ ] `goto` navigates the active page to a URL and waits for it to settle before returning.
- [ ] `wait` supports the three forms — selector, navigation, and timeout — and returns once the condition holds.
- [ ] Both verbs are exposed through the `core` seam (transport-neutral; no CDP/Chromium-only types leaked).
- [ ] Tests drive a real local browser against the local fixture page and assert each verb's effect at the `core` `Driver` seam (use fixture pages with delayed/XHR-rendered content for `wait`).
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `playwright-launch-transport-and-profile` (needs a real transport to drive in tests).

## Prompt

> Goal: implement the `goto` and `wait` verbs. Read the prd
> `work/prds/ready/browser-controller-cli.md` (User Stories 6 and 10) and
> `CONTEXT.md` (`verb`, `driver/transport`). The verbs live in `core` behind the
> transport seam (ADR-0003) — do not leak CDP/Playwright types into the public
> verb surface.
>
> Depends on `playwright-launch-transport-and-profile`: drive a REAL local browser
> against the LOCAL FIXTURE PAGE (deterministic), the highest test seam per the prd
> Testing Decisions. For `wait`, add fixture pages with delayed / XHR-rendered
> content so the three wait forms (selector, navigation, timeout) are exercised.
> Avoid asserting on real third-party DOM (it rots).
>
> "Done" = `goto` navigates and settles, `wait` handles selector/navigation/timeout,
> both tested at the seam against the fixture page.
>
> FIRST, check this task against current reality — confirm the launch transport and
> seam shape. RECORD non-obvious in-scope decisions (e.g. what "settled" means —
> load/networkidle — and the wait API shape).
