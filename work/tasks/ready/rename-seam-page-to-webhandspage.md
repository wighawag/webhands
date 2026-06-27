---
title: Rename the seam `Page` type to `WebHandsPage` and drop the `PwPage` aliases
slug: rename-seam-page-to-webhandspage
prd: rename-seam-page-to-webhandspage
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
---

## What to build

A single, behaviour-preserving, name-only rename of webhands' verb-level seam
type `Page` → `WebHandsPage` throughout `packages/core`, plus the cleanup the
rename unlocks. The seam type is webhands' own small 8-verb transport-neutral
abstraction (`navigate`/`snapshot`/`click`/`type`/`eval`/`wait`/`cookies`/`setCookies`,
branded-locator-string addressing, no Playwright/CDP types across it). It is NOT
Playwright's `Page`; the name collision currently forces `type Page as PwPage`
aliases and has actively misled readers (`HandContribution.verbs: Partial<Page>`
was misread as a partial of Playwright's huge `Page`).

The end-to-end change is one atomic, compile-green vertical:

- Rename the seam TYPE **`Page` → `WebHandsPage`** at its definition and every
  reference that means THE SEAM TYPE, across `core` source AND the `core` tests
  (the test files import and use `type Page` from the package). The runtime
  values, the verb names, and the verb count are unchanged.
- **Rename the TYPE only — NOT runtime value/function identifiers that merely
  contain the word "Page".** Functions like `composePage`, `composeBuiltInPage`,
  `assertCompletePage`, the test helper `fakePageWithHandVerb`, and especially
  the EXPORTED `makeRpcPage` are VALUE names, not the seam type — they stay
  exactly as-is. Renaming them would be out-of-scope churn, and renaming the
  exported `makeRpcPage` would be a second, unintended breaking change. This
  task changes ONE identifier's name: the seam type.
- **Drop the `type Page as PwPage` aliases.** With the seam type no longer
  claiming the name `Page`, the three alias sites import Playwright's `Page`
  directly (plain `type Page` from `playwright`). The `PwPage` references in
  those modules become plain `Page` (Playwright's).
- **`HandContext.pwPage` keeps its field NAME** (`pwPage`); only its TYPE
  annotation changes from `PwPage` to plain Playwright `Page`.
- **Re-point `{@link Page}` JSDoc references by what they MEAN**: a link that
  meant the seam type becomes `{@link WebHandsPage}`; a link/comment that
  legitimately meant Playwright's page stays `Page` (Playwright's).
- **Export `WebHandsPage`** from the package entry point in place of `Page`.
- **Update the `CONTEXT.md` glossary** so its prose stops using a bare "Page"
  for the seam. The `hand` entry currently says "closes over the Page" (seam)
  on the same line as "the live Playwright `Page`" (Playwright) — the exact
  collision this rename kills. Change the seam-meaning occurrences to
  `WebHandsPage` (keep the Playwright-meaning `Page` as-is) so a reader can
  always tell the two apart and the next author cannot re-fork the name.
- Add a **`pnpm changeset`** recording this as a BREAKING change to the exported
  type name (the exported `Page` type becomes `WebHandsPage`) — one **major**
  bump for `@webhands/core`.
- Add an **ADR** in `docs/adr/` (next sequential number) recording WHY the seam
  type was renamed (the Playwright-`Page` collision + the `Partial<Page>`
  misread it caused) and that it is a name-only change. A focused amendment note
  appended to ADR-0007 / ADR-0003 is acceptable IF it reads cleanly; a small new
  ADR is the safer default given the ADR format is one short paragraph.

ZERO behaviour changes: the 8 verbs, the `WaitCondition`/`Snapshot`/`Cookie`/
locator-string contracts, the session RPC wire shape (`SessionRpcBuiltInRequest`
and the `{verb:'hand', name, args}` hand path), the hand contract semantics, and
the trust model are all byte-for-byte unchanged. Only the type's NAME differs.

## Acceptance criteria

- [ ] The seam type is named `WebHandsPage` at its definition; no reference to a
      seam TYPE named `Page` remains anywhere in `packages/core` (source or tests).
- [ ] `WebHandsPage` is exported from the `core` package entry point; the old
      `Page` export is gone.
- [ ] Runtime VALUE/function identifiers containing "Page" are UNCHANGED — in
      particular `composePage`, `composeBuiltInPage`, `assertCompletePage`, the
      test helper `fakePageWithHandVerb`, and the exported `makeRpcPage` keep
      their exact names (only the seam TYPE was renamed).
- [ ] The `type Page as PwPage` aliases are removed from all three alias sites;
      Playwright's `Page` is imported directly (unaliased) where the live
      Node-side page is referenced, and the former `PwPage` annotations now read
      as plain Playwright `Page`.
- [ ] `HandContext.pwPage` is still named `pwPage`; only its type annotation
      changed (now Playwright's `Page`).
- [ ] `HandContribution.verbs` is typed `Partial<WebHandsPage>` and its doc
      comment reads "a subset of webhands' (eight) seam verbs" (no longer a bare
      `Partial<Page>` that could be misread as Playwright's `Page`).
- [ ] Every `{@link Page}` JSDoc reference is re-pointed by meaning: seam ones →
      `{@link WebHandsPage}`; genuinely-Playwright ones stay `Page`. No dangling
      `{@link Page}` that resolves to the wrong type.
- [ ] `CONTEXT.md` no longer uses a bare "Page" to mean the seam: the seam-
      meaning occurrences (e.g. the `hand` entry's "closes over the Page") read
      `WebHandsPage`, while genuinely-Playwright mentions ("the live Playwright
      `Page`") are unchanged.
- [ ] String literals and prose that merely contain the word "Page" (e.g. the
      `'Fixture Page'` test fixture text, "session page" prose) are NOT renamed —
      only seam-meaning references are.
- [ ] `pnpm changeset` exists declaring a **major** bump for `@webhands/core`
      with a message describing the breaking exported-type rename.
- [ ] An ADR (new `docs/adr/NNNN-*.md`, or a clean focused amendment to
      ADR-0007/ADR-0003) records the rename rationale and that it is name-only.
- [ ] `tsc` is green (a stale seam-`Page` reference or a wrongly-renamed
      Playwright `Page` surfaces here as a compile error — this is load-bearing
      proof).
- [ ] The existing `core` test suite passes UNCHANGED except for the renamed
      seam-type references — in particular `hand-host.test.ts`,
      `hand-loading.test.ts`, `agent-exposed-hand-verb-over-rpc.test.ts`, and the
      transport/session/cookies tests. No new behavioural test is required (the
      rename is behaviour-preserving; the existing suite is the regression bar).
- [ ] No new shared/global write is introduced, so the existing shared-write
      isolation in the hand/session tests (temp profile + endpoint roots; real
      `~/.webhands` asserted untouched) is unchanged and still holds.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: rename webhands' verb-level seam TYPE `Page` → `WebHandsPage` across
> `packages/core`, a NAME-ONLY, behaviour-preserving change, and drop the
> now-unnecessary `type Page as PwPage` aliases. Ship it as one breaking major
> release (changeset) with an ADR recording why, and disambiguate the glossary.
>
> FIRST, check this task against current reality (it is a launch snapshot and
> may have DRIFTED): does it still match the code and the relevant ADRs
> (ADR-0003 the transport seam, ADR-0006/0007 the hand host/contract)? If the
> seam type has already been renamed, or the alias sites no longer exist, do NOT
> build on the stale premise — route to needs-attention with the discrepancy
> (WORK-CONTRACT.md "Drift is a needs-attention signal"). At authoring time the
> drift check passed: the seam `Page` lives in `packages/core/src/seam.ts`, is
> exported from `packages/core/src/index.ts`, and three modules carry
> `type Page as PwPage` aliases (the hand host + both Playwright transports).
>
> Domain vocabulary you must keep straight (this is the WHOLE task):
> - The SEAM `Page` is webhands' own 8-verb transport-neutral interface
>   (`navigate`/`snapshot`/`click`/`type`/`eval`/`wait`/`cookies`/`setCookies`),
>   branded-locator-string addressing, NO Playwright/CDP types across it
>   (ADR-0003). This is the type to RENAME to `WebHandsPage`.
> - Playwright's `Page` is a different, real type. Where the code holds a LIVE
>   Node-side page (the `pwPage` field, the hand host's locator helpers, the
>   transports' `pwPage` params), it currently imports Playwright's page as
>   `type Page as PwPage` PURELY to dodge the clash. After the seam rename, that
>   clash is gone, so import Playwright's `Page` directly and let those
>   annotations read as plain `Page`.
>
> CRITICAL SCOPE FENCE — rename the TYPE, never a value name. Several runtime
> functions/identifiers contain the word "Page" but are NOT the seam type and
> MUST keep their exact names: `composePage`, `composeBuiltInPage`,
> `assertCompletePage`, the test helper `fakePageWithHandVerb`, and — most
> importantly — the EXPORTED `makeRpcPage`. Renaming any of these is out of
> scope; renaming the exported `makeRpcPage` would be a second unintended
> breaking change. A `tsc`-green build does NOT catch an internally-consistent
> over-rename, so this is on you to respect. You are changing exactly ONE
> identifier's name: the seam type `Page` → `WebHandsPage`.
>
> Where to look (find references by SEARCH, do not trust a hardcoded file list —
> the prd's file list is slightly over-inclusive). Search `packages/core` for
> the identifier `Page` and the JSDoc token `{@link Page}` across both `src/` and
> `test/`, and classify EACH hit:
> - Imports `type Page` / `Page` FROM `./seam.js` (or from the package entry in
>   tests) → the SEAM type → rename to `WebHandsPage`.
> - `keyof Page`, `Partial<Page>`, `Page` as an annotation that came from the
>   seam → rename to `WebHandsPage`.
> - `type Page as PwPage` from `'playwright'`, and every `PwPage` usage → these
>   are PLAYWRIGHT's page → drop the alias, import `Page` from `'playwright'`
>   directly, and rewrite `PwPage` → `Page`.
> - `{@link Page.xxx}` / `{@link Page}` JSDoc → re-point by meaning (seam →
>   `WebHandsPage`, Playwright → stays `Page`).
> - A VALUE/function name that contains "Page" (`composePage`, `makeRpcPage`,
>   `assertCompletePage`, `composeBuiltInPage`, `fakePageWithHandVerb`) → LEAVE
>   ALONE. It is not the seam type.
> - String literals and prose containing the word "Page" (the `'Fixture Page'`
>   test text, prose like "the session page") → LEAVE ALONE. These are not type
>   references.
> Note: `session-server.ts` and `setup-profile.ts` reference the seam CONCEPT
> via `Session` and the runtime `.page` property, but carry NO `Page` TYPE
> token, so they likely need no edit — verify by search rather than assuming.
>
> ALSO update the `CONTEXT.md` glossary so its PROSE stops using a bare "Page"
> to mean the seam. The `hand` entry currently reads "closes over the Page" and
> "a capability module closing over the Page" (both = the seam) on the SAME line
> that says "the live Playwright `Page`" (= Playwright). Change the seam-meaning
> occurrences to `WebHandsPage`; leave the genuinely-Playwright `Page` mentions
> as-is. This is the whole point of the rename — a reader must be able to tell
> the two apart — so the glossary must not keep the collision alive.
>
> Seams to test at / what "done" means:
> - `tsc` is green. This is load-bearing: a missed seam-`Page` reference or a
>   wrongly-renamed Playwright `Page` becomes a compile error, which is exactly
>   the proof the rename was done correctly. (Note tsc will NOT catch an
>   over-rename of a value name or a prose change — see the scope fence above.)
> - The existing `core` suite passes with ONLY renamed type references — run it
>   (`hand-host.test.ts`, `hand-loading.test.ts`,
>   `agent-exposed-hand-verb-over-rpc.test.ts`, the transport/session/cookies
>   tests are the regression bar). Do NOT add behavioural tests; the rename is
>   behaviour-preserving and the existing proofs are the bar. Do NOT change the
>   wire protocol, the verb set, or any runtime value.
> - Add a `pnpm changeset` (major bump for `@webhands/core`) describing the
>   breaking exported-type rename. Mirror the existing changeset style in
>   `.changeset/`.
> - Add an ADR in `docs/adr/` (next sequential number, format in
>   `work/protocol/ADR-FORMAT.md` — one short paragraph is fine) recording WHY
>   the seam type was renamed (the Playwright-`Page` collision + the
>   `Partial<Page>` misread) and that it is name-only. A focused amendment to
>   ADR-0007/ADR-0003 is acceptable if it reads cleanly, but a small new ADR is
>   the safer default.
>
> RECORD non-obvious in-scope decisions you make (e.g. if you choose a focused
> ADR-0007 amendment over a new ADR, or hit a `{@link Page}` whose intended
> referent is genuinely ambiguous and you have to pick): note the choice in the
> done record / PR description so a reviewer need not reverse-engineer it. An
> un-recorded in-scope decision is a review FINDING, not a silent default.
>
> Out of scope (the prd rejected these as YAGNI — do NOT do them): any
> `HandContribution` redesign, a `{ page, hands }` namespace split, a
> `defineHand` helper, a hand-override policy, or any verb/wire/trust-model
> change. The ONLY defect being fixed is the type's NAME.
