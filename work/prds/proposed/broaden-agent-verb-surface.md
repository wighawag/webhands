---
title: Broaden the agent verb surface (extraction, rich input, frame scope) so an unaided agent can drive any site — including self-solving captchas with only a 2captcha key
slug: broaden-agent-verb-surface
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks.

<!-- open-questions -->

## Open questions

These block AUTO-tasking; they are design choices the tasker must not guess.

1. **`query` return contract — the known field set + the open extension (the #4
   decision).** Agreed shape: a CLOSED, documented field set the verb always
   knows how to produce, PLUS a caller-supplied extension for arbitrary
   attributes/properties. Pin the exact closed set (the draft below is
   evidence-derived from every `eval`-extraction site in the iamhuman example) and
   the extension syntax (named attributes vs. named JS properties vs. both). See
   ## Implementation Decisions.
2. **Snapshot refs vs. `query` refs vs. locator strings — one addressing story.**
   `snapshot` already emits `[ref=eN]` element refs. Does `query` return rows
   keyed by those same refs (so an agent reads `query`, picks a row, and
   `click`s its ref), or only by index/locator? Reusing snapshot refs is the
   coherent answer but needs the ref scheme to be stable across a `query` +
   `click` pair. CONFIRM the addressing story is unified, not three parallel ones.
3. **CLI/MCP surface for the new verbs.** The new verbs must appear as both CLI
   commands and MCP tools (incur gives both). Confirm the structured `query`
   result and the input verbs (`press`, `select`, `hover`, `scroll`, plus any
   Deliverable-4 coordinate/screenshot verbs) have a clean CLI shape (e.g. how a
   field-list and a frame qualifier are passed as flags) — not just a
   programmatic API.

<!-- /open-questions -->

## Resolved decisions

Decisions taken with the user during planning; recorded so the tasker treats them
as settled, not open.

- **R1 — frame scope is LOCATOR-EXPRESSION-NATIVE for every locator-taking verb;
   an explicit `frame?` qualifier is confined to `eval` only — AND the surface is
   shaped so adding `frame?` everywhere later is a NON-BREAKING change.** The
   spike proved `click`/`type` already reach same-origin frames via a
   `frameLocator(...)` expression, and the agent already needs locator-expression
   grammar to use them at all, so `frameLocator` is the same skill, not a new one.
   So `query`/`exists`/`count`/`isVisible`/`getAttribute` take the SAME locator
   expressions (frame hop in the string); only `eval` gets a transport-neutral
   `frame?` selector string (it is page-world JS and cannot carry a
   `frameLocator`). REVERSIBILITY IS A BUILT-IN INVARIANT, not a future promise:
   if live testing shows agents fumble the `frameLocator` grammar, a `frame?`
   qualifier can be added to the locator-taking verbs as PURE SUGAR with zero
   breakage, GUARANTEED by two shape constraints the tasks MUST preserve:
     1. **Additive-only signatures.** Every locator-taking verb takes its
        options as an OPTIONS OBJECT (or is trivially wrappable into one) with
        room for a future optional `frame?` field — never a new positional arg,
        never a changed type. A call passing a frame-qualified locator string
        today keeps working unchanged after `frame?` is added; the two become two
        ways to say the same thing and the string way is never broken.
     2. **One frame-resolution seam.** Frame scoping resolves through a SINGLE
        internal helper (the one that already turns a `frameLocator(...)`
        expression into a live same-origin frame locator). A future `frame?`
        routes through that SAME helper (resolve the `frame` selector to a
        same-origin frame, then resolve the locator within it) — it is wiring one
        new input into the existing resolver, NOT a parallel addressing scheme.
   Cross-origin frame on `eval` ⇒ a typed, LOUD "cross-origin frame unreachable"
   error (page-world JS cannot cross); cross-origin DOES work for the Tier-4
   `frameLocator`/coordinate ops (R3). Net: locator-native now, `frame?`-everywhere
   stays a cheap, safe future toggle.

- **R3 — the vision/tile (cross-origin) captcha family IS promoted to the SEAM
   (Tier 4 is a committed deliverable, ordered LAST).** The user wants an unaided
   agent to handle BOTH captcha families with verbs alone: token-harvest (a) via
   Tiers 1–3, then vision/tile (b) via Tier 4. The ADR-0003 "no Playwright/CDP
   types on the seam" line is RESOLVED (not merely bent) by keeping the new
   surface string/number-typed and agent-digestible:
  - **`screenshot` returns a FILE PATH, never image bytes.** webhands mints a PNG
    under a managed dir (default e.g. `<home>/screenshots/` or a `/tmp/webhands-*`
    location) and returns `{path, width, height}`; the caller MAY override the
    path. A path is a plain string, so nothing binary crosses the seam, and it is
    digestible by an agent (read the file / attach it). Three scopes: VIEWPORT
    (default), FULL-PAGE (option), and ELEMENT-CLIPPED (a locator — screenshot
    just the captcha widget, ideal for focusing a vision model).
  - **Coordinates are VIEWPORT CSS-pixels, expressed as plain numbers.** The
    `mouse` verb (`{action: 'click'|'move'|'down'|'up', x, y, button?}`) uses
    Playwright `page.mouse` semantics — viewport-relative CSS pixels — which is
    exactly what the cross-origin tile-click spike used
    (`work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`).
    NOT OS-level screen coordinates (we never inject OS input). Plain numbers, no
    Playwright type crosses the seam.
  - **Coordinate ↔ screenshot frame MUST match for the click loop.** `mouse`
    coordinates are viewport-relative, so the agent's "look then click" loop MUST
    use the VIEWPORT screenshot: a pixel (x,y) in the viewport screenshot maps
    directly to a `mouse` click (x,y). The FULL-PAGE screenshot is offered for
    reading scrolled-out content but its pixels are NOT expected to match
    `mouse` coordinates (full-page includes off-viewport content); the spec says
    so plainly so an agent does not click the wrong spot.
  - **Cross-origin frame READ** is promoted too: the read counterpart to the
    already-working cross-origin `click` (the `frameLocator(...).frameLocator(...)`
    chain), returning structured-cloned values. This lets the agent READ the tile
    grid / challenge state two cross-origin frames deep.
  - **ADR consequence:** a NEW ADR amends/supersedes ADR-0003 to admit this
    narrow, typed coordinate+image-path+cross-origin-read surface, with the
    rationale above. Honest caveat recorded there: a hypothetical future
    extension transport could implement viewport coordinates but not necessarily
    OOPIF cross-origin coordinate clicks — accepted, because extension transport
    is no longer a driving constraint; the priority is agent-digestible types.

## Problem Statement

webhands today exposes EIGHT verbs (`navigate`, `snapshot`, `click`, `type`,
`eval`, `wait`, `cookies`, `setCookies`). That surface is enough for an agent to
read a page and fill a simple form, but it is NOT enough for an unaided agent to
drive a genuinely hard site end to end. The proof is the canonical iamhuman
example (`~/dev/github/wighawag/iamhuman/examples/basic`): a real multi-page
DVSA flow. Everywhere it needs to READ STRUCTURED DATA (the centre list, the slot
rows, the page-state classifier, the unknown-page diagnosis) or PROBE STATE (does
this element exist / is it visible / what is this input's type), it falls back to
hand-rolled `eval` strings that build a JSON blob in the page and parse it out.
That `eval`-as-a-Swiss-army-knife pattern is the smell: it is the surface telling
us which verbs are missing.

Three concrete capability ambitions expose the gap sharply, in increasing
difficulty:

- **Shopping / forms (read-heavy):** "search Amazon, read the results (title,
  price, rating, ASIN), add the right one to cart." Needs structured EXTRACTION
  and presence/visibility STATE, which today only `eval` can fake.
- **Web games (input-rich):** "play this browser game." Needs a keyboard/pointer
  axis webhands simply does not have: `press` (arrows/Enter/WASD), `hover`,
  `scroll`, `drag`, and for some, raw coordinate input + `screenshot`. `click` +
  `type` cannot play a game or pass a drag-slider.
- **Captchas (the capability bar):** the user's north star — an agent with ONLY a
  2captcha API key (no prior knowledge, no pre-built solver) should be able to get
  past a captcha just by poking the page with verbs, the same way it would work
  out a checkout. webhands itself still "does not solve captchas" (no solver, no
  key built in); the point is that the verb surface must be RICH ENOUGH that a
  capable agent can. Today it is not: the spike
  (`work/notes/findings/click-and-type-already-frame-scoped-via-framelocator.md`)
  shows the one missing piece for the realistic same-origin case is a frame-aware
  READ.

This PRD does not abandon the hand tier. Third-party HANDS (like iamhuman, or a
future "buy-on-amazon" hand) remain the SIMPLER path: an agent can be dumb and a
hand makes the hard thing one call. The verb surface is the floor that makes the
unaided path POSSIBLE; hands are the ramp that makes it EASY. We want both.

## Solution

Broaden the agent-facing verb surface in FOUR capability tiers, sequenced so the
captcha capability bar is cleared as early as possible (token-harvest family by
Tiers 1–3; vision/tile family by Tier 4, last). Each tier is independently
shippable and fans out into its own task(s).

- **Tier 1 — extraction + state verbs (pure reads, lowest trust, highest
  leverage).** A `query` verb that addresses element(s) by a locator (optionally
  frame-scoped) and returns STRUCTURED data (a closed, documented field set plus a
  caller-named extension), and the small state verbs `exists` / `count` /
  `isVisible` / `getAttribute`. These kill the `eval`-returns-JSON pattern, serve
  all read-heavy tasks (shopping, results scanning, game-state reads, captcha
  sitekey reads), and add ZERO new trust (same page-sandbox tier as `snapshot` /
  `eval`).

- **Tier 2 — rich input verbs (the game / interaction axis).** `press` (keyboard
  keys + chords), `hover`, `select` (dropdowns), `scroll`, and `drag`. These are
  page-level Playwright actions promoted to the seam so a seam-only (MCP / Model-B)
  agent can drive a game or a richer form, not just `click`/`type`.

- **Tier 3 — frame-scoped eval (same-origin only).** Extend `eval` so it can run
  in a NAMED same-origin child frame (the `frame-scoped-eval-verb` idea), closing
  the last same-origin papercut for code that genuinely needs to RUN logic in the
  frame (e.g. fire a captcha callback) rather than just read or act on an element.
  Cross-origin frames stay out of reach by browser security, stated plainly.

- **Tier 4 — coordinate input + screenshot + cross-origin frame read (the
  vision/tile captcha family).** COMMITTED (resolved R3), ordered last: a
  coordinate `mouse` (viewport CSS-pixels), a `screenshot` verb that returns a
  FILE PATH (viewport / full-page / element-clipped), and a cross-origin
  `frameLocator`-chained READ. This lets a seam-only agent click the hCaptcha tile
  grid two cross-origin frames deep. It is kept seam-clean by passing only
  numbers + a path string (see ## Resolved decisions, R3), and a new ADR amends
  ADR-0003 to admit that narrow surface.

The captcha capability bar is cleared by **Tier 1 (frame-aware `query` to read
the sitekey) alone** for the token-harvest family — because the spike proved
DELIVERY (`type` the token into the same-origin sink + `click`/callback-fire)
already works. Tier 4 is what the vision/tile family additionally needs.

## User Stories

1. As an agent driving a shopping site, I want a `query` verb that returns the
   visible results as structured rows (text, price text, a link `href`, a data
   attribute) so I can pick the right item WITHOUT writing a page script.
2. As an agent, I want `exists(locator)` / `count(locator)` so I can branch on
   whether an element is present (e.g. "Add to cart" vs "Out of stock") without an
   `eval` probe.
3. As an agent, I want `isVisible(locator)` so I distinguish a present-but-hidden
   element (the queue/template-text case the DVSA classifier handles with
   `offsetParent`) from a truly actionable one.
4. As an agent, I want `getAttribute(locator, name)` so I can read a single
   attribute (a sitekey, an href, an input `type`) cheaply.
5. As an agent classifying a page, I want `query` to read several markers in one
   call (the page-state probe) so a classifier is a verb call, not a hand-rolled
   IIFE that builds a JSON string.
6. As an agent solving a token-harvest captcha with my own 2captcha key, I want to
   READ the sitekey from the same-origin captcha frame via a frame-aware `query`,
   then DELIVER the token by `type`ing it into the response sink and firing the
   callback — all through verbs, with no pre-built solver.
7. As an agent, I want `query` to optionally address an element inside a NAMED
   same-origin child frame, because real captcha/WAF widgets live one frame down.
8. As an agent playing a browser game, I want `press` (arrow keys, Enter, space,
   WASD, and chords like `Control+A`) so I can drive keyboard-controlled UIs.
9. As an agent, I want `hover` so I can trigger hover menus / reveal-on-hover
   controls that `click` cannot surface.
10. As an agent filling a real form, I want `select` for native `<select>`
    dropdowns and proper checkbox/radio handling, not a `click` approximation.
11. As an agent, I want `scroll` (to an element or by an amount) so I can reach
    lazy-loaded content and off-viewport controls.
12. As an agent, I want `drag` (source → target, or by offset) so I can handle
    drag-reorder UIs and drag-slider challenges.
13. As an agent that needs to RUN logic inside a same-origin frame (fire a
    captcha `data-callback`, read a runtime-only JS value), I want a frame-scoped
    `eval` so I am not forced into brittle `contentDocument` walks.
14. As an agent, I want every new verb available over BOTH the CLI and MCP (incur
    gives both) so the same capability serves a bash-driven agent and an
    MCP-wired one.
15. As an operator, I want the README/CONTEXT scope statement updated honestly:
    webhands still ships NO solver and NO key, but the verb surface no longer
    PREVENTS a capable agent (with its own key) from solving a captcha — "we do
    not solve it; we no longer stand in the way" — distinct from the hand tier
    that makes it EASY.
16. As an operator who wants it EASY, I want hands to remain the simpler path: a
    dumb agent + an iamhuman (or future buy-on-amazon) hand still gets there in one
    call, even though a smart agent could now do it over several verb turns.
17. As an agent solving a vision/tile captcha, I want a coordinate `mouse`, a
    `screenshot` (viewport / full-page / element-clipped, returned as a FILE
    PATH), and a cross-origin frame READ on the seam, so I can SEE the tile grid
    (screenshot the widget) and CLICK it at viewport coordinates even though it
    lives two cross-origin frames deep.
18. As an agent running the "look then click" loop, I want the VIEWPORT screenshot
    pixels to map directly to `mouse` click coordinates, so a tile I see at (x,y)
    is the tile I click; I understand the FULL-PAGE screenshot is for reading
    scrolled-out content and is NOT coordinate-matched.
19. As an agent, I want `screenshot` to return a PATH to a PNG file (not raw
    bytes), so the result stays a plain string on the seam and I can read/attach
    the image.

## Implementation Decisions

> Trimmed at tasking-time into tasks / ADRs.

### Tier 1 `query` — the closed field set (evidence-derived) + the open extension

The closed set is derived from EVERY `eval`-extraction site in the iamhuman
example (`flow.ts` `readCentreOptions`/`readSlotRows`/`diagnoseUnknown`,
`page-state.ts` `buildProbe`) — i.e. what real driving actually reads:

- `text` — `textContent`/`innerText`, trimmed (centre names, slot dates,
  headings, submit labels).
- `value` — form control value (input/textarea/select).
- `href` — resolved link target (centre links).
- `visible` — `offsetParent !== null`-style visibility (queue/template-text
  distinction).
- `exists` / `count` — presence and match count (the bulk of the classifier).
- `tagName` / `type` — element tag + input `type` (the native-date-vs-text
  branch).
- `id` / `name` / `role` — common identity/aria markers (`body.id`,
  classifier ids).
- `bbox` — bounding box (x/y/width/height) in VIEWPORT coordinates, the bridge to
  Tier-4: an agent can `query` an element's `bbox` and feed its center straight
  into the `mouse` verb (same coordinate frame). Also useful for "is it on
  screen".
- (page-level convenience) `url` / `title` — already partly covered by
  `snapshot`; `query` over `:root`/document gives them uniformly.

The OPEN extension (the user's "known set but also caller-provided"): the caller
may additionally name (a) arbitrary ATTRIBUTES to read (`attrs: ['data-sitekey',
'data-callback']`) and/or (b) arbitrary serializable JS PROPERTIES
(`props: ['type', 'checked']`). Both come back by structured clone, same
serialization contract as `eval` (ADR-0003 no type leaks). Pin the exact syntax
in Q2.

`query` shape (decision-encoding sketch, NOT final API):

```
query(
  locator: string,                 // a raw Playwright locator expr (frame-capable today)
  fields?: ReadonlyArray<KnownField>,   // subset of the closed set; default a sensible core
  options?: { attrs?: string[]; props?: string[]; limit?: number },
): Promise<ReadonlyArray<QueryRow>>    // one row per matched element (bounded by limit)
```

Returning ROWS (one per match) is what kills the `readSlotRows`/`readCentreOptions`
loops. The state verbs (`exists`/`count`/`isVisible`/`getAttribute`) are thin,
agent-legible shorthands over the same machinery (a `count` is `query(...).length`;
they exist as named verbs because an agent branches on them constantly).

### Frame scope (resolved R1) — reuse addressing; keep `frame?` a safe future add

Locator-expression-native for all locator-taking verbs (`query`/state verbs take
the same `frameLocator(...)` expression `click`/`type` already accept); an
explicit transport-neutral `frame?` STRING (iframe selector / frame name|url
fragment, never a Playwright `Frame` handle — ADR-0003) ONLY on `eval` (Tier 3),
because page-world JS cannot carry a `frameLocator` (spike: `ReferenceError: p is
not defined`). Cross-origin frame on `eval` ⇒ typed LOUD error, never silent
empty.

The REVERSIBILITY INVARIANT (R1) is load-bearing for the tasks: shape every
locator-taking verb's signature as an OPTIONS OBJECT with room for a future
optional `frame?`, and resolve ALL frame scoping through ONE internal helper, so
a later `frame?`-everywhere is additive sugar over the same resolver with zero
breakage. A task that gives a verb a positional-only signature, or stands up a
second frame-resolution path, VIOLATES this invariant and must be rejected in
review.

### Tier 2 input verbs — promote page-level Playwright actions to the seam

`press` (key or chord string, addressed at a locator or the focused element),
`hover` (locator), `select` (locator + option value/label), `scroll`
(to-locator or by-offset), `drag` (source locator → target locator, or by
offset). All addressing stays a locator string (ADR-0004); all are
structured-result-free (they act, then the agent re-`snapshot`s/`query`s). These
are exactly the ops a HAND already has on `pwPage`; Tier 2 is "lift them to the
verb seam so a seam-only agent gets them too."

### Tier 4 (committed, R3) — coordinate + screenshot + cross-origin read, seam-clean

The ops, all string/number-typed so nothing Playwright-shaped crosses the seam:

- `mouse({action: 'click'|'move'|'down'|'up', x, y, button?})` — VIEWPORT
  CSS-pixel coordinates (Playwright `page.mouse` semantics), NOT OS screen
  coordinates. Plain numbers.
- `screenshot(options?) -> {path, width, height}` — webhands MINTS a PNG under a
  managed dir and returns its PATH (a string; no bytes on the seam). Scopes:
  `viewport` (default, coordinate-matched to `mouse`), `full` (full-page, for
  reading scrolled-out content, NOT coordinate-matched — spec says so), and a
  locator-CLIPPED element shot (just the captcha widget). Caller MAY override the
  output path; webhands validates it stays under a sane dir.
- cross-origin frame READ — the read counterpart to the already-working
  cross-origin `click`: a `frameLocator(...).frameLocator(...)`-chained read that
  returns structured-cloned values across cross-origin boundaries (so the agent
  can read the tile/challenge state two frames deep).

A NEW ADR amends/supersedes the relevant part of ADR-0003 to admit this narrow
surface (numbers + a path string + a cross-origin read), with the rationale in
## Resolved decisions (R3): the priority is agent-digestible types, and extension
transport is no longer a driving constraint. The honest caveat (an extension
transport could do viewport coordinates but not necessarily OOPIF cross-origin
coordinate clicks) is recorded in that ADR.

## Testing Decisions

> Trimmed at tasking-time into tasks' acceptance criteria.

- Real-browser + LOCAL FIXTURE tests, mirroring the existing seam tests
  (`packages/core/test/*-verbs.test.ts`) — never a third-party site whose DOM
  rots. Add fixtures: a structured-list page (for `query` rows), a
  same-origin nested-frame page carrying a sitekey div + token-sink textarea +
  callback (already prototyped in the spike `/tmp/frame-spike/spike.mjs` — fold it
  into a committed fixture), a keyboard-game-ish page (for `press`/`scroll`), a
  `<select>`/drag page, and a NESTED CROSS-ORIGIN frame page (multi-origin, like
  the cross-origin spike) for Tier-4 cross-origin read + coordinate click +
  element-clipped screenshot.
- Each new verb asserts EXTERNAL behaviour (the row data returned, the input's
  value after `select`, the element reached after `scroll`, the callback fired
  after a frame-scoped `eval`, the FILE written + its dimensions after
  `screenshot`, the element reached after a coordinate `mouse` click), not
  Playwright internals.
- Cross-origin honesty: a frame-scoped EVAL (Tier 3) against a CROSS-ORIGIN frame
  returns the typed loud error (eval cannot cross), while the Tier-4 cross-origin
  READ + coordinate click SUCCEED against the multi-origin fixture (the two are
  deliberately different: page-world JS cannot cross, but a `frameLocator`/
  coordinate op can).
- Screenshot isolation: `screenshot` writes under a per-test temp/managed dir
  (never the real managed location); assert the path returned exists and the file
  is a non-empty PNG, and that a caller-supplied path outside the sane dir is
  rejected.
- Coordinate-frame contract: assert a VIEWPORT screenshot's element position maps
  to a `mouse` click that hits that element (the look-then-click loop holds);
  full-page is NOT asserted to coordinate-match.
- Shared-write isolation: every launch points its profile root at a per-test temp
  dir; the real `~/.webhands` is asserted untouched (existing convention).
- A changeset per change (repo convention; `changeset status` is the verify gate).

## Out of Scope

- **A built-in captcha solver or any provider key in webhands.** webhands ships
  neither. The agent brings its own 2captcha key and its own logic, or uses a
  third-party hand (iamhuman). This PRD only makes the verb surface CAPABLE.
- **OS-level / screen input injection.** The coordinate `mouse` verb is
  VIEWPORT-relative (Playwright `page.mouse`), never OS desktop coordinates; we
  do not inject OS-level input. (The vision/tile cross-origin family IS in scope
  now — Tier 4, resolved R3 — via viewport coordinates + cross-origin read; see
  `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`.)
- **Image BYTES on the seam.** `screenshot` returns a file PATH, never base64 /
  binary; an agent reads the file. (Keeps the seam string-typed.)
- **The `--hand` / `allowAgentHands` runtime-hand path** — a different trust tier,
  captured separately in `work/notes/ideas/agent-provided-hand-via-cli-arg.md`.
- **A buy-on-amazon (or any task-specific) hand.** Mentioned as the "make it easy"
  counterpart, but building one is its own work, not this surface PRD.

## Further Notes

- Provenance: conversation 2026-06-28 reviewing the iamhuman Model-A example as a
  test of webhands capability. The user's framing: webhands should SUPPORT
  everything (so a smart agent can self-solve, including both captcha families),
  while hands remain the SIMPLER path for a dumb agent.
- R3 (resolved with the user): the vision/tile family IS promoted to the seam
  (Tier 4), kept ADR-0003-clean by string/number-only types (a `/tmp`-style PNG
  PATH instead of bytes; viewport CSS-pixel numbers instead of an image/Locator
  type). Extension transport is explicitly no longer a driving constraint; the
  priority is agent-digestible types.
- This PRD SUPERSEDES the two standalone ideas it absorbs by collapsing them:
  `frame-scoped-eval-verb` (becomes Tier 3 + informs the frame-aware `query`) and
  the Tier-1 `query` need are the same "address + read" requirement; keep the idea
  notes as provenance but task from here.
- Key finding to read before tasking:
  `work/notes/findings/click-and-type-already-frame-scoped-via-framelocator.md`
  (the spike: `click`/`type` are already frame-scoped; the only same-origin
  captcha gap is a frame-aware READ) and
  `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md` (the
  cross-origin boundary that gates Tier 4).
- Suggested task fan-out (the tasker decides): T1 `query`+state verbs (+fixtures);
  T2 frame-aware `query` read & the same-origin token-harvest captcha proof;
  T3 Tier-2 input verbs (`press`/`hover`/`select`/`scroll`/`drag`); T4
  frame-scoped `eval` (the only `frame?` qualifier; same-origin only); T5
  README/CONTEXT scope-honesty update; T6 Tier-4 `mouse` + `screenshot`
  (path-returning, 3 scopes) + cross-origin read, PLUS the new ADR amending
  ADR-0003 (this task carries the ADR); T7 the vision/tile end-to-end captcha
  proof against the multi-origin fixture (depends on T6). T1’s acceptance MUST
  bake in the R1 reversibility invariant (options-object signatures + single
  frame-resolution helper) so a future `frame?`-everywhere stays non-breaking.
