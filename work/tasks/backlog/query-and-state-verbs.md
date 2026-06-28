---
title: Tier-1 `query` + state verbs (exists/count/isVisible/getAttribute)
slug: query-and-state-verbs
prd: broaden-agent-verb-surface
blockedBy: []
covers: [1, 2, 3, 4, 5, 14]
---

## What to build

The first new verbs: a `query` extraction verb plus the small state verbs
`exists` / `count` / `isVisible` / `getAttribute`, as a thin vertical path through
EVERY layer the existing eight verbs cross (seam interface + types -> built-in
hand verb body over the live page -> RPC dispatch + typed client -> incur CLI
command which also yields the MCP tool -> real-browser fixture tests).

`query(locator, options?)` addresses element(s) by a raw Playwright locator
EXPRESSION (ADR-0004; already frame-capable for same-origin frames per the frame
spike) and returns ONE ROW PER MATCH. There is NO curated DOM field set (R2): the
caller names what it wants and a row carries EXACTLY that:

- `attrs: string[]` — DOM ATTRIBUTES by name (`getAttribute(name)`).
- `props: string[]` — live JS PROPERTIES by name (`el[name]`, e.g. `innerText`,
  `value`, `checked`, `type`). `text` is just `props: ['innerText']` — no special
  field.
- `pw: ('visible' | 'bbox')[]` — the ONLY fixed set: Playwright-locator-derived
  extras NOT DOM-nameable. `visible` = `locator.isVisible()` (actionability-grade,
  better than `offsetParent`); `bbox` = `locator.boundingBox()` in VIEWPORT
  CSS-pixels (the future bridge to the Tier-4 `mouse` verb).
- `limit?: number` — bound rows returned.

The `attrs`/`props` split is LOUD — no auto-detect (a silent attribute-vs-property
guess is the footgun this repo rejects). Values cross by structured clone, the
SAME contract as `eval` (ADR-0003: no Playwright/CDP types on the seam).

The state verbs are thin shorthands over the same machinery, each with its own
tiny structured output so an agent can branch on it from the CLI as cheaply as
over RPC: `count(locator)` = match-set size; `exists(locator)` = `count > 0`;
`isVisible(locator)` = the first match's `pw:['visible']`;
`getAttribute(locator, name)` = the first match's `attrs:[name]`.

SIGNATURE INVARIANT (R1, load-bearing for reversibility): `query`'s options are an
OPTIONS OBJECT (not positional fields), leaving room for a future additive
optional `frame?` field AND the T1b `ref` field with ZERO breakage. Resolve the
locator (incl. its same-origin frame hop) through the ONE existing locator
resolver — do NOT stand up a second addressing path.

CLI/MCP shape (R5, mirror the existing verb commands which are Zod
`args`/`options` + a Zod `output` schema, giving CLI and MCP from one definition):
list flags are REPEATABLE, not comma-joined —
`query <locator> --attr href --attr data-sitekey --prop innerText --pw visible
[--limit N]`. NO `--frame` flag here (frame scope rides in the locator string,
R1).

## Acceptance criteria

- [ ] `query` returns one row per matched element, each carrying exactly the
      requested `attrs` / `props` / `pw` fields and nothing else.
- [ ] `attrs` reads DOM attributes; `props` reads live JS properties; the two are
      distinct (a fixture where an attribute and the live property DIFFER — e.g. a
      checkbox toggled after load — proves `attrs:['checked']` vs
      `props:['checked']` return different values).
- [ ] `pw:['visible']` reflects actionability-grade visibility (a present-but-
      hidden element reads not-visible); `pw:['bbox']` returns a viewport-pixel
      box `{x,y,width,height}`.
- [ ] `limit` bounds the row count.
- [ ] `exists` / `count` / `isVisible` / `getAttribute` return correct structured
      results over a fixture, including the absent-element cases
      (`exists=false`, `count=0`).
- [ ] All values cross the RPC seam by structured clone with no Playwright/CDP
      type leak (ADR-0003), the same contract `eval` already holds.
- [ ] Each verb is a CLI command AND an MCP tool from one incur definition;
      repeatable `--attr`/`--prop`/`--pw` flags work; the structured result is
      rendered token-cheap on the CLI.
- [ ] The locator (incl. a same-origin `frameLocator(...)` hop) resolves through
      the existing single resolver; `query`'s options are an options object so a
      future `frame?` / `ref` field is non-breaking (R1).
- [ ] Tests cover the new behaviour as real-browser + LOCAL FIXTURE seam tests,
      mirroring `packages/core/test/*-verbs.test.ts`; add a structured-list
      fixture page for `query` rows.
- [ ] Shared-write isolation: every launch points its profile root at a per-test
      temp dir; the real `~/.webhands` is asserted untouched.
- [ ] A changeset is added (`pnpm changeset`) per the repo convention.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: add the Tier-1 extraction + state verbs (`query`, `exists`, `count`,
> `isVisible`, `getAttribute`) to webhands' agent verb surface, as the first
> deliverable of the prd `work/prds/tasked/broaden-agent-verb-surface.md`
> (read its ## Resolved decisions R1, R2, R5 and ## Testing Decisions).
>
> FIRST check this task against current reality (it is a launch snapshot): does
> the verb-surface still flow through the same layers? Trace one existing verb
> (e.g. `click`) end to end to learn the pattern — the seam interface +
> branded-locator types, the built-in hand that implements the verb body over the
> live Playwright page, the RPC dispatch + typed client that carry it over the
> wire, the incur CLI command that yields both CLI and MCP, and the real-browser
> fixture tests. Add the new verbs the SAME way. If any of those seams landed
> differently than described, route to needs-attention (WORK-CONTRACT.md "Drift is
> a needs-attention signal").
>
> Domain vocabulary: a **verb** is one agent-facing page action; a **hand** is the
> in-process module that implements verbs over the live page; the **seam** is the
> transport-neutral verb surface that must carry NO Playwright/CDP types
> (ADR-0003); element addressing is a raw Playwright **locator** EXPRESSION
> (ADR-0004), resolved by the one existing resolver (it already handles
> same-origin `frameLocator(...)` hops — see
> `work/notes/findings/click-and-type-already-frame-scoped-via-framelocator.md`).
>
> Design (from the prd, R2): `query(locator, {attrs?, props?, pw?, limit?})`
> returns one row per match carrying EXACTLY the requested fields. There is NO
> curated DOM field list — `attrs` are DOM attributes (`getAttribute`), `props`
> are live JS properties (`el[name]`; `text` = `props:['innerText']`), and `pw`
> is the ONLY fixed set (`visible` = `locator.isVisible()`, `bbox` =
> `locator.boundingBox()` in viewport CSS-pixels). The `attrs`/`props` split is
> LOUD — never auto-detect. State verbs are thin shorthands: `count` = match-set
> size, `exists` = count>0, `isVisible` / `getAttribute` = the first match's
> `pw:['visible']` / `attrs:[name]`.
>
> CRITICAL (R1 reversibility invariant — a reviewer will check this): give
> `query` an OPTIONS-OBJECT signature (not positional fields) so a future optional
> `frame?` (and the T1b `ref`) is additive, and route all locator/frame
> resolution through the SINGLE existing resolver — do NOT add a parallel
> addressing scheme.
>
> CLI/MCP (R5): mirror the existing Zod `args`/`options` + `output` verb commands
> so one definition yields CLI and MCP. List flags are REPEATABLE
> (`--attr`/`--prop`/`--pw`), NOT comma-joined. No `--frame` flag (frame scope is
> in the locator string).
>
> What "done" means: the five verbs work end to end (seam -> hand -> RPC -> CLI/MCP),
> values cross by structured clone with no type leak, real-browser fixture tests
> cover them (incl. attrs-vs-props divergence, hidden-element visibility,
> absent-element cases), profile paths are isolated to temp in tests, and a
> changeset is added. RECORD any non-obvious in-scope decision (e.g. the exact
> default when `query` is called with no fields) per the task template's guidance.
