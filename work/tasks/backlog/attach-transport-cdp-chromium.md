---
title: attach transport via connectOverCDP (Chromium-only)
slug: attach-transport-cdp-chromium
prd: browser-controller-cli
blockedBy: [scaffold-monorepo-and-driver-seam]
covers: [5]
---

## What to build

The `attach` mode behind the `core` seam: a Playwright transport that connects via
`chromium.connectOverCDP(endpoint)` to a browser the USER already started with
remote debugging enabled, reusing the existing authenticated context —
`browser.contexts()[0]`, NOT `newContext()` — so the controller drives the user's
live, logged-in tabs on their real fingerprint and IP. Chromium-only, and
documented as such (CDP-attach is Chromium-only — see `docs/adr/0003`). The user
starts their own browser with `--remote-debugging-port`; there is no relaunch
helper (a settled prd decision).

A thin vertical slice: `open` in attach mode connects to a CDP endpoint, returns a
`Session` whose `Page` drives the existing context through the seam. Tests launch a
real local Chromium with a debugging port, point the attach transport at it, and
assert it reuses the existing context (not a fresh one) and can drive the local
fixture page through the seam.

## Acceptance criteria

- [ ] An attach transport implements the `core` seam via `connectOverCDP`, reusing `contexts()[0]` (the existing authenticated context), never `newContext()`.
- [ ] Attach is Chromium-only and this constraint is surfaced (clear error / documented) without leaking CDP/Chromium-only types into the seam's public surface (ADR-0003).
- [ ] No browser-relaunch helper is added; the user supplies a running browser with a remote-debugging endpoint.
- [ ] A test launches a real local Chromium with a debugging port, attaches, and asserts the existing context is reused and a verb drives the local fixture page through the seam.
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `scaffold-monorepo-and-driver-seam` (needs the seam + fixture harness). File-orthogonal to the launch transport — both can proceed in parallel after the scaffold.

## Prompt

> Goal: implement the `attach` transport (CDP, Chromium-only). Read the prd
> `work/prds/ready/browser-controller-cli.md` (User Story 5; Solution — attach;
> Implementation Decisions — attach) and ADRs `0002` (why a real live session) and
> `0003` (seam not CDP-coupled — attach is Chromium-only; keep CDP types out of the
> public seam). Read `CONTEXT.md` (`attach`, `driver/transport`).
>
> This depends on `scaffold-monorepo-and-driver-seam` and is file-orthogonal to the
> launch transport (different transport module), so it can run in parallel with the
> launch/profile work. Implement against the existing `Driver`/`Transport` seam.
>
> KEY constraints: reuse `browser.contexts()[0]` (NOT `newContext()`); Chromium-only;
> no relaunch helper (the user starts their browser with `--remote-debugging-port`
> themselves). The seam's PUBLIC types must stay CDP-free even though this concrete
> transport uses CDP internally.
>
> Test against a REAL local Chromium started with a debugging port driving the local
> fixture page — not a third-party site.
>
> "Done" = attach connects, reuses the existing context, drives the fixture page
> through the seam, Chromium-only constraint surfaced, tests green.
>
> FIRST, check this task against current reality — confirm the scaffold's seam shape.
> RECORD non-obvious in-scope decisions (e.g. endpoint format, multi-context choice).
