---
title: Broaden the agent verb surface (extraction, rich input, frame scope) so an unaided agent can drive any site — including self-solving captchas with only a 2captcha key
slug: broaden-agent-verb-surface
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks.

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

- **R5 — CLI/MCP surface follows the EXISTING incur convention (no new
   mechanism); the programmatic shapes (R1–R4) map to flags/args mechanically.**
   Verified against the current `packages/cli/src/cli.ts` verb definitions
   (Zod-schema'd `args` positional + `options` flags, a Zod `output` schema incur
   renders token-cheap for the CLI agent AND as typed MCP tool I/O, boolean flags
   get incur's `--no-` negation, `wait` sets the "exactly one of" loud-validation
   precedent):
  - **List flags are REPEATABLE, not comma-joined:** `query <locator> --attr href
    --attr data-sitekey --prop innerText --prop type --pw visible --pw bbox
    [--limit N] [--with-refs]`. Repeatable avoids the comma-in-value ambiguity.
  - **`query` output** is a Zod schema (`rows: [{ ref?, attrs?, props?, pw? }]`),
    rendered token-cheap (TOON) on the CLI and typed over MCP — exactly as
    `snapshot` does today.
  - **No `--frame` flag on locator-taking verbs** (R1): frame scope rides IN the
    locator string (`frameLocator('#x').locator('#y')`). The ONLY `--frame
    <selector>` flag is on `eval` (R1's one exception).
  - **`screenshot`** output `{path, width, height}` (Zod); flags `--scope
    viewport|full|element` (default `viewport`), `--locator <expr>` (REQUIRED when
    `--scope element`, validated loud like `wait`), `--out <path>` (optional
    override; validated to stay under the managed dir). The MCP result surfaces
    the path as an attachment-capable field (the path-not-bytes choice, R3, is
    what makes this clean).
  - **`mouse`** flags: `--action click|move|down|up`, `--x <n>`, `--y <n>`,
    `--button left|right|middle` (default left). Plain numbers/enums.
  - **Tier-2 input verbs** are positional-arg + small-flag, mirroring `click`:
    `press <key-or-chord> [--locator <expr>]`, `hover <locator>`, `select
    <locator> --value <v>` (or `--label <l>`), `scroll (--to <locator> | --by
    <dx,dy>)`, `drag <source-locator> <target-locator>`.
  - **`exists`/`count`/`isVisible`/`getAttribute`** are positional-locator verbs
    (+ `--name` for `getAttribute`), each with a tiny Zod `output` so an agent can
    branch on the result from the CLI as easily as over RPC.
- **R4 — addressing: locator/`.nth()` (A) FIRST; a `query`-minted durable DOM ref
   (B) as a KNOWN-CHEAP fast-follow (spiked, not deferred-blind).** ADR-0004's
   locator expression stays THE addressing spine, so `query` returns rows the
   agent re-addresses by locator (`(<locator>).nth(i)` or, better, a
   content-anchored locator like `getByText(title)`). But the spike
   (`work/notes/findings/query-minted-dom-ref-is-a-cheap-durable-handle.md`)
   showed B is ~5 lines and FIXES a real footgun:
  - A's `.nth(i)` SILENTLY clicks the wrong element after the list mutates between
    read and act (spike: clicked "Bravo" when it wanted "Charlie" after a row was
    prepended) — dangerous for checkout/captcha.
  - B — a `ref` PREFERENCE LADDER, computed by `query` per element (the ref is
    ALWAYS just a locator string resolved through the existing resolver):
      1. **Reuse a stable, unique EXISTING attribute** when the element has one —
         in priority order `id`, then `data-testid`/`data-test`/`data-id`,
         `name`, a link's `href`, a unique `aria-label` — PRESENT *and*
         VERIFIED-UNIQUE on the page (per R1, within its frame). The ref IS the
         real locator (`#buy-charlie`, `[data-testid="x"]`): durable across
         framework reconciliation (the framework keeps its OWN meaningful attrs),
         human-legible, and ZERO DOM mutation.
      2. **MINT only as the fallback** for an anonymous element with no stable
         unique address: stamp `data-webhands-ref="<id>"` (or the WeakMap variant,
         below) and return it; `click`/`type` resolve `[data-webhands-ref="<id>"]`.
    The spike proved the MOVE case (a prepend) survives — clicked "Charlie"
    correctly after the reorder — and that a ref is SEAM-CLEAN (a string; no
    ElementHandle; ADR-0003 intact). The ladder shrinks minting to exactly the
    elements that had nothing stable, which are also where it matters least.
  - **HONEST durability scope (folded in after the React/Svelte question).** A
    minted ref is a SHORT-LIVED handle, not a stable element identity. The spike
    tested only a DOM MOVE. NODE REPLACEMENT and ATTRIBUTE-STRIPPING are EXPECTED
    on modern SPAs — React keyed-list reconciliation and Svelte `{#each}`/`{#if}`
    re-creates nodes (a minted attr dies with the old node), and React may even
    STRIP an unknown attribute we stamped on a node it keeps (the attr is not in
    its virtual DOM). All of these MUST surface as a LOUD typed `StaleRefError`:
    a ref resolving to ZERO elements is stale; a ref resolving to MORE THAN ONE
    (a framework cloned a subtree carrying our attr) is also an error, never
    "pick the first". A loud-stale handle is STRICTLY SAFER than A's SILENT
    wrong-element click — the agent is told "re-`query`, the page changed", which
    is its natural loop anyway. The minting MECHANISM (a `data-webhands-ref`
    attribute vs. a page-world `WeakMap<Element,id>` that survives
    attribute-stripping by keying on node identity) is left for the T1b spike to
    decide against real React/Svelte re-renders.
  - **Web 1.0 / full-page-reload sites: supported BY the stale contract, not a
    gap.** A navigation destroys the document and every ref with it; the next
    `query` re-mints against the fresh DOM. A ref simply never survives a reload,
    and because staleness is DETECTED (resolve-to-zero → `StaleRefError`), the
    agent re-`query`s rather than mis-clicks — which is exactly the act → reload
    → re-read loop a Web 1.0 site already forces. So we deliberately do NOT try to
    persist refs across navigation; the loud-stale + re-query path covers it.
  - Playwright's native `aria-ref` is REJECTED for this: it is positional/
    snapshot-scoped and resolved to the WRONG element after drift (spike).
  - Read-only preserved: refs/mints happen ONLY when the caller asks (a
    `withRefs`/`pw:['ref']` opt-in), so the default `query` stays a pure read;
    minted attributes are namespaced and single-`query`-scoped (a fresh `query`
    supersedes/sweeps prior mints so a ref can't match a stale element from two
    queries ago).
  - Fits R1's reversibility shape (a `ref` is an additive optional row field + the
    one existing resolver). Recommended task order: A in T1, B as a fast-follow
    task (T1b) right after (not "future").
- **R2 — `query` has NO curated DOM field set; the agent names DOM data freely,
   plus a tiny Playwright-only extras set.** DOM attributes and JS properties ARE
   Playwright/DOM vocabulary the agent already knows, so webhands maintains NO
   allow-list of them. A row carries EXACTLY what the caller asked for (option-ii
   token economy taken to its end — not even a forced core):
  - `attrs: string[]` — DOM ATTRIBUTES by name (`getAttribute`), e.g.
    `data-sitekey`, `href`, `data-callback`. (What is written in the markup.)
  - `props: string[]` — live JS PROPERTIES by name, e.g. `innerText`, `value`,
    `checked`, `selectedIndex`, `type`. (Runtime state; `text` is just
    `props: ['innerText']` — no special `text` field.)
  - `pw: ('visible' | 'bbox')[]` — the ONLY fixed set: Playwright-LOCATOR-derived
    extras that are NOT DOM-nameable. `visible` is `locator.isVisible()`
    (actionability-grade, better than the `offsetParent` hack); `bbox` is
    `locator.boundingBox()` in VIEWPORT CSS-pixels (the bridge to the Tier-4
    `mouse` verb — same coordinate frame, R3). These two exist precisely because
    `attrs`/`props` CANNOT express them; they are not a curation burden.
  - `limit?: number` — bound the rows returned (token economy on multi-match).
  - The `attrs` vs `props` SPLIT is deliberate and LOUD (no auto-detect): `value`,
    `checked` etc. are ambiguous between attribute and live property, and silent
    guessing is the footgun this repo's "loud over silent" style rejects.
  - All values cross by structured clone, same contract as `eval` (ADR-0003, no
    type leaks). `count` is its own state verb (a property of the MATCH SET, not
    a row field); `exists` is `count > 0`.
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

## Implementation & Testing Decisions

> Tasked. The build-level detail that lived here (the per-verb shapes, the
> `query` field model, the Tier-4 coordinate/screenshot/cross-origin design, the
> testing seams) moved into the task files under `work/tasks/` and, where it is
> durable rationale, into ADRs (notably the Tier-4 task carries the ADR amending
> ADR-0003). The design FORKS and their WHY are preserved above in ## Resolved
> decisions (R1-R5).

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
  captcha gap is a frame-aware READ),
  `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md` (the
  cross-origin boundary Tier 4 crosses), and
  `work/notes/findings/query-minted-dom-ref-is-a-cheap-durable-handle.md` (R4: a
  `query`-minted `data-webhands-ref` is a cheap durable cross-call handle that
  survives index drift; native `aria-ref` does not).
- Suggested task fan-out (the tasker decides): T1 `query`+state verbs (locator/
  `.nth()` addressing = A) (+fixtures); T1b the `query` durable `ref` (B)
  fast-follow: the prefer-stable-attribute LADDER (reuse a unique `id`/
  `data-testid`/… when present; MINT only as fallback), `click`/`type` accept a
  ref, opt-in so default `query` stays read-only, a stale/ambiguous ref fails
  LOUD. T1b MUST OPEN WITH A SPIKE validating the ref against a real React
  keyed-list re-render and a Svelte `{#each}` re-render ((i) a reused stable attr
  survives reconciliation; (ii) a minted attr may be stripped/replaced; (iii)
  attribute-mint vs. page-world `WeakMap<Element,id>` mint) and lets THAT spike
  pick the minting mechanism (depends on T1);
  T2 frame-aware `query` read & the same-origin token-harvest captcha proof;
  T3 Tier-2 input verbs (`press`/`hover`/`select`/`scroll`/`drag`); T4
  frame-scoped `eval` (the only `frame?` qualifier; same-origin only); T5
  README/CONTEXT scope-honesty update; T6 Tier-4 `mouse` + `screenshot`
  (path-returning, 3 scopes) + cross-origin read, PLUS the new ADR amending
  ADR-0003 (this task carries the ADR); T7 the vision/tile end-to-end captcha
  proof against the multi-origin fixture (depends on T6). T1’s acceptance MUST
  bake in the R1 reversibility invariant (options-object signatures + single
  frame-resolution helper) so a future `frame?`-everywhere AND the T1b `ref` field
  both stay non-breaking. Each verb task SHIPS its CLI command + MCP tool together
  (R5: same incur definition gives both) — there is no separate "CLI surface" task;
  a verb without its CLI/MCP shape is incomplete.
