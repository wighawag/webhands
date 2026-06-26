---
title: ADR for the Phase-1 hand-host internal structure + pin `hand` in CONTEXT.md
slug: phase1-internal-structure-adr
prd: hands-pluggable-page-capabilities
blockedBy: [hand-host-primitive-and-builtin-hands]
covers: []
---

## What to build

The lightweight internal-structure ADR recording the Phase-1 decision (prd's
resolved Q2 + Q4 + Q1 trust model), and the glossary pin of `hand` into
`CONTEXT.md` (which the prd says happens ONLY when tasked).

Two deliverables:

1. **ADR** (`docs/adr/0006-*.md`, format per `work/protocol/ADR-FORMAT.md`):
   records that webhands' own verbs are refactored onto an INTERNAL hand-host
   primitive as a behavior-preserving, public-surface-unchanged Phase-1 step;
   that `Hand`/`HandContext` are package-internal in Phase 1 and only go public
   in Phase 2; that hands are trusted, local, in-process peers with ZERO
   isolation; and that this REFINES ADR-0003/0004 (the live `pwPage` stays
   in-process, never crosses the seam, so the no-CDP-leak rule is preserved).
   The public-CONTRACT ADR is a Phase-2 concern (the
   `third-party-hand-loading-and-public-api` task), not this one — this ADR is
   the INTERNAL-structure record only.

2. **CONTEXT.md glossary pin**: add `hand` to the domain glossary as a third,
   orthogonal axis beside `transport`/`driver` and `verb`, with the explicit
   coherence guards "a hand is NOT a verb" and "a hand is NOT a transport".

## Acceptance criteria

- [ ] A new ADR exists under `docs/adr/` (next number, `0006`), following
      `ADR-FORMAT.md`, recording the Phase-1 internal-structure decision and its
      refinement (not contradiction) of ADR-0003/0004.
- [ ] `CONTEXT.md` defines `hand` as a capability MODULE closing over the Page
      (`{pwPage, context, ensureOpen}`) contributing verbs + optional `dispose`,
      stated as orthogonal to `transport`/`verb`, with the "not a verb / not a
      transport" guards and the "offered only by a transport that can hand over
      live page access (Playwright)" note.
- [ ] The ADR records the stated trust model (zero isolation; trusted/local/
      in-process) and that `Hand`/`HandContext` are package-internal until Phase
      2.
- [ ] A changeset is added (`pnpm changeset`) per the repo convention.

## Blocked by

- `hand-host-primitive-and-builtin-hands` — the ADR records the structure that
  task actually lands, and both touch `docs/adr` / `CONTEXT.md` narrative, so
  they are serialized to avoid building the record on an unbuilt shape and to
  avoid a merge conflict.

## Prompt

> Goal: write the lightweight internal-structure ADR for Phase 1 of the "hands"
> prd, and pin the `hand` term into `CONTEXT.md`'s glossary. This is a
> docs/decision task, NOT code.
>
> FIRST, check against reality: read the landed
> `hand-host-primitive-and-builtin-hands` work (the internal hand-host + built-in
> hands) so the ADR describes what ACTUALLY shipped, not the prd's pre-build
> intent. Read `work/prds/tasked/hands-pluggable-page-capabilities.md`
> (Implementation Decisions), `docs/adr/0003-*` and `docs/adr/0004-*` (this ADR
> REFINES them), and `work/protocol/ADR-FORMAT.md`.
>
> Content of the ADR (number `0006`): Phase 1 refactors webhands' own verbs onto
> an INTERNAL hand-host primitive; it is behavior-preserving with no public-seam
> change (existing verb tests green unmodified); `Hand`/`HandContext` are
> package-internal in Phase 1, public only in Phase 2; hands are trusted, local,
> in-process peers with ZERO isolation between them; this REFINES ADR-0003/0004
> rather than contradicting them — the live Playwright page stays in-process
> inside the hand and never crosses the seam, so the no-CDP-leak rule holds. Be
> explicit that the PUBLIC-CONTRACT ADR (opening the host to third parties) is a
> separate Phase-2 decision, not this one.
>
> CONTEXT.md: add `hand` to "Core domain terms" as the third orthogonal axis
> (transport = HOW we reach the browser; verb = one agent-facing action; hand =
> a capability module closing over the Page). Include the guards "a hand is NOT a
> verb" and "a hand is NOT a transport (it does not `open` sessions; it gets the
> live Playwright page directly)". Note hands are offered only by a transport
> that can hand over live page access (the Playwright transport).
>
> What "done" means: ADR-0006 exists and is internally consistent with
> ADR-0003/0004; CONTEXT.md carries the `hand` definition with its guards; a
> changeset is added.
