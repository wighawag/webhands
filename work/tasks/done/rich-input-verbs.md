---
title: Tier-2 rich input verbs (press / hover / select / scroll / drag)
slug: rich-input-verbs
prd: broaden-agent-verb-surface
blockedBy: [query-and-state-verbs]
covers: [8, 9, 10, 11, 12]
---

## What to build

The Tier-2 input axis: lift page-level Playwright actions a HAND already has up to
the agent verb seam so a seam-only (MCP / Model-B) agent can drive a game or a
richer form, not just `click`/`type`. Five verbs, each a thin vertical path
through all layers (seam interface + types -> built-in hand verb body -> RPC
dispatch + typed client -> incur CLI command = CLI + MCP -> real-browser fixture
tests):

- `press <key-or-chord> [locator?]` — keyboard keys + chords (arrows, Enter,
  space, WASD, `Control+A`), at a locator or the focused element.
- `hover <locator>` — pointer hover (reveal hover menus / on-hover controls).
- `select <locator> --value <v> | --label <l>` — native `<select>` option choice.
- `scroll (--to <locator> | --by <dx,dy>)` — reach lazy-loaded / off-viewport
  content.
- `drag <source-locator> <target-locator>` — drag-reorder UIs and drag-slider
  challenges.

All addressing stays a raw Playwright locator EXPRESSION (ADR-0004), resolved
through the ONE existing resolver (so same-origin frame hops work as for
`click`/`type`). All are action verbs (no structured result beyond an
ok/verb ack, mirroring `click`); the agent re-`snapshot`s / `query`s afterwards.
The seam carries NO Playwright/CDP types (ADR-0003): keys are strings, offsets are
numbers, locators are strings. Signatures stay options-object / positional-arg in
the established style so a future `frame?` field is additive (R1).

## Acceptance criteria

- [ ] `press` sends a single key, a named key (Enter/ArrowLeft/...), and a chord
      (`Control+A`) — at a locator AND at the focused element — verified by a
      fixture that records key events.
- [ ] `hover` triggers a hover-only affordance on a fixture (an element that only
      appears/changes on hover).
- [ ] `select` sets a native `<select>` by value and by label; the chosen option
      is reflected in the element's state.
- [ ] `scroll --to <locator>` brings an off-viewport element into view; `scroll
      --by <dx,dy>` scrolls by the given amount (assert the scroll position /
      element visibility changes).
- [ ] `drag <src> <dst>` moves a draggable element onto a target on a fixture
      (assert the drop handler ran / order changed).
- [ ] Each verb is a CLI command AND an MCP tool from one incur definition, with a
      clean flag shape (`press <key> [--locator]`, `select <loc> --value/--label`,
      `scroll --to/--by`, `drag <src> <dst>`); loud validation where a verb needs
      exactly one of two mutually-exclusive flags (mirror `wait`'s pattern).
- [ ] Addressing flows through the single existing locator resolver; no
      Playwright/CDP type crosses the seam (ADR-0003).
- [ ] Tests cover every verb as real-browser + LOCAL FIXTURE seam tests (mirror
      `packages/core/test/*-verbs.test.ts`); add fixtures for keyboard events,
      hover, `<select>`, scrollable content, and drag.
- [ ] Shared-write isolation: profile paths point at per-test temp dirs; the real
      `~/.webhands` is asserted untouched.
- [ ] A changeset is added (`pnpm changeset`).

## Blocked by

- `query-and-state-verbs` — serialized after it: both tasks add verbs that edit
  the SAME files (the seam interface, the built-in hand host, the RPC dispatch +
  client, the CLI), so ordering them avoids a guaranteed merge conflict
  (TASKING-PROTOCOL "prefer file-orthogonal tasks; serialize same-module ones").

## Prompt

> Goal: add the Tier-2 rich input verbs (`press`, `hover`, `select`, `scroll`,
> `drag`) to webhands' agent verb surface, so a seam-only agent can drive a
> browser game or a richer form. Deliverable from the prd
> `work/prds/tasked/broaden-agent-verb-surface.md` (User Stories 8-12; ## Resolved
> decisions R5 for the CLI shape).
>
> FIRST check reality: trace an existing action verb (`click`) end to end to learn
> the layered pattern (seam interface + branded-locator types -> the built-in hand
> that implements the body over the live Playwright page -> the RPC dispatch +
> typed client -> the incur CLI command that yields CLI + MCP -> real-browser
> fixture tests) and add these five the SAME way. The `query-and-state-verbs` task
> landed before this one and touches the same files; confirm its shape and build
> on it (do not duplicate the resolver). If a seam landed differently than
> described, route to needs-attention.
>
> Domain vocabulary: a **verb** is one agent-facing action; the **seam** carries
> NO Playwright/CDP types (ADR-0003); addressing is a raw Playwright **locator**
> expression (ADR-0004) resolved by the ONE existing resolver (it handles
> same-origin `frameLocator` hops). These verbs are the page-level Playwright
> actions a HAND already has on `pwPage` (`keyboard.press`, `hover`,
> `selectOption`, `mouse.wheel`/`scrollIntoViewIfNeeded`, `dragTo`), lifted to the
> verb seam — keys are strings, offsets are numbers, locators are strings, so
> nothing Playwright-shaped crosses.
>
> CLI/MCP (R5): one incur Zod `args`/`options` + `output` definition per verb gives
> both surfaces. Use loud "exactly one of" validation where a verb has
> mutually-exclusive flags (mirror the existing `wait` verb). Keep signatures
> options-object/positional in the established style so a future `frame?` is
> additive (R1).
>
> What "done" means: all five verbs work end to end (seam -> hand -> RPC -> CLI/MCP),
> real-browser fixture tests cover each (key events, hover affordance, `<select>`
> by value+label, scroll-to + scroll-by, drag-and-drop), no type leaks the seam,
> profile paths isolated to temp, a changeset added. RECORD any non-obvious
> in-scope decision (e.g. the exact chord-string grammar) per the template.
