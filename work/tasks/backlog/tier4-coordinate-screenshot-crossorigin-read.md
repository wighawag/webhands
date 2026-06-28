---
title: Tier-4 `mouse` + `screenshot` + cross-origin frame read (+ ADR amending 0003)
slug: tier4-coordinate-screenshot-crossorigin-read
prd: broaden-agent-verb-surface
blockedBy: [frame-scoped-eval]
covers: [17, 18, 19]
---

## What to build

The Tier-4 surface that lets a seam-only agent handle the VISION/TILE captcha
family (clicking the hCaptcha grid two cross-origin frames deep) — and any
visual/coordinate task — kept ADR-0003-clean by passing ONLY strings + numbers.
Three capabilities, each a thin vertical path through all layers, PLUS the ADR
that admits this narrow surface:

- `mouse({action: 'click'|'move'|'down'|'up', x, y, button?})` — coordinate input
  in VIEWPORT CSS-pixels (Playwright `page.mouse` semantics), NOT OS screen
  coordinates. Plain numbers on the seam.
- `screenshot(options?) -> {path, width, height}` — webhands MINTS a PNG under a
  managed dir and returns its PATH (a string; NO bytes on the seam). Three scopes:
  `viewport` (default, coordinate-matched to `mouse`), `full` (full-page, for
  reading scrolled-out content, NOT coordinate-matched — document this), and an
  element-CLIPPED shot (a locator — just the captcha widget). Caller MAY override
  the output path; validate it stays under a sane managed dir.
- cross-origin frame READ — the read counterpart to the already-working
  cross-origin `click`: a `frameLocator(...).frameLocator(...)`-chained read
  returning structured-cloned values across cross-origin boundaries (so the agent
  can read the tile/challenge state two frames deep). Distinct from Tier-3
  frame-scoped `eval`, which is same-origin only (page-world JS cannot cross);
  this read uses Playwright's `frameLocator`, which CAN.

The coordinate <-> screenshot contract is load-bearing: a pixel (x,y) in the
VIEWPORT screenshot maps directly to a `mouse` click (x,y); the FULL-PAGE
screenshot is NOT coordinate-matched (it includes off-viewport content). State
this in the verbs' docs so an agent does not click the wrong spot.

THIS TASK CARRIES THE ADR amending/superseding the relevant part of ADR-0003: the
seam admits a NARROW, typed coordinate + image-PATH + cross-origin-read surface,
justified by the vision family, with the honest caveat that a hypothetical future
extension transport could do viewport coordinates but not necessarily OOPIF
cross-origin coordinate clicks (accepted — extension transport is no longer a
driving constraint; the priority is agent-digestible types). Write it per
`work/protocol/ADR-FORMAT.md`.

## Acceptance criteria

- [ ] `mouse` clicks/moves at viewport CSS-pixel coordinates; a coordinate over a
      fixture element runs that element's handler (assert the effect).
- [ ] `screenshot` returns `{path, width, height}` and WRITES a non-empty PNG at
      `path`; scopes `viewport`, `full`, and element-clipped (a locator) each
      produce a correct image; a caller-supplied path outside the managed dir is
      rejected.
- [ ] A VIEWPORT screenshot's element position maps to a `mouse` click that hits
      that element (the look-then-click loop holds); `full` is NOT asserted to
      coordinate-match (and the docs say so).
- [ ] A cross-origin frame READ returns structured-cloned values from across two
      cross-origin boundaries on a MULTI-ORIGIN fixture (mirror the synthetic tree
      in `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`).
- [ ] No image BYTES and no Playwright/CDP type cross the seam — only a path
      string + plain numbers + structured-cloned read values (ADR-0003 as amended).
- [ ] An ADR (per `work/protocol/ADR-FORMAT.md`) amends ADR-0003 to admit this
      narrow surface, with the rationale and the extension-transport caveat.
- [ ] Each capability is a CLI command AND an MCP tool from one incur definition;
      `screenshot --scope viewport|full|element`, `--locator <expr>` (REQUIRED for
      `element`, validated loud like `wait`), `--out <path>`; `mouse --action
      --x --y --button`. The MCP `screenshot` result surfaces the path as an
      attachment-capable field.
- [ ] Tests cover all three capabilities as real-browser seam tests (a local
      MULTI-ORIGIN nested-frame fixture for the cross-origin read + an
      element-clipped screenshot of a frame widget); screenshots write under a
      per-test temp/managed dir and the real managed location is asserted
      untouched.
- [ ] Shared-write isolation: profile AND screenshot output paths point at
      per-test temp dirs; the real `~/.webhands` (and the real screenshot dir) are
      untouched.
- [ ] A changeset is added (`pnpm changeset`).

## Blocked by

- `frame-scoped-eval` — serialized after the other verb-adding tasks (it edits the
  same shared seam/host/RPC/CLI files), so it follows them to avoid a merge
  conflict. It also conceptually completes the frame story (Tier-3 same-origin
  eval, then Tier-4 cross-origin read).

## Prompt

> Goal: add the Tier-4 seam surface (`mouse` coordinate input, `screenshot`
> returning a file PATH in three scopes, and a cross-origin frame READ) so a
> seam-only agent can handle the VISION/TILE captcha family and any visual task —
> AND write the ADR amending ADR-0003 to admit this narrow surface. Deliverable
> from the prd `work/prds/tasked/broaden-agent-verb-surface.md` (## Resolved
> decisions R3; User Stories 17-19).
>
> READ FIRST: `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`
> — it spike-verified that Playwright reaches nested CROSS-ORIGIN frames via BOTH
> absolute-coordinate `page.mouse` + `page.screenshot` AND
> `frameLocator(...).frameLocator(...)` read/click two frames deep. That is the
> mechanism you expose. Also read ADR-0003 (the seam's no-Playwright-types rule you
> are amending) and `work/protocol/ADR-FORMAT.md`.
>
> CHECK REALITY: the earlier verb-adding tasks landed (same shared files). Build on
> the existing locator resolver / cross-origin `click` path; do not duplicate it.
> If a seam landed differently, route to needs-attention.
>
> Domain vocabulary: the seam stays ADR-0003-clean by passing STRINGS + NUMBERS
> only — `mouse` coordinates are VIEWPORT CSS-pixels (Playwright `page.mouse`, NOT
> OS screen coordinates), `screenshot` returns a PNG file PATH (webhands mints it
> under a managed dir; NEVER bytes), and the cross-origin read returns
> structured-cloned values. The Tier-3 `frame-scoped-eval` was SAME-ORIGIN only
> (page-world JS cannot cross); this cross-origin READ uses Playwright
> `frameLocator`, which CAN. The coordinate<->screenshot contract: VIEWPORT
> screenshot pixels map to `mouse` coords; FULL-PAGE does NOT (say so in docs).
>
> CLI/MCP (R5): one incur definition per capability gives both. `screenshot
> --scope viewport|full|element` with `--locator` REQUIRED for `element` (loud
> validation like `wait`) and optional `--out`; `mouse --action/--x/--y/--button`.
> The MCP screenshot result should surface the path as an attachment-capable field.
>
> What "done" means: the three capabilities work end to end with only path/number
> types crossing the seam; the viewport-screenshot<->mouse coordinate contract
> holds (tested); the cross-origin read works against a multi-origin fixture; the
> ADR amending ADR-0003 is written with the extension-transport caveat;
> real-browser fixture tests cover all of it; screenshot output + profile paths are
> isolated to temp and the real locations untouched; a changeset added. RECORD the
> managed-screenshot-dir choice + the ADR-0003 amendment as the durable WHY.
