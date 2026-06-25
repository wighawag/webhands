---
title: Playwright launch transport with a dedicated persistent profile
slug: playwright-launch-transport-and-profile
prd: browser-controller-cli
blockedBy: [scaffold-monorepo-and-driver-seam]
covers: [2, 3, 4]
---

## What to build

The v1 concrete transport behind the `core` seam: a Playwright transport that
opens a browser via `launchPersistentContext` against a **dedicated profile
directory** the controller owns (under a config location, e.g.
`~/.my-browser-controller/profiles/<name>`), supporting both headed and headless
launch. It NEVER points at the OS default Chrome profile (Chrome policy refuses
to automate it — see `docs/adr/0002`). State (cookies, storage) persists in the
profile dir across runs.

A thin vertical slice: `open` on the launch transport returns a working `Session`
whose `Page` can be driven by the seam; relaunching against the same profile dir
sees the persisted state. Tests drive a real local Playwright browser against the
local fixture page and assert profile persistence across a relaunch (set a cookie
/ storage value in run 1, observe it in run 2).

## Acceptance criteria

- [ ] A Playwright transport implements the `core` `Driver`/`Transport` interface (no CDP/Chromium-only types in the seam's public surface; ADR-0003).
- [ ] `launchPersistentContext` is used against a dedicated profile dir under a config location; the OS default Chrome profile is never targeted (ADR-0002).
- [ ] Both headed and headless launch are supported and selectable.
- [ ] State persists across relaunch: a test sets state in one launch and observes it in a fresh launch against the same profile dir.
- [ ] A missing browser binary and a not-yet-set-up profile each surface as a TYPED / identifiable error from `core` (distinguishable, not a bare string), so the CLI task can render the exact-fix-command message for story 17. (This task OWNS the typed condition in `core`; `cli-incur-wiring-and-errors` owns the user-facing message text.)
- [ ] Tests drive a real local Playwright browser against the local fixture page (not a third-party site) and assert at the `core` `Driver` seam.
- [ ] **Shared-write isolation:** profile-dir tests point the profile root at a temp/scratch dir (via the relevant env/config) and assert the real `~/.my-browser-controller` location is UNTOUCHED after the run.
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `scaffold-monorepo-and-driver-seam` (the seam and fixture harness must exist).

## Prompt

> Goal: implement the v1 Playwright launch transport with a dedicated persistent
> profile. Read the prd `work/prds/ready/browser-controller-cli.md` (Solution —
> launch mode; Implementation Decisions — Profile management) and ADRs `0002`
> (real session over spoofing — why a dedicated profile, never the default Chrome
> profile) and `0003` (seam not CDP-coupled). Read `CONTEXT.md` for `profile`,
> `launch`, `driver/transport`.
>
> This depends on `scaffold-monorepo-and-driver-seam`: the `Driver`/`Transport`
> interface and the local fixture-page harness already exist. Implement against
> that seam. The highest test seam is the `core` `Driver` interface, exercised
> against a real local Playwright browser hitting the local fixture page
> (deterministic) — assert profile persistence across a relaunch.
>
> CRITICAL: the profile dir is a SHARED/GLOBAL location (`~/.my-browser-controller`).
> Tests MUST point it at a temp dir and assert the real one is untouched.
>
> Surface a MISSING-BINARY and a MISSING-PROFILE condition as a TYPED/identifiable
> error from `core` (not a bare string) so the later `cli-incur-wiring-and-errors`
> task can render story 17's exact-fix-command message without re-detecting. This
> task owns the typed condition; the CLI owns the message text.
>
> "Done" = launch transport opens headed and headless against a dedicated profile,
> state survives a relaunch, missing-binary/missing-profile surface as typed core
> errors, tests green at the seam with the profile root isolated.
>
> FIRST, check this task against current reality — confirm the scaffold landed the
> seam shape this assumes; if it differs, reconcile or route to needs-attention
> rather than building on a stale premise. RECORD non-obvious in-scope decisions
> (e.g. the exact config-location resolution and its env override).
