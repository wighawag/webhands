---
title: Vision/tile captcha end-to-end proof (verbs-only, multi-origin fixture)
slug: vision-tile-captcha-end-to-end-proof
prd: broaden-agent-verb-surface
blockedBy: [tier4-coordinate-screenshot-crossorigin-read]
covers: [17]
---

## What to build

Prove the captcha CAPABILITY BAR for the vision/tile family using ONLY verbs: an
agent can SEE the cross-origin tile grid (element-clipped `screenshot` of the
widget) and CLICK it at viewport coordinates (`mouse`) even though it lives two
cross-origin frames deep, reading challenge state via the cross-origin frame READ
— all through the Tier-4 verbs, no iamhuman, no pre-built solver.

This is a PROOF (fixture + test) that the Tier-4 surface composes into the harder
captcha family the way Tier-1's frame-aware `query` proved the token-harvest
family. Build a local MULTI-ORIGIN nested-frame fixture (a synthetic WAF frame
containing a synthetic hCaptcha-like tile frame, two cross-origin boundaries deep,
mirroring the structure in the cross-origin finding) and drive the loop:

1. cross-origin READ to discover the tile grid / challenge state two frames deep.
2. element-clipped `screenshot` of the widget (what a vision model would look at).
3. `mouse` clicks at viewport coordinates to select tiles (coordinates taken from
   the viewport screenshot / the read bboxes — the coordinate<->screenshot
   contract from Tier-4).
4. the fixture's challenge registers the selection / advances.

The "which tiles" decision is the agent's (a vision model in reality); the test
drives a DETERMINISTIC selection against the fixture (no real vision model, no
real captcha service). This proves the MECHANISM composes, not a solve rate.

## Acceptance criteria

- [ ] A local MULTI-ORIGIN fixture presents a tile grid two cross-origin frames
      deep (a WAF-like frame containing an hCaptcha-like challenge frame).
- [ ] The loop runs with ONLY verbs: cross-origin READ of the grid/state ->
      element-clipped `screenshot` of the widget -> viewport-coordinate `mouse`
      clicks on tiles -> the fixture registers the selection / advances.
- [ ] Tile coordinates used by `mouse` are derived consistently with the VIEWPORT
      screenshot / read bboxes (the Tier-4 coordinate<->screenshot contract holds
      across cross-origin frames).
- [ ] No iamhuman dependency and no solver code in webhands; the selection is a
      deterministic test drive, not a real vision model or captcha service.
- [ ] Tests are real-browser + local multi-origin fixture seam tests (mirror the
      repo style).
- [ ] Shared-write isolation: profile + screenshot output paths point at per-test
      temp dirs; the real locations are asserted untouched.
- [ ] A changeset is added if any product code changed.

## Blocked by

- `tier4-coordinate-screenshot-crossorigin-read` — uses that task's `mouse`,
  `screenshot`, and cross-origin frame READ verbs.

## Prompt

> Goal: prove the vision/tile captcha capability bar using ONLY webhands verbs — an
> agent SEES the cross-origin tile grid (element-clipped screenshot) and CLICKS it
> at viewport coordinates (`mouse`), reading challenge state via the cross-origin
> frame READ, two cross-origin frames deep, no iamhuman, no solver. Deliverable
> from the prd `work/prds/tasked/broaden-agent-verb-surface.md` (User Story 17).
>
> READ FIRST: `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`
> (the spike-verified mechanism: coordinate mouse + screenshot AND frameLocator-
> chained read/click two cross-origin frames deep; the real Imperva frame tree) and
> the prd's ## Resolved decisions R3.
>
> CHECK REALITY: the `tier4-coordinate-screenshot-crossorigin-read` task must have
> landed — this proof USES its `mouse`, `screenshot` (element-clipped + viewport),
> and cross-origin READ verbs. Confirm their shapes; if they landed differently,
> route to needs-attention rather than building on a stale premise.
>
> Domain vocabulary: the **vision/tile captcha family** needs cross-origin tile
> clicks (vs the token-harvest family, already proven in
> `frame-aware-query-token-harvest-captcha-proof`). The coordinate<->screenshot
> contract: a tile seen at (x,y) in the VIEWPORT screenshot is clicked at `mouse`
> (x,y). webhands ships NO solver and NO vision model — the test drives a
> DETERMINISTIC tile selection against the fixture; this proves the MECHANISM
> composes, not a solve rate.
>
> What "done" means: a local multi-origin fixture with a tile grid two cross-origin
> frames deep; the verbs-only loop (cross-origin read -> element-clipped screenshot
> -> viewport-coordinate mouse clicks -> fixture advances) passes; coordinates are
> consistent with the viewport screenshot; no iamhuman/solver; real-browser fixture
> tests; profile + screenshot paths isolated to temp; a changeset if product code
> changed.
