---
title: ToS humility docs, manual Kayak smoke, capture deferred extension transport
slug: docs-tos-humility-and-kayak-smoke
prd: browser-controller-cli
blockedBy: [cross-invocation-session-persistence]
covers: [18, 19]
---

## What to build

The honesty-and-proof closer for v1:

- A documented **humility note** (README / docs) that driving sites like Kayak /
  Skyscanner can violate their ToS and that scope is personal use of one's OWN
  authenticated session on one's OWN machine and IP (per ADR-0002). Honest about
  what the tool is for and is not for.
- A **manual smoke** script/doc running the whole pipe end-to-end against Kayak:
  `setup-profile` → `launch --headless` → `goto` a search → `snapshot` the results.
  It is LIVE and FLAKY by nature — explicitly NOT a CI gate, documented as a manual
  proof of the end-to-end pipe (per prd Testing Decisions). Kayak is the smoke-test
  TARGET, not a hardcoded feature.
- Capture the **deferred browser-extension transport** as a `work/notes/ideas/`
  item (the prd's Out of Scope says to capture it once tasked) so the phase-2
  stealth path is not lost.

A thin vertical slice: the docs land, the manual smoke is runnable and documented
as non-CI, and the deferred-transport idea is captured.

## Acceptance criteria

- [ ] A humility/ToS note is documented (README/docs): personal use, own session/machine/IP, against these sites' ToS, no login-bypass / CAPTCHA-solving (story 18, ADR-0002).
- [ ] A manual Kayak smoke (setup-profile → launch headless → goto search → snapshot results) is runnable and DOCUMENTED AS NON-CI / manual (story 19) — it does not run in the `verify` gate and does not assert on live third-party DOM in automated tests.
- [ ] The deferred browser-extension transport is captured as a `work/notes/ideas/` item (per prd Out of Scope).
- [ ] No automated test added by this task depends on a live third-party site.
- [ ] A changeset is added if shipped code/docs warrant it.
- [ ] Tests cover any added behaviour (mirror the repo's existing test style); doc-only portions need no test.

## Blocked by

- `cross-invocation-session-persistence` (the whole pipe — setup-profile → launch → goto → snapshot across invocations — must work for a real end-to-end smoke).

## Prompt

> Goal: land the ToS humility docs, a manual (non-CI) Kayak smoke proving the
> end-to-end pipe, and capture the deferred extension transport as an idea. Read the
> prd `work/prds/ready/browser-controller-cli.md` (User Stories 18 and 19; Testing
> Decisions — manual smoke is not a gate, avoid asserting on real third-party DOM;
> Out of Scope — capture the extension transport once tasked) and ADR-0002 (real
> session, personal use, never bypass login / solve CAPTCHAs). Read `CONTEXT.md`
> (`extension transport (deferred)`).
>
> Depends on `cross-invocation-session-persistence`: the full pipe (setup-profile →
> launch headless → goto → snapshot across separate CLI invocations) must work for
> the smoke to be a real proof.
>
> The Kayak smoke is LIVE and FLAKY — keep it OUT of the `verify`/CI gate, document
> it as a manual proof, and do NOT add automated tests that hit a live third-party
> site or assert on its DOM (it rots). Kayak is the smoke TARGET, not a feature.
>
> Capture the browser-extension transport (Chrome/Firefox content-script bridge,
> the phase-2 stealth path) as a `work/notes/ideas/` item per the work/ contract so
> it survives tasking.
>
> "Done" = humility/ToS note documented, runnable non-CI Kayak smoke documented, and
> the deferred extension transport captured as an idea.
>
> FIRST, check this task against current reality — confirm the pipe is wired as the
> dependencies assume; if the session mechanism or verbs landed differently,
> reconcile the smoke steps. RECORD non-obvious in-scope decisions.
