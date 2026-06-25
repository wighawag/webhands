---
title: setup-profile headed one-time login verb
slug: setup-profile-headed-login
prd: browser-controller-cli
blockedBy: [playwright-launch-transport-and-profile]
covers: [1]
---

## What to build

The `setup-profile` flow in `core`: open the dedicated profile in a **headed**
(visible) browser so a human logs into a site and/or clears an anti-bot challenge
ONCE, then the saved cookies/state persist in the profile dir for later
`launch --headless` runs to reuse. This is the headed-login half of the
launch/profile story; it reuses the launch transport's persistent profile.

A thin vertical slice through `core`: `setup-profile` opens the named profile
headed, holds the browser open for the interactive login, and on close the
profile dir carries the new state. The build is the automatable mechanics (the
profile is opened headed, the right profile dir is used, state written during the
session persists), covered by tests against the local fixture page. The verb only
opens the WINDOW the human later logs into at runtime; the build itself never
touches a credential. The actual human login against a real site is exercised in
the manual Kayak smoke (owned by `docs-tos-humility-and-kayak-smoke`), not here.

## Acceptance criteria

- [ ] `setup-profile` opens the dedicated profile in a headed browser via the launch transport and keeps it open for interactive login.
- [ ] State written during the headed session persists in the profile dir and is visible to a subsequent (headless) launch against the same profile.
- [ ] A clear, actionable message tells the user what to do (log in / clear the challenge, then close) and which profile is being set up.
- [ ] Tests assert the testable behaviour (headed open against the correct profile dir; state persistence) against the local fixture page — NOT a third-party login.
- [ ] **Shared-write isolation:** tests point the profile root at a temp dir and assert the real `~/.my-browser-controller` is UNTOUCHED.
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `playwright-launch-transport-and-profile` (reuses the persistent launch transport and profile dir; same module, so serialized to avoid conflicts).

## Prompt

> Goal: implement the headed one-time-login `setup-profile` flow. Read the prd
> `work/prds/ready/browser-controller-cli.md` (User Story 1; Solution —
> setup-profile) and `CONTEXT.md` (`setup-profile`, `profile`, `launch`). ADR-0002
> explains why the human does the one-time login and we never bypass login or
> solve CAPTCHAs.
>
> This depends on `playwright-launch-transport-and-profile` and reuses its
> persistent profile + launch transport — implement on top of it (same module
> area, hence serialized after it).
>
> SCOPE: build and test only the automatable mechanics — headed open against the
> correct profile dir, the clear user prompt, and state persistence — against the
> local fixture page with the profile root isolated to a temp dir. The verb merely
> opens the visible browser WINDOW; the human's real login (typing credentials,
> clearing a challenge) happens at runtime and is proven only in the manual Kayak
> smoke (owned by `docs-tos-humility-and-kayak-smoke`), which is NOT a CI gate. Do
> not automate or assert a real third-party login here, and do not handle or store
> any credential in the build.
>
> "Done" = `setup-profile` opens the right profile headed with a clear prompt,
> session state persists for a later headless launch, mechanics tested against the
> fixture with the profile root isolated.
>
> FIRST, check this task against current reality — confirm the launch transport
> landed as assumed. RECORD non-obvious in-scope decisions.
