# Phase 2 opens the hand-host to THIRD-PARTY hands: a PUBLIC `Hand`/`HandContext` contract + EXPLICIT, DECLARATIVE (pi-style) loading; loading a hand == trusting an in-process npm dependency

Phase 1 (ADR-0006) refactored webhands' own verbs onto an INTERNAL hand-host and deliberately kept `Hand`/`HandContext` package-internal, deferring the public-contract decision to Phase 2. This ADR makes that decision: `Hand`, `HandContext`, and `HandContribution` are now EXPORTED from the package entry point (`packages/core/src/index.ts`) as the stable third-party authoring contract (a hand receives `{pwPage, context, ensureOpen}` and contributes named verbs plus an optional `dispose`), and a third-party hand is loaded ONLY when explicitly NAMED in config with a PINNED entry point. A loaded hand plugs into the SAME host the built-ins use (`composeWithHands` composes `[...BUILT_IN_HANDS, ...loadedHands]` through the exact `composePage` the built-ins use), so its verbs compose into the session `Page` alongside the built-ins.

## Status

accepted (Phase 2 of the "hands" prd; the public-contract follow-on to ADR-0006, which it does not contradict)

## Trust framing: loading a hand == trusting an in-process npm dependency

A hand is arbitrary Node code running IN the webhands process. That is a strictly LARGER surface than the `eval` verb: `eval` is sandboxed to the page's JS world (`page.evaluate`, structurally cloned out by value, a DOM node never crosses the process boundary), whereas a hand holds the live Node-side Playwright `Page`/`BrowserContext` and the full Node runtime. The right mental model is therefore **npm supply-chain trust: loading a hand is trusting an in-process dependency**, no different in kind from adding a dependency to `package.json`. There is NO sandbox, NO permission wall, and ZERO isolation between hands (one live page, one process), exactly as ADR-0006 recorded for the built-ins.

Because of that, the trust act is made EXPLICIT and DECLARATIVE, and the boundary stays **local-only**: hands widen the IN-PROCESS surface, not the remote one. Loading a hand adds NO network listener and does not change what the remote/served seam exposes (ADR-0005's served session still hands out only verbs + locator strings). Docs state this trust level plainly so an operator names a hand with the same care they would `npm install` a dependency.

## The loading model (borrowed SHAPE from pi, NOT pi's installer)

Modeled on pi's `settings.json` `packages[]` (an explicit named list of sources, each optionally with pinned entry files, with trust kept separate from install). We borrow the SHAPE, not the machinery:

- **Explicit named list.** Hands are declared in `<home>/hands.json` as `{ hands: [{ name, source?, entry }] }`. `name` is the operator's identifier; `source` is descriptive provenance (`npm:…` / `git:…`) that is RECORDED, not acted on; `entry` is the PINNED module file webhands will `import()`.
- **Pinned entry, no inference.** There is NO convention-inferred entry, NO `package.json` `main` lookup, NO directory scan, NO `node_modules` auto-discovery. The operator pins the exact file. A relative `entry` resolves against the config's own directory; an absolute path is used as-is; a bare specifier (an already-installed package name) is passed through to `import()` verbatim.
- **NAMING is the trust act; install is SEPARATE.** `npm install <hand>` alone NEVER auto-loads a hand — an installed-but-not-named hand does not load. The operator installs the dependency THEMSELVES; webhands does NOT build a managed installer (pi's `npm/` workspace equivalent is explicitly out of scope).
- **Named hands fail LOUD.** A named hand whose pinned entry is missing, fails to import, or does not export a `Hand` (default export or a named `hand` export) raises a typed `HandLoadError` rather than being silently skipped, so a typo or a half-removed dependency surfaces immediately instead of silently dropping a capability the operator explicitly trusted. A MISSING config file, by contrast, yields an EMPTY config (load nothing) — the safe install-separate-from-load default.

## Why explicit + declarative (the rejected alternatives)

- **Auto-discovery / `node_modules` scan** — REJECTED. It would make merely INSTALLING a package (or a transitive dependency pulling one in) silently load in-process code, which is precisely the supply-chain footgun the trust framing exists to prevent. Trust must be an explicit operator act, not a side effect of `npm install`.
- **Convention-inferred entry (`main`/index)** — REJECTED. Pinning the exact entry keeps the loaded code unambiguous and auditable; an inferred entry could change under the operator (e.g. a dependency bump moving `main`) without a config change.
- **A managed installer** — OUT of scope (prd). webhands records WHAT to load and trusts it; obtaining the bits is the operator's job, which keeps webhands out of the package-management business and the trust record cleanly separate from install state.

## Consequences

- `Hand`/`HandContext`/`HandContribution` are now COMMITTED public surface; changing their shape is a breaking change. This is the contract Phase 1 deliberately avoided freezing, frozen now.
- Both Playwright transports take an optional `hands` argument (the loaded hands) and compose them via `composeWithHands`. Because later contributions win the merge, a third-party hand CAN override a built-in verb; that is the operator's choice, made by the trust act of naming it. The transport does NOT discover hands itself — it is handed the already-loaded list, keeping discovery/trust in one explicit place.
- The loading paths (`readHandsConfig`, `loadHands`) are pure/injectable (a `baseDir` and an `importModule` hook) so tests exercise the real ones against a temp config without touching the real `~/.webhands`.
- Hands are still offered ONLY by a transport that can hand over live page access (the Playwright transport), and stay cross-browser (no CDP/Chromium-only types in the host), exactly as ADR-0003/0006 require.
