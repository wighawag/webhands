---
title: Hand-host primitive + webhands' own verbs as built-in hands (Phase 1, internal)
slug: hand-host-primitive-and-builtin-hands
prd: hands-pluggable-page-capabilities
blockedBy: []
covers: [2]
---

## What to build

Introduce the internal **hand-host primitive** and refactor webhands' OWN verbs
(`navigate`, `snapshot`, `click`, `type`, `eval`, `wait`, `cookies`,
`setCookies`) into **built-in hands** composed over it. This is Phase 1: a
purely INTERNAL, behavior-preserving refactor that proves the primitive by
self-application.

A **hand** is in-process code that closes over the Page and contributes named
verbs (+ an optional `dispose`). The host hands a hand a scoped-but-LIVE
hand-context shaped like `{pwPage, context, ensureOpen}` — the real Playwright
`Page` and `BrowserContext` (the `cookies`/`setCookies` built-ins prove the
context is needed), plus the lifecycle guard `ensureOpen()`. The host composes
the hands' contributed verbs into the same `Page` object the seam already
exposes. Built-in hands compose EAGERLY at session-open time (exactly as the
page object literal is built today — no lazy registration, so no ordering
effects).

The end-to-end path: a session opens → the host builds the hand-context from the
live Playwright objects → built-in hands contribute their verbs → the composed
`Page` is returned, behaving byte-for-byte as today.

Scope note (drift / honest unification): there are currently TWO near-identical
`makeSession` implementations with duplicated page-object literals — one in the
launch transport and one in the attach transport (the shared
`clickLocator`/`resolveLocator`/`waitFor` helpers are the existing precedent for
extracted building blocks). The hand-host MUST be the SINGLE shared composition
both transports use, eliminating the duplicated page-object literal. Do not
leave two divergent hand-hosts.

UNIFICATION BOUNDARY (do NOT over-unify): share ONLY the VERB composition (the
eight-verb page object built from the built-in hands). The SESSION LIFECYCLE is
legitimately DIFFERENT between the two transports and must stay per-transport:
the launch transport listens on `context.on('close')` and its `close()` calls
`context.close()` (which KILLS the browser it spawned); the attach transport
listens on `browser.on('disconnected')` and its `close()` calls
`browser.close()` which DETACHES without killing the user's browser (ADR-0002),
and derives its context via `pwPage.context()`. Collapsing these into one
lifecycle would break attach's detach-not-kill guarantee. So: shared verb host,
per-transport session/close/closed-signal wiring.

Internal-only boundary (the gate from the prd's resolved Q2):
- NO change to the public seam (`Page`/`Transport`/`Session` types stay
  byte-for-byte identical).
- The `Hand` / `HandContext` types and the host are PACKAGE-INTERNAL — NOT
  exported from the package entry point in this task (they go public in Phase 2,
  a separate task).
- NO behavior change — proven by the existing verb test suite staying green
  WITHOUT modification.

## Acceptance criteria

- [ ] A `Hand` / `HandContext` abstraction exists internally: a hand receives
      `{pwPage, context, ensureOpen}` and contributes named verbs + optional
      `dispose`; nothing more (no lifecycle hooks, no event handlers, no
      MCP-definition objects).
- [ ] All eight built-in verbs are expressed as built-in hand(s) over the host
      and composed into the returned `Page`.
- [ ] The host is the SINGLE shared composition used by BOTH the launch and
      attach transports; the duplicated page-object literal is gone (one place,
      no parallel second implementation).
- [ ] The public seam (`seam.ts`) is UNCHANGED; the package entry point
      (`index.ts`) exports NO new hand types (host + `Hand`/`HandContext` stay
      package-internal).
- [ ] The existing verb test suite (`click-type-verbs`, `snapshot-verb`,
      `eval-verb`, `goto-wait-verbs`, `cookies-export-import`,
      `cross-invocation-session-persistence`, `seam`, both transport tests)
      passes WITHOUT modification — behavior is preserved.
- [ ] Only the VERB composition is shared between the two transports; each
      transport keeps its own session lifecycle (launch: `context.on('close')` /
      `context.close()` kills the browser; attach: `browser.on('disconnected')` /
      `browser.close()` detaches without killing it, ADR-0002). The shared host
      does NOT collapse these.
- [ ] Cross-browser invariant honored BY CONSTRUCTION (prd stories 7, 8): the
      hand-host is built INSIDE the Playwright transport(s) and uses only the
      Playwright `Page`/`BrowserContext` API (no CDP/Chromium-only types), keeping
      the live `pwPage` in-process (never crossing the seam). Note: the launch
      transport hard-codes `chromium.launchPersistentContext` and there is NO
      Firefox harness in the repo today (Firefox is designed-for but not built —
      ADR-0003 / CONTEXT.md), so do NOT add a Firefox test; instead the host must
      not introduce any Chromium-only dependency that would foreclose a future
      Firefox launch, and only CDP-`attach` stays Chromium-bound. (Verify via
      code review of the host's types, not a new browser engine in tests.)
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): the
      built-in-hands path is exercised at the same `Driver`/`Transport` seam the
      existing verb tests use; no new public surface is tested (there is none).
- [ ] A changeset is added (`pnpm changeset`) per the repo convention
      (CONTEXT.md "Conventions").
- [ ] Shared-write isolation: any test that opens a session points its profile
      root at a per-test temp dir and never touches the real `~/.webhands`
      (mirrors the existing verb tests).

## Blocked by

- None — can start immediately.

## Prompt

> Goal: introduce an internal hand-host primitive in `@webhands/core` and
> refactor webhands' own verbs into built-in hands over it, with ZERO change to
> the public seam and ZERO behavior change. This is Phase 1 of the "hands" prd
> (`work/prds/proposed/hands-pluggable-page-capabilities.md` → moved to
> `work/prds/tasked/`): proof-by-self-application before any third-party hand.
>
> FIRST, check this task against current reality (it is a launch snapshot and
> may have DRIFTED). Confirm: (1) the public seam is `packages/core/src/seam.ts`
> (`Page`, `Transport`/`Driver`, `Session`); (2) the verb implementations live
> as a `page` object literal inside `makeSession` in BOTH
> `packages/core/src/playwright-launch-transport.ts` AND
> `packages/core/src/playwright-attach-transport.ts` (two near-identical copies);
> (3) `clickLocator` / `resolveLocator` / `waitFor` are already exported shared
> helpers used by both. If any of that has changed, route to needs-attention
> with the discrepancy rather than building on the stale premise.
>
> Domain vocabulary (CONTEXT.md): a **transport/driver** is HOW we reach the
> browser; a **verb** is one agent-facing page action; a **hand** is a
> capability MODULE that closes over the Page and contributes verbs. These are
> orthogonal — a hand is NOT a transport (it does not `open` sessions) and NOT a
> single verb (it can contribute several + in-process logic). See ADR-0003
> (no-CDP-leak) and ADR-0004 (Playwright locator semantics) — both STAND and are
> only refined: the live `pwPage` stays IN-PROCESS inside the hand and never
> crosses the seam, so the no-leak rule is preserved.
>
> What "done" means: the hand-host is the single shared composition both
> transports use; the eight verbs are built-in hands; the existing verb test
> suite is green WITHOUT modification (this is the behavior-preservation proof);
> `seam.ts` and `index.ts`'s public exports are unchanged (the `Hand` /
> `HandContext` types stay package-internal — they only go public in the Phase 2
> task `third-party-hand-loading-and-public-api`). Test at the
> `Driver`/`Transport` seam, real browser + local fixture, isolated temp
> profiles, exactly as `packages/core/test/click-type-verbs.test.ts` does. Add a
> changeset.
>
> The trust model is stated, not built here: hands are trusted, local,
> in-process peers with ZERO isolation between them (one live page, one process).
> Inter-hand reuse is ordinary Node composition (import & call), NOT a
> sibling-hand registry in the context — so the hand-context carries live page
> access only.
>
> RECORD non-obvious in-scope decisions (the host's exact shape, how `dispose`
> is sequenced, how the two transports share it). The durable WHY of "Phase 1 is
> an internal refactor onto the hand-host" is captured by the SEPARATE task
> `phase1-internal-structure-adr` (do not write that ADR here); note any smaller
> choices in the done record.
