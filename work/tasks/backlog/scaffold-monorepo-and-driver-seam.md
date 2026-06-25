---
title: Scaffold the pnpm monorepo and the core Driver/Transport seam
slug: scaffold-monorepo-and-driver-seam
prd: browser-controller-cli
blockedBy: []
covers: [15, 16]
---

## What to build

The foundation every other task builds on: a pnpm-workspace TypeScript monorepo
(scaffolded from the house `template-typescript-lib` conventions) with two
packages, `core` and `cli`, plus the **verb-level `Driver`/`Transport` seam** in
`core` and a deterministic local-fixture test harness.

`core` defines the transport-neutral interface in terms of high-level verbs
(`open` → `Session`, and a `Page` abstraction with `navigate`, `snapshot`,
`click`, `type`, `eval`, `wait`, `cookies`) — NOT in terms of CDP or Playwright
primitives (see `docs/adr/0003`). Element addressing in the interface is a **raw
Playwright locator string** the active transport resolves (see `docs/adr/0004`);
"transport-neutral" means Playwright-equivalent addressing, not a reduced subset.
The seam's public types must not leak CDP/Chromium-only types.

In this task the verbs may be defined as the interface plus a trivial/stub
in-process implementation enough to compile, build, and unit-test the seam shape;
the real Playwright transport and each verb's behaviour land in their own tasks.
Also stand up the local-fixture page server (a static HTML page served from the
test harness) that the verb-behaviour tasks will drive a real browser against, so
those tests are deterministic and never hit a third-party site.

This is a thin vertical slice: workspace builds, the `Driver` interface type-checks,
a stub session round-trips through the seam, and the fixture harness serves a page
in a test.

## Acceptance criteria

- [ ] `pnpm install && pnpm build && pnpm test && pnpm format:check` all pass at the workspace root (the repo `verify` floor).
- [ ] Two workspace packages exist: `core` and `cli` (ESM, `tsc` build, `vitest`, `prettier`, tabs indentation, changesets, `ldenv`), per the house template conventions.
- [ ] `core` exports a `Driver`/`Transport` interface expressed in verbs (`open`/`Session`/`Page` with navigate, snapshot, click, type, eval, wait, cookies); its public types do NOT reference CDP or Chromium-only types (ADR-0003).
- [ ] Element-addressing parameters in the interface are typed as a raw Playwright locator string (ADR-0004), not a reduced selector subset or a structured JSON locator.
- [ ] A local test-fixture HTTP server (serving a controlled static page) is available to the test suite for later deterministic verb tests.
- [ ] A unit test exercises the seam shape (a stub transport round-trips an `open`→`Session` and a no-op verb) at the `core` `Driver` interface.
- [ ] A changeset is added for the new packages.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- None — can start immediately.

## Prompt

> Goal: lay the monorepo foundation and the transport seam that the whole project
> hangs off. Read the prd `work/prds/ready/browser-controller-cli.md` (Solution,
> Implementation Decisions) and ADRs `0003` (seam not CDP-coupled) and `0004`
> (verb surface exposes Playwright-equivalent locator semantics) before starting —
> they are load-bearing for the interface shape. Read `CONTEXT.md` for the domain
> glossary (controller, driver/transport, profile, verb).
>
> The reference scaffold is the same-account `template-typescript-lib`
> (pnpm workspace, ESM, tsc, vitest, prettier, changesets, ldenv, tabs). The
> same-account `playwright-browser-harness` is a packaging-conventions reference
> ONLY — NOT a dependency or design base (per the maintainer).
>
> Domain vocabulary: `core` = browser-control logic + the seam; `cli` = the
> `incur` wrapper (built in a later task). The `Driver`/`Transport` interface is
> the HIGHEST TEST SEAM (prd Testing Decisions) and the internal structure
> boundary — define it in verbs, keep CDP/Playwright types out of its public
> surface, and address elements with a raw Playwright locator string.
>
> "Done" = the workspace builds and tests green, the seam interface type-checks
> with the verb operations declared, a stub transport round-trips through it in a
> unit test, and a local fixture-page server exists for later deterministic verb
> tests. Do NOT implement the real Playwright transport or real verb behaviour
> here — those are separate tasks that depend on this one.
>
> FIRST, check this task against current reality — it is a launch snapshot. If the
> repo already has packages or a different scaffold than assumed, reconcile rather
> than duplicate. RECORD any non-obvious in-scope decision (e.g. the exact session
> lifetime of the stub) per the task-template guidance.
