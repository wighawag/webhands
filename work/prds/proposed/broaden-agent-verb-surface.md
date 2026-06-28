---
title: Broaden the agent verb surface (extraction, rich input, frame scope) so an unaided agent can drive any site — including self-solving captchas with only a 2captcha key
slug: broaden-agent-verb-surface
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks.

<!-- open-questions -->

## Open questions

These block AUTO-tasking; they are design choices the tasker must not guess.

1. **Frame-scope expression (the #3 investigation residue).** The spike
   (`work/notes/findings/click-and-type-already-frame-scoped-via-framelocator.md`)
   proved `click`/`type` already reach same-origin frames via a
   `frameLocator(...)` locator EXPRESSION, and that the ONE gap is a frame-aware
   READ. Two ways to express frame scope on the new read/state verbs, and the
   choice must be consistent across the whole surface:
   - (a) **Locator-expression-native:** the addressing string itself carries the
     frame hop (`p.frameLocator('#main-iframe').locator('.h-captcha')`), exactly
     as `click`/`type` already accept. No new param anywhere. Cheapest, most
     consistent with ADR-0004, but the locator string gets long and the agent must
     know the `frameLocator` grammar.
   - (b) **An explicit `frame?` qualifier** (a transport-neutral selector string
     for the iframe element) on each addressing verb, resolved to a same-origin
     frame internally. More legible for an agent; adds a parallel addressing
     concept the seam must define and keep cross-origin-honest.
   - Lean: (a) for the locator-addressing verbs (it already works, zero new
     concept), and confine any `frame?` qualifier to the places a bare expression
     can't reach (notably a frame-scoped `eval`, which today cannot take a
     `frameLocator` at all). CONFIRM this split, or pick one uniform mechanism.
2. **`query` return contract — the known field set + the open extension (the #4
   decision).** Agreed shape: a CLOSED, documented field set the verb always
   knows how to produce, PLUS a caller-supplied extension for arbitrary
   attributes/properties. Pin the exact closed set (the draft below is
   evidence-derived from every `eval`-extraction site in the iamhuman example) and
   the extension syntax (named attributes vs. named JS properties vs. both). See
   ## Implementation Decisions.
3. **Does cross-origin (the vision/tile family) get promoted to the SEAM, or stay
   hand-only?** The user wants the agent to handle BOTH families, ordered
   token-harvest (a) first, vision/tile (b) second. (a) needs only same-origin
   reach (this PRD's verbs). (b) needs cross-origin `frameLocator` traversal +
   coordinate mouse + screenshot — page-level ops a HAND already has but the seam
   does not, and they strain ADR-0003 (coordinates/screenshots are not locator
   strings). DECIDE: promote a minimal coordinate-mouse + screenshot + cross-origin
   frame-read trio to the seam (Deliverable 4), or keep the vision family
   hand-only and have this PRD deliver only up to the token-harvest bar? This
   gates whether Deliverable 4 exists.
4. **Snapshot refs vs. `query` refs vs. locator strings — one addressing story.**
   `snapshot` already emits `[ref=eN]` element refs. Does `query` return rows
   keyed by those same refs (so an agent reads `query`, picks a row, and
   `click`s its ref), or only by index/locator? Reusing snapshot refs is the
   coherent answer but needs the ref scheme to be stable across a `query` +
   `click` pair. CONFIRM the addressing story is unified, not three parallel ones.
5. **CLI/MCP surface for the new verbs.** The new verbs must appear as both CLI
   commands and MCP tools (incur gives both). Confirm the structured `query`
   result and the input verbs (`press`, `select`, `hover`, `scroll`, plus any
   Deliverable-4 coordinate/screenshot verbs) have a clean CLI shape (e.g. how a
   field-list and a frame qualifier are passed as flags) — not just a
   programmatic API.

<!-- /open-questions -->

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

Broaden the agent-facing verb surface in three capability tiers, plus an optional
fourth, sequenced so the captcha capability bar is cleared as early as possible.
Each tier is independently shippable and fans out into its own task(s).

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

- **Tier 4 (optional, gated by Q3) — coordinate input + screenshot +
  cross-origin frame read (the vision/tile captcha family).** Only if we decide
  the vision family belongs on the SEAM rather than hand-only: a minimal
  coordinate `mouse`, a `screenshot` verb, and cross-origin `frameLocator`-chained
  READ. This is the part that strains ADR-0003 and is the user's "(b), after (a)".

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
17. (Gated by Q3) As an agent solving a vision/tile captcha, I want coordinate
    `mouse`, `screenshot`, and cross-origin frame READ on the seam so I can click
    the tile grid that lives two cross-origin frames deep — OR a clear statement
    that this family is hand-only and why.

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
- `bbox` — bounding box (x/y/width/height), the bridge toward Tier-4 coordinate
  ops and useful for "is it on screen".
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

### Frame scope (Q1) — reuse addressing, do not invent a parallel scheme

The spike showed `click`/`type` already accept `frameLocator(...)` expressions for
same-origin frames. `query`/state verbs SHOULD accept the same expression form
(option a), so frame scope needs NO new concept there. The ONLY place a new
mechanism is unavoidable is **frame-scoped `eval`** (Tier 3): `eval` runs
page-world JS and cannot take a `frameLocator` (spike: `ReferenceError: p is not
defined`), so it needs an explicit `frame?` selector that the transport resolves
to a same-origin frame and evaluates in. Keep `frame` a transport-neutral STRING
(a selector for the iframe element / a frame name|url fragment), never a
Playwright `Frame` handle (ADR-0003). Cross-origin frame ⇒ a typed, LOUD
"cross-origin frame is unreachable" error, never a silent empty.

### Tier 2 input verbs — promote page-level Playwright actions to the seam

`press` (key or chord string, addressed at a locator or the focused element),
`hover` (locator), `select` (locator + option value/label), `scroll`
(to-locator or by-offset), `drag` (source locator → target locator, or by
offset). All addressing stays a locator string (ADR-0004); all are
structured-result-free (they act, then the agent re-`snapshot`s/`query`s). These
are exactly the ops a HAND already has on `pwPage`; Tier 2 is "lift them to the
verb seam so a seam-only agent gets them too."

### Tier 4 (gated by Q3) — the cross-origin/vision strain on ADR-0003

If promoted: a coordinate `mouse` (move/click at x/y), a `screenshot` verb
(returns image bytes/attachment), and a cross-origin frame READ. These do NOT
reduce to locator strings, so they need an ADR amending/annotating ADR-0003 (the
seam admits a NARROW, typed coordinate+image surface, justified by the vision
family). If NOT promoted: record the vision/tile family as explicitly hand-only
in Out of Scope, pointing at the iamhuman hand + the cross-origin finding.

## Testing Decisions

> Trimmed at tasking-time into tasks' acceptance criteria.

- Real-browser + LOCAL FIXTURE tests, mirroring the existing seam tests
  (`packages/core/test/*-verbs.test.ts`) — never a third-party site whose DOM
  rots. Add fixtures: a structured-list page (for `query` rows), a
  same-origin nested-frame page carrying a sitekey div + token-sink textarea +
  callback (already prototyped in the spike `/tmp/frame-spike/spike.mjs` — fold it
  into a committed fixture), a keyboard-game-ish page (for `press`/`scroll`), and
  a `<select>`/drag page.
- Each new verb asserts EXTERNAL behaviour (the row data returned, the input's
  value after `select`, the element reached after `scroll`, the callback fired
  after a frame-scoped `eval`), not Playwright internals.
- Cross-origin honesty: a test that a frame-scoped read/eval against a
  CROSS-ORIGIN frame returns the typed loud error, not a silent empty.
- Shared-write isolation: every launch points its profile root at a per-test temp
  dir; the real `~/.webhands` is asserted untouched (existing convention).
- A changeset per change (repo convention; `changeset status` is the verify gate).

## Out of Scope

- **A built-in captcha solver or any provider key in webhands.** webhands ships
  neither. The agent brings its own 2captcha key and its own logic, or uses a
  third-party hand (iamhuman). This PRD only makes the verb surface CAPABLE.
- **The vision/tile (cross-origin) captcha family — UNLESS Q3 promotes it to
  Tier 4.** Default position: it lives in the hand tier (iamhuman holds `pwPage`
  with `frameLocator`/coordinate/screenshot). See
  `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`.
- **The `--hand` / `allowAgentHands` runtime-hand path** — a different trust tier,
  captured separately in `work/notes/ideas/agent-provided-hand-via-cli-arg.md`.
- **A buy-on-amazon (or any task-specific) hand.** Mentioned as the "make it easy"
  counterpart, but building one is its own work, not this surface PRD.

## Further Notes

- Provenance: conversation 2026-06-28 reviewing the iamhuman Model-A example as a
  test of webhands capability. The user's framing: webhands should SUPPORT
  everything (so a smart agent can self-solve, including both captcha families),
  while hands remain the SIMPLER path for a dumb agent.
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
  T2 frame-aware `query` read & the same-origin captcha proof (token-harvest bar);
  T3 Tier-2 input verbs (`press`/`hover`/`select`/`scroll`/`drag`); T4
  frame-scoped `eval`; T5 README/CONTEXT scope-honesty update; T6 (only if Q3
  says so) Tier-4 coordinate+screenshot+cross-origin read with its ADR-0003
  amendment.
