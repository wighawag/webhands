---
title: snapshot verb (token-cheap structured page view with stable refs)
slug: verb-snapshot
prd: browser-controller-cli
blockedBy: [playwright-launch-transport-and-profile]
covers: [7]
---

## What to build

The `snapshot` verb in `core`, behind the seam: return a **token-cheap, structured
view** of the active page (accessibility tree + visible text) with **stable element
refs** an agent can later address, so the agent understands the page and decides
what to click WITHOUT parsing raw HTML. Defaults to the accessibility-tree +
visible-text view; a `--full` option returns the raw DOM (a settled prd decision).

A thin vertical slice through the seam: `snapshot` runs against a real local
browser driving the local fixture page and returns a structured result whose shape
is asserted (roles/names/text present, refs stable across re-snapshots of an
unchanged page, `--full` returns raw DOM).

## Acceptance criteria

- [ ] `snapshot` returns a structured accessibility-tree + visible-text view by default (not raw HTML), token-cheap for an agent to read.
- [ ] Element refs in the snapshot are stable for an unchanged page (re-snapshotting yields the same refs).
- [ ] A `--full` option returns the raw DOM.
- [ ] The verb is exposed through the `core` seam (transport-neutral; no CDP/Chromium-only types leaked).
- [ ] Tests drive a real local browser against the local fixture page and assert the snapshot SHAPE (not brittle third-party DOM) at the `core` `Driver` seam.
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `playwright-launch-transport-and-profile` (needs a real transport to drive in tests).

## Prompt

> Goal: implement the `snapshot` verb. Read the prd
> `work/prds/ready/browser-controller-cli.md` (User Story 7; Testing Decisions —
> assert snapshot SHAPE, not real third-party DOM) and `CONTEXT.md` (`verb`,
> `snapshot`). The verb lives in `core` behind the transport seam (ADR-0003) — keep
> CDP/Playwright types out of the public surface. Snapshot refs and the
> Playwright-locator addressing (ADR-0004) are complementary ways to address
> elements.
>
> Depends on `playwright-launch-transport-and-profile`: drive a REAL local browser
> against the LOCAL FIXTURE PAGE. Assert the snapshot SHAPE (roles/names/text
> present; ref stability across re-snapshots) against a controlled fixture — never
> assert on live third-party DOM (it rots).
>
> Default view = accessibility tree + visible text; `--full` = raw DOM (settled
> prd decision).
>
> "Done" = `snapshot` returns the cheap structured view with stable refs by default
> and raw DOM under `--full`, tested at the seam against the fixture page.
>
> FIRST, check this task against current reality. RECORD non-obvious in-scope
> decisions (e.g. the exact snapshot serialization format and the ref scheme).
