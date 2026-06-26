# Phase 1 refactors webhands' verbs onto an INTERNAL hand-host primitive (refines ADR-0003/0004); the public hand contract is a separate Phase-2 decision

webhands' own eight verbs (`navigate`, `snapshot`, `click`, `type`, `eval`, `wait`, `cookies`, `setCookies`) are refactored onto an internal **hand-host primitive** (`packages/core/src/hand-host.ts`): each verb is now a built-in **hand** (in-process code that closes over the live Playwright page and contributes named verbs) composed by the host into the same seam `Page` the transports already returned. This is a behavior-preserving Phase-1 step with NO public-seam change: `seam.ts` is byte-for-byte unchanged and `index.ts` exports no new types, so the existing verb test suite passes WITHOUT modification (that green suite IS the behavior-preservation proof). We chose to prove the primitive by self-application first because if the host can express webhands' own `click`/`snapshot`/`cookies`, it can host a third-party hand the same way later, and doing it internally lets us land the structure with zero new public surface to commit to prematurely. This **refines ADR-0003/0004, it does not contradict them:** the live Playwright `pwPage` stays in-process inside the hand and never crosses the seam, so ADR-0003's no-CDP/Chromium-only-leak rule and ADR-0004's Playwright-locator semantics both stand unchanged.

## Status

accepted

## Scope: this ADR is the INTERNAL-structure record only

This decision is exactly the Phase-1 internal refactor. Opening the host to third-party hands (the public **hand contract** that turns `Hand`/`HandContext` into a committed, externally-implementable surface) is a SEPARATE Phase-2 decision recorded by its own ADR alongside the `third-party-hand-loading-and-public-api` task. Nothing here commits webhands to that public contract; the only thing decided here is the internal shape and that it is behavior-preserving.

## What a hand is (and what it is not)

- A **hand** receives a scoped-but-LIVE `HandContext` = `{pwPage, context, ensureOpen}` (the live Node-side Playwright `Page`, the live `BrowserContext`, and the per-session lifecycle guard) and returns a contribution of named verbs plus an optional `dispose`. Nothing more: no lifecycle hooks, no event handlers, no MCP-definition objects.
- A hand is **NOT a verb**: a single hand may contribute several verbs (the built-in interaction hand contributes both `click` and `type`) plus in-process logic.
- A hand is **NOT a transport**: it does not `open` sessions. Session lifecycle stays the transport's job.
- The host (`composePage` / `composeBuiltInPage`) is the SINGLE shared verb composition both Playwright transports call, replacing the duplicated page-object literal that previously lived in each. Only the verb composition is shared; each transport keeps its own session lifecycle (launch kills the browser it spawned via `context.close()`; attach detaches without killing the user's browser via `browser.close()`, per ADR-0002).

## Trust model

Hands are **trusted, local, in-process peers with ZERO isolation between them**: one live page, one process, no sandbox or permission wall around a hand. Inter-hand reuse is ordinary Node composition (import and call), NOT a sibling-hand registry handed through the context, so `HandContext` carries live page access only. This is acceptable in Phase 1 because the only hands are webhands' own built-ins; the trust assumption is recorded here precisely so the Phase-2 public-contract decision must confront it before any untrusted third-party hand loads.

## Encapsulation: `Hand`/`HandContext` stay package-internal until Phase 2

The `Hand`, `HandContext`, and the host functions are **package-internal in Phase 1** (not exported from `index.ts`). They become public surface only in Phase 2, as part of the separate public-contract decision. Keeping them internal now means the Phase-1 refactor commits to no external API and can evolve the host shape freely before it is frozen.

## Consequences

- The hand-host is built INSIDE the Playwright transport(s) and uses only the Playwright `Page`/`BrowserContext` API (no CDP/Chromium-only types), so the cross-browser invariant (ADR-0003) holds by construction and the host introduces no Chromium-only dependency that would foreclose a future Firefox launch. Only CDP-`attach` stays Chromium-bound, exactly as before.
- `dispose` is sequenced by the host (hands torn down LIFO, every disposer awaited even if one rejects) and is distinct from the transport's browser/context teardown; the built-in hands hold no resources, so today's `dispose` is effectively a no-op, present so Phase-2 resource-holding hands can be sequenced before the per-transport session teardown.
- The public hand contract (third-party loading, exported `Hand`/`HandContext`, the security/loading model for untrusted hands) is explicitly OUT of this ADR and owned by the Phase-2 ADR.
