---
title: cookies export/import verb (move, back up, or seed a session)
slug: verb-cookies-export-import
prd: browser-controller-cli
blockedBy: [playwright-launch-transport-and-profile]
covers: [11]
---

## What to build

The `cookies export` / `cookies import` verbs in `core`, behind the seam, so a user
can move or back up a session, or seed a profile. `export` returns the active
context's cookies in a structured form; `import` loads cookies into the active
context.

A thin vertical slice through the seam: a cookie round-trip is asserted against a
real local browser driving the local fixture page — export the cookies, clear/
re-import into a fresh context, and observe them restored.

## Acceptance criteria

- [ ] `cookies export` returns the active context's cookies in a structured form.
- [ ] `cookies import` loads cookies into the active context.
- [ ] A round-trip works: export → import into a fresh context restores the cookies.
- [ ] The verb is exposed through the `core` seam (transport-neutral; no CDP/Chromium-only types leaked).
- [ ] Tests drive a real local browser against the local fixture page and assert the cookie round-trip at the `core` `Driver` seam.
- [ ] **Shared-write isolation:** if a test writes an export file to disk, it writes only to its own temp fixture dir (no shared/global location touched).
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `playwright-launch-transport-and-profile` (needs a real transport to drive in tests).

## Prompt

> Goal: implement the `cookies export` / `cookies import` verbs. Read the prd
> `work/prds/ready/browser-controller-cli.md` (User Story 11) and `CONTEXT.md`
> (`verb` — cookies export/import). The verb lives in `core` behind the transport
> seam (ADR-0003) — keep CDP/Playwright types out of the public surface.
>
> Depends on `playwright-launch-transport-and-profile`: drive a REAL local browser
> against the LOCAL FIXTURE PAGE and assert a cookie ROUND-TRIP (export → re-import
> into a fresh context → cookies restored). Keep any export file in the test's own
> temp dir.
>
> "Done" = cookies export/import round-trips through the seam, tested against the
> fixture page.
>
> FIRST, check this task against current reality. RECORD non-obvious in-scope
> decisions (e.g. the export format and whether import merges or replaces).
