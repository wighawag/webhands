---
title: A `query`-minted DOM attribute ref (`data-webhands-ref`) is a CHEAP, durable, seam-clean cross-call element handle that survives index drift; Playwright's native `aria-ref` does NOT (it is positional/snapshot-scoped)
slug: query-minted-dom-ref-is-a-cheap-durable-handle
type: finding
status: incubating
source: 'live spike 2026-06-28 (/tmp/frame-spike/ref-spike.mjs) — real Playwright 1.61.1 Chromium via @webhands/core dist. A 4-row results list with per-row buy buttons + a prepend() that inserts a new row at the top (index drift). Tested: (A) click by .nth(index) after drift; (B-mech1) query stamps data-webhands-ref + click resolves [data-webhands-ref=..]; (B-mech2) page.ariaSnapshot refs resolved via locator(aria-ref=eN) across calls + after drift. Reproduce: node /tmp/frame-spike/ref-spike.mjs'
---

## What this settles

The PRD `broaden-agent-verb-surface` open question on the ADDRESSING STORY:
the plan was "(A) re-address by locator now, defer the durable-ref (B) addressing
as a future additive." The user asked to SPIKE B first — "maybe it is not that
hard." It is not hard. This finding records the mechanism so B can be specified
as a near-term additive with a known design, not a vague deferral.

## Result (verified)

A results list (4 rows, each a buy button), then `prepend()` inserts a NEW row at
the top between READ and ACT (the index-drift case that motivates B):

| Mechanism | Cross-call? | Survives DOM drift? | Seam-clean (a STRING)? | Verdict |
| --- | --- | --- | --- | --- |
| **A — `locator('li.row button').nth(2)`** | yes | **NO — clicked "Bravo", wanted "Charlie"** | yes | the drift footgun is REAL |
| **B-mech1 — `query` mints `data-webhands-ref="wrN"`; `click` resolves `[data-webhands-ref="wrN"]`** | **YES** | **YES — clicked "Charlie" correctly after drift** | **YES** (plain attribute selector) | **WINNER** |
| B-mech2 — Playwright `aria-ref=eN` (from `ariaSnapshot`) | resolves | **NO — `e1` resolved to the wrong element after drift** | yes | positional/snapshot-scoped; REJECTED |

## The mechanism (B is ~5 lines, not a project)

`query` already iterates the matched elements to build rows. Have it ALSO stamp a
unique attribute on each and return it as the row's `ref`:

```
// inside query, per matched element el at index i:
el.setAttribute('data-webhands-ref', mintedId);   // mintedId unique per query
row.ref = mintedId;
```

`click`/`type` (and any action verb) accept a `ref` and resolve it as the locator
string `[data-webhands-ref="<id>"]` through the EXISTING `resolveLocator` path
(it is just a CSS attribute selector — no new addressing engine). Because the
attribute lives IN THE DOM on the element itself, the handle is:

- **Durable across separate verb calls** (no snapshot scoping; the attribute
  persists until the element is replaced).
- **Robust to index/sibling drift** (a prepend/reorder moves the element but the
  ref rides WITH it — the spike's decisive result).
- **Seam-clean** (a ref is a STRING; resolution is a STRING locator; no
  ElementHandle, no Playwright type crosses the seam — ADR-0003 intact).

## Why Playwright's native `aria-ref` is NOT the answer

`page.ariaSnapshot({mode:'ai'})` emits `[ref=eN]` and `locator('aria-ref=eN')`
resolves them, BUT the refs are assigned by SNAPSHOT TRAVERSAL ORDER and bound to
the last snapshot: after a `prepend()`, `aria-ref=e1` resolved to the now-shifted
element (the wrong one). So aria-ref is fine for "read the snapshot, act
immediately on an unchanged page" (its documented complementary role in
`seam.ts`), but it is NOT a durable handle across a mutation. The minted-attribute
ref is what gives durability.

## Honest caveats / open design points (for the B task, not blockers)

- **Mutating the page.** Stamping an attribute is a (benign, namespaced) DOM
  WRITE. `query` would no longer be purely read-only when refs are requested.
  Mitigation: mint refs ONLY when the caller asks (e.g. `pw:['ref']` or a
  `withRefs` option), so the default `query` stays read-only; and namespace the
  attribute (`data-webhands-ref`) to avoid collisions.
- **Lifetime / GC.** Refs accumulate as attributes across queries. Options: a
  per-query mint prefix so a new `query` supersedes; an optional sweep of old
  `data-webhands-ref` attrs at the next `query`; or just accept they are cheap and
  transient. Decide in the B task.
- **Replaced elements.** If a framework REPLACES the element node (not just
  moves it) on re-render, the ref dies with the old node — a stale ref then
  resolves to nothing and should fail LOUD (a typed "stale ref" error), exactly
  as the repo prefers. This is the correct, detectable failure (vs. A's SILENT
  wrong-element click).
- **Frames.** A ref minted in a same-origin child frame resolves within that
  frame; the B task must say whether the ref carries its frame scope (lean: the
  ref attribute is unique page-wide, so a frame-aware resolve falls out of R1's
  single frame-resolution helper).

## Consequence for the PRD

(A) stays the FIRST deliverable (locator/`.nth()` addressing, already works), but
(B) is now a KNOWN-CHEAP additive, not a hand-wave: a `ref` field on `query` rows
(opt-in, so default `query` stays read-only) + `click`/`type` accepting a ref
resolved as `[data-webhands-ref=..]`. It fits the R1 reversibility shape (an
additive optional field + the one existing resolver) and directly fixes the
index-drift hazard that makes A risky for checkout/captcha. Recommend pulling B
forward from "future" to "a fast-follow task after A", since the cost is low and
the safety gain (no silent wrong-element click) is high for exactly this PRD's
hard targets.

## Provenance

Spiked 2026-06-28 during PRD planning, at the user's request to verify B's
difficulty before deferring it. Pairs with
`click-and-type-already-frame-scoped-via-framelocator.md` (the frame spike). Spike
script `/tmp/frame-spike/ref-spike.mjs` (throwaway; not committed).
