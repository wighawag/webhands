---
title: Open the host to third-party hands — public API + explicit declarative loading (Phase 2)
slug: third-party-hand-loading-and-public-api
prd: hands-pluggable-page-capabilities
blockedBy: [hand-host-primitive-and-builtin-hands]
covers: [1, 3]
---

## What to build

Phase 2 core: open the hand-host to THIRD-PARTY hands. Two coupled pieces:

1. **Public hand API.** Make `Hand` / `HandContext` (kept package-internal in
   Phase 1) PUBLIC, exported from the package entry point, so an external module
   can author a hand against a stable contract: receive `{pwPage, context,
   ensureOpen}`, contribute named verbs + optional `dispose`. This is the
   public-CONTRACT change Phase 1 deliberately deferred.

2. **Explicit, declarative loading (pi-style).** A third-party hand is loaded
   ONLY because it is explicitly NAMED in webhands config — modeled on pi's
   `packages[]`: a config-named list of hand sources (`npm:<pkg>` / `git:<url>`)
   each with a PINNED entry point. NEVER auto-discovery, NEVER a `node_modules`
   scan, NEVER a convention-inferred entry file. Install is SEPARATE from
   load/trust: naming a hand in config IS the trust act; `npm install` alone
   never auto-loads. webhands does NOT build a managed installer (pi's `npm/`
   workspace equivalent) — operators install the dependency themselves; a
   managed install/update mechanism is out of scope.

End-to-end path: an operator names a hand in config → webhands loads exactly the
pinned entry → the hand plugs into the SAME host the built-in hands use → its
contributed verbs compose into the session's `Page` alongside the built-ins.

Because this is the public-contract change, it carries its OWN ADR (the
public-API decision the Phase-1 internal ADR explicitly left to Phase 2).

## Acceptance criteria

- [ ] `Hand` / `HandContext` are exported from the package entry point as the
      stable third-party authoring contract (receive `{pwPage, context,
      ensureOpen}`; contribute named verbs + optional `dispose`).
- [ ] A third-party hand loaded through the public API plugs into the SAME host
      the built-in hands use and its verbs compose into the session `Page`
      (proven by a test hand that contributes a verb and is invoked).
- [ ] Loading is EXPLICIT + DECLARATIVE: a hand loads only when named in config
      with a pinned entry point; there is NO directory scan / auto-discovery /
      convention-inferred entry. A hand that is installed but NOT named does not
      load.
- [ ] Install is separate from load/trust (naming in config is the trust act).
- [ ] A public-contract ADR is added (`docs/adr/`, next number) recording the
      decision to open the host, the explicit-declarative loading model, and the
      "loading a hand == trusting an in-process npm dependency" trust framing;
      docs state the trust level plainly.
- [ ] Tests cover the new behaviour: a fixture/test hand is authored against the
      public `Hand` contract, loaded via the explicit mechanism, and its verb
      verified; a NOT-named installed hand is verified to not load.
- [ ] A changeset is added (`pnpm changeset`) per the repo convention.
- [ ] Shared-write isolation: tests that touch config/loading paths point them
      at a temp/scratch location and assert the real ones are untouched.

## Blocked by

- `hand-host-primitive-and-builtin-hands` — this exposes and opens the host that
  task builds; it also makes the `Hand`/`HandContext` types (package-internal
  there) public.

## Prompt

> Goal: open the Phase-1 internal hand-host to THIRD-PARTY hands by making the
> `Hand`/`HandContext` contract public and adding an explicit, declarative,
> pi-style loading mechanism. This is Phase 2 of the "hands" prd
> (`work/prds/tasked/hands-pluggable-page-capabilities.md`).
>
> FIRST, check against reality: read the landed
> `hand-host-primitive-and-builtin-hands` work — the internal hand-host and the
> internal `Hand`/`HandContext` shape are what you are making public. Confirm the
> package entry point (`packages/core/src/index.ts`) is the public-export
> surface and that `Hand`/`HandContext` are currently NOT exported there. If the
> internal shape landed differently than this task assumes, route to
> needs-attention rather than guessing.
>
> Domain vocabulary: a **hand** is a capability module closing over the Page
> (`{pwPage, context, ensureOpen}`) contributing verbs + optional `dispose`;
> hands are offered only by a transport that can hand over live page access (the
> Playwright transport). Loading inspiration is pi's module model: pi declares
> packages explicitly in `settings.json`'s `packages[]` (each a named
> `npm:`/`git:` source, optionally with pinned entry files), and keeps a
> SEPARATE trust record from install — borrow that SHAPE (explicit named list +
> pinned entry + install-separate-from-trust), NOT pi's managed installer.
>
> Security framing (prd's resolved Q5): a hand is arbitrary Node code in the
> webhands process — a strictly larger surface than `eval` (which is sandboxed
> to the page's JS world). The right mental model is npm supply-chain trust:
> loading a hand == trusting an in-process npm dependency. The trust boundary
> stays local-only (hands widen the IN-PROCESS surface, not the remote one — no
> new network listener). NEVER add auto-discovery / a `node_modules` scan.
>
> What "done" means: `Hand`/`HandContext` are public; a test hand authored
> against that contract loads via the explicit config-named + pinned-entry
> mechanism and its verb composes into the session `Page`; an installed-but-not-
> named hand does NOT load; a public-contract ADR records the decision and trust
> framing; a changeset is added. Test loading paths in isolation (temp config),
> asserting the real ones are untouched.
>
> RECORD non-obvious in-scope decisions (the exact config key/shape for the hand
> list, how a pinned entry is resolved, error behavior for a missing/ bad
> entry). The durable public-API + trust WHY belongs in the ADR you add here.
