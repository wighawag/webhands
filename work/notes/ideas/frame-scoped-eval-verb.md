---
title: A frame-scoped eval verb for the agent seam (same-origin child frames)
slug: frame-scoped-eval-verb
type: idea
status: incubating
created: 2026-06-28
---

## The opportunity

The agent seam's `eval` verb runs one JS expression in the TOP document's page
world (`page.evaluate`). It cannot target a child FRAME. An agent driving a
captcha/WAF page often needs to read or act INSIDE a nested frame: the real case
that surfaced this is an Imperva-wrapped hCaptcha page whose widget, sitekey, and
token sink live one same-origin frame down (`#main-iframe`), with the hCaptcha
challenge itself two cross-origin frames deeper. With only top-frame `eval`, an
agent cannot read `#main-iframe`'s `data-callback` / `h-captcha-response` or fire
its callback; it has to hand-roll `document.querySelector('iframe').contentDocument`
walks that break the moment a frame is cross-origin.

The idea: add a verb that evaluates an expression in a NAMED same-origin child
frame, e.g. `eval({expression, frame?})` where `frame` is a CSS selector for the
iframe element (or a frame URL/name match). When `frame` is omitted it is exactly
today's top-document `eval` (backward compatible).

## Scope it HONESTLY: same-origin only

This verb can only deliver SAME-ORIGIN frames. A cross-origin child frame (the
hcaptcha.com challenge frames in the motivating case) cannot be `evaluate`d into
from the page world, and exposing CDP/OOPIF attachment over the agent seam would
leak Playwright/CDP concepts the seam exists to keep out (ADR-0003). So the verb's
contract must state plainly: it reaches the top document and same-origin
descendant frames; cross-origin frames are out of reach BY DESIGN (a browser
security boundary, not a missing feature). The motivating Imperva case is only
PARTLY served by this (the `#main-iframe` host frame is same-origin and becomes
reachable; the nested hcaptcha.com frames remain unreachable, which is correct).

## Why this is the SMALL, seam-safe tier (vs the hand tier)

This is deliberately the modest counterpart to the bigger
`agent-provided-hand-via-cli-arg` idea. That idea notes `eval`'s limits (one
expression, page world, no `frameLocator`/coordinate-mouse/screenshots) and
answers them with a full Node HAND closing over the live `Page` (an entire trust
tier up: arbitrary in-process Node code). A frame-scoped `eval` does NOT cross
that line: it is still page-world JS, still structured-clone-by-value, still no
Node authority, just allowed to land in a same-origin sub-frame. So it stays in
the `eval` trust tier (sandboxed to the page) while removing the single most
common sub-frame papercut, without reaching for the hand tier.

Note: a HAND already has full frame access today (it closes over `ctx.pwPage`, so
`pwPage.frames()` + per-frame `evaluate` + CDP are all available in-process). So
this idea is ONLY about the AGENT seam (the over-the-wire verb vocabulary), not
about hands. A capability author who needs frames writes a hand; this verb is for
the agent that only speaks verbs.

## Design sketch (to be pinned in a PRD, not here)

- `eval({expression, frame?})`: `frame` is a transport-neutral STRING (a CSS
  selector for the iframe element, or a frame name/url fragment) — never a
  Playwright `Frame` handle (no Playwright type crosses the seam, ADR-0003).
- Resolution: locate the same-origin frame for the selector (Playwright
  `page.frameLocator(selector)` / `frame.evaluate`), evaluate there, structured-
  clone the result out exactly as `eval` does today.
- Failure modes are typed/loud: selector matches no frame; the matched frame is
  CROSS-ORIGIN (return a clear "cross-origin frame is unreachable" error, not a
  silent empty); the expression throws (same as `eval`).
- Backward compatible: `frame` omitted == today's behaviour, so it can be the
  same `eval` verb with an optional field rather than a new verb name.

## Rejected / out of scope

- **Cross-origin frame eval / CDP OOPIF attachment over the seam — REJECTED.**
  Leaks CDP across the seam (ADR-0003) and cannot work in the page world anyway.
  An agent needing cross-origin frame manipulation is in hand/driver territory,
  not agent-seam territory.
- **A frame HANDLE in the verb result — REJECTED.** The seam returns values by
  structured clone; a live frame handle would violate that. The verb returns the
  evaluated VALUE, never a frame reference.

## Open questions

1. Frame addressing: CSS selector for the `<iframe>` element (host-frame
   relative) vs a frame name/url match vs an index path (`top/iframe[0]/...`).
   The CSS-selector-of-the-iframe-element form is the most agent-legible; confirm
   it composes for frames nested more than one level (the host frame is itself
   reached via its parent's selector).
2. Same verb (`eval` + optional `frame`) vs a distinct `evalInFrame` verb? Lean:
   extend `eval` (optional field) to avoid a near-duplicate verb.
3. Is this worth doing at all, or does the motivating captcha work belong wholly
   in a HAND (which already has frames)? It is only worth it for the AGENT-driven
   path (Deliverable-1-style: an agent composing built-in verbs to defeat a
   captcha) and only for the same-origin slice. If that path is not a priority,
   defer.

## Provenance

Surfaced 2026-06-28 while driving the iamhuman hand against a live Imperva+hCaptcha
target (DVSA): the agent-facing `eval` could not read the same-origin `#main-iframe`
the captcha lives in. The iamhuman DRIVER does not need this (it has `pwPage`); only
the agent seam does. Pairs with `agent-provided-hand-via-cli-arg` (the richer,
higher-trust answer to `eval`'s limits) as the small same-origin-only counterpart.
Nothing built; pre-PRD.
