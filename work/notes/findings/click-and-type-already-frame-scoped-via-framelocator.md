---
title: webhands `click`/`type` ALREADY reach same-origin child frames via `frameLocator(...)` locator expressions; the ONLY seam gap for a same-origin captcha is READING a frame-scoped value (no query/getAttribute verb, and `eval` is top-frame page-world JS)
slug: click-and-type-already-frame-scoped-via-framelocator
type: finding
status: incubating
source: 'live spike 2026-06-28 (/tmp/frame-spike/spike.mjs) — real Playwright Chromium via @webhands/core dist PlaywrightLaunchTransport, against a local same-origin parent page embedding a same-origin #main-iframe child carrying a .h-captcha[data-sitekey] div + an h-captcha-response textarea sink + a window.onCaptchaFinished callback (mimics the Imperva #main-iframe structure from work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md). Drove ONLY the public verbs click/type/eval. Reproduce: node /tmp/frame-spike/spike.mjs'
---

## What this settles

The PRD-investigation question "what is the BEST way to express frame scoping
across the verbs, and how big is the gap?" (the `frame-scoped-eval-verb` idea +
the captcha capability bar). It was run as a live spike rather than reasoned,
because the existing `resolveLocator` evaluates a locator EXPRESSION with
`page`/`p` in scope, so it was unclear whether `frameLocator(...)` already
composes through it.

## Result (verified, not assumed)

Against a same-origin parent → same-origin `#main-iframe` child (the exact
shape the Imperva finding gives for the reachable token-harvest path):

| Operation (public verb only) | Works today? |
| --- | --- |
| `eval` (top frame) reads child-frame `[data-sitekey]` | **NO** — returns `null` (top document only) |
| `eval` reaches child via `iframe.contentDocument` hop (same-origin) | YES (hand-rolled DOM walk) |
| `click` with `p.frameLocator('#main-iframe').locator('#child-btn')` | **YES — already frame-scoped** |
| `type` into `p.frameLocator('#main-iframe').locator('#h-captcha-response')` | **YES — already frame-scoped** |
| `eval` of a `frameLocator(...)` EXPRESSION | **NO** — `ReferenceError: p is not defined` (eval is page-world JS, not the locator sandbox) |
| `eval` fires child `onCaptchaFinished` via `contentWindow` (same-origin) | YES (hand-rolled) |

## The headline

**`click` and `type` are ALREADY frame-capable for same-origin child frames**,
with no code change, because they resolve a raw Playwright locator EXPRESSION
(ADR-0004) and `frameLocator('#sel').locator('#sel2')` is valid in that grammar
(`p`/`page` is the live `Page` in the `resolveLocator` sandbox). So token
DELIVERY into a same-origin frame (type the token into the sink, click submit)
needs nothing new.

**The ONE genuine seam gap is READING a value out of a frame-scoped element.**
The two read-shaped verbs cannot do it:
- `snapshot` is whole-page (no frame addressing, not a targeted read).
- `eval` runs page-world JS in the TOP document: it CANNOT accept a Playwright
  `frameLocator` expression (`p` is not in scope there — confirmed
  `ReferenceError`), and its top-document `document.querySelector` does not see
  into a child frame. The only way `eval` reaches a same-origin child today is a
  brittle hand-rolled `iframe.contentDocument` walk (works, but breaks the moment
  a frame is cross-origin and is exactly the papercut the `frame-scoped-eval`
  idea named).

## Consequence for the PRD (the captcha capability bar)

For the **token-harvest captcha family** (2captcha key; sitekey + token-sink both
same-origin-reachable per the Imperva finding), the unaided-agent solve is:
read sitekey → (agent calls 2captcha itself, out of band) → write token into the
sink → fire the callback. Of those, **only the sitekey READ is missing from the
seam** — delivery (`type` + `click`/callback-via-eval) already works. So a single
**frame-aware extraction verb** (a `query`/`read` that addresses a frame-scoped
element and returns its attributes/text/value by structured clone) closes the
read-gap AND is the highest-leverage everyday verb (it also kills the
`eval`-returns-a-JSON-string pattern all over the iamhuman example's
`readCentreOptions`/`readSlotRows`/`buildProbe`).

This **collapses two captured ideas into one**: `frame-scoped-eval-verb` and the
Tier-1 `query` verb are the same need viewed twice — the real requirement is
"address an element (optionally in a same-origin frame) and READ structured data
out of it." Frame scoping should therefore be expressed the SAME way addressing
already is — a locator expression / a `frame` qualifier on the addressing verbs —
NOT as a bolt-on to `eval`.

## Honest boundary (unchanged from the cross-origin finding)

This only covers **same-origin** child frames. The hCaptcha TILE grid is two
cross-origin frames deep and stays unreachable from any page-world verb (browser
security); the vision/tile-clicking family needs `frameLocator`-chained
cross-origin traversal + coordinate mouse + screenshot, which are page-level
Playwright ops available to a HAND (it holds `pwPage`) but not, today, on the
agent seam. Whether to promote those to the seam (so even the vision family is
verb-reachable) is a deliberate, separate PRD decision — and it strains the
ADR-0003 "no Playwright types on the seam" line (coordinates/screenshots are not
locator strings). The token-harvest family does NOT need any of it.

## Provenance

Spike run 2026-06-28 while planning the "broaden the agent verb surface" PRD
(self-solving captcha + web-game + shopping capability bar). Pairs with
`playwright-cross-origin-frame-captcha-mechanics.md` (the cross-origin half) and
the `frame-scoped-eval-verb` / `agent-provided-hand-via-cli-arg` ideas. The spike
script is at `/tmp/frame-spike/spike.mjs` (throwaway; not committed).
