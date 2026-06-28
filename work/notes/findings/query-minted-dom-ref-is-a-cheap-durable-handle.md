---
title: A `query` element `ref` (REUSE a stable unique attribute like `id`/`data-testid` when present, MINT `data-webhands-ref` as fallback) is a cheap, seam-clean cross-call handle that survives index drift; it is a SHORT-LIVED handle that fails LOUD-stale on node replacement/attribute-stripping (React/Svelte reconciliation) — strictly safer than `.nth()`'s silent mis-click. Playwright's native `aria-ref` does NOT survive drift (positional/snapshot-scoped)
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

## The mechanism — a PREFERENCE LADDER, not always a mint

`query` already iterates the matched elements to build rows. Per element it
computes a `ref` by a LADDER (the ref is always just a locator string):

1. **Reuse a stable, unique EXISTING attribute** when present — priority `id`,
   then `data-testid`/`data-test`/`data-id`, `name`, a link's `href`, a unique
   `aria-label` — PRESENT and VERIFIED-UNIQUE on the page (within its frame). The
   ref IS the real locator (`#buy-charlie`, `[data-testid="x"]`): durable across
   framework reconciliation (the framework keeps its own meaningful attrs),
   human-legible, ZERO DOM mutation.
2. **MINT only as the fallback** for an anonymous element with no stable unique
   address:

```
// fallback only, per anonymous matched element:
el.setAttribute('data-webhands-ref', mintedId);   // namespaced, unique per query
row.ref = mintedId;
```

`click`/`type` (and any action verb) accept a `ref` and resolve it as a locator
string (`#buy-charlie` or `[data-webhands-ref="<id>"]`) through the EXISTING
`resolveLocator` path (a CSS selector — no new addressing engine). The handle is:

- **Durable across separate verb calls** (no snapshot scoping).
- **Robust to index/sibling drift** (a prepend/reorder moves the element but the
  ref rides WITH it — the spike's decisive result, for the MOVE case).
- **Seam-clean** (a ref is a STRING; resolution is a STRING locator; no
  ElementHandle, no Playwright type crosses the seam — ADR-0003 intact).

The ladder shrinks minting to exactly the elements that had no stable address —
which are also the ones where a durable identity matters least.

## Why Playwright's native `aria-ref` is NOT the answer

`page.ariaSnapshot({mode:'ai'})` emits `[ref=eN]` and `locator('aria-ref=eN')`
resolves them, BUT the refs are assigned by SNAPSHOT TRAVERSAL ORDER and bound to
the last snapshot: after a `prepend()`, `aria-ref=e1` resolved to the now-shifted
element (the wrong one). So aria-ref is fine for "read the snapshot, act
immediately on an unchanged page" (its documented complementary role in
`seam.ts`), but it is NOT a durable handle across a mutation. The minted-attribute
ref is what gives durability.

## The honest durability scope (folded in after the React/Svelte question)

The spike tested only a DOM MOVE (a `prepend` reorder). On a modern SPA the
MINTED fallback (ladder step 2) faces two harder cases the spike did NOT cover,
and both are EXPECTED, not edge:

- **Node replacement.** React keyed-list reconciliation and Svelte
  `{#each}`/`{#if}`/`{#await}` re-CREATE DOM nodes on data change. A minted attr
  lives on the OLD node and dies with it; the new node lacks it.
- **Attribute stripping on a kept node.** React's virtual DOM is the source of
  truth; on a re-render it can WIPE an unknown attribute we stamped even on a
  node it keeps, because our attr is not in its vDOM.

Why this is acceptable, not fatal:

- **Ladder step 1 sidesteps both** — a reused `id`/`data-testid` is the
  framework's OWN attribute, preserved across reconciliation. Minting is only the
  fallback for elements that never had a stable address.
- **Staleness is DETECTED, never silent.** A ref resolving to ZERO elements is
  stale; a ref resolving to MORE THAN ONE (a cloned subtree carrying our attr) is
  also an error, never "pick the first". Both surface as a typed `StaleRefError`.
  A loud-stale handle is STRICTLY SAFER than A's SILENT wrong-element click: the
  agent is told "re-`query`, the page changed" — its natural loop anyway.
- **A minted ref is a SHORT-LIVED handle, not a stable identity.** It is valid
  for the dominant read → immediately-act pattern; across an intervening
  re-render it correctly fails stale.

**Web 1.0 / full-page-reload sites are covered BY this contract, not a gap.** A
navigation destroys the document and every ref; the next `query` re-mints against
the fresh DOM. A ref never survives a reload, and resolve-to-zero → `StaleRefError`
→ the agent re-`query`s — exactly the act → reload → re-read loop such a site
already forces. We deliberately do NOT persist refs across navigation.

## Open design points (for the B task / its opening spike, not blockers)

- **Minting MECHANISM is spike-decided.** Attribute (`data-webhands-ref`) vs. a
  page-world `WeakMap<Element,id>` that keys on NODE IDENTITY (so it survives the
  attribute-stripping case React causes, though not node REPLACEMENT — nothing
  does). The B task MUST open with a spike against a real React keyed-list
  re-render and a Svelte `{#each}` re-render to pick the mechanism, the way the
  A-vs-B spike picked B.
- **Read-only preserved.** Refs/mints happen ONLY when the caller asks
  (`withRefs`/`pw:['ref']`); default `query` stays a pure read. Minted attrs are
  namespaced and single-`query`-scoped (a fresh `query` supersedes/sweeps prior
  mints).
- **Uniqueness verification.** Ladder step 1 only uses an attribute that is
  verified UNIQUE on the page (within its frame); a duplicate `id`/`data-testid`
  falls through to the next rung or to minting.
- **Frames.** A ref resolves within its frame; a frame-aware resolve falls out of
  R1's single frame-resolution helper (the ref id is unique page-wide).

## Consequence for the PRD

(A) stays the FIRST deliverable (locator/`.nth()` addressing, already works), but
(B) is now a KNOWN-CHEAP additive, not a hand-wave: a `ref` field on `query` rows
(opt-in, so default `query` stays read-only) computed by the LADDER (reuse a
stable unique attribute; mint as fallback) + `click`/`type` accepting a ref
resolved as a locator string. It fits the R1 reversibility shape (an additive
optional field + the one existing resolver) and fixes the index-drift hazard that
makes A risky for checkout/captcha. The honest scope: it is a SHORT-LIVED handle
that fails LOUD-stale (never silent-wrong) on SPA reconciliation and full-page
reloads. Recommend pulling B forward to a fast-follow task (T1b) that OPENS WITH A
SPIKE against real React/Svelte re-renders to pick the minting mechanism — the
cost is low and the safety gain (no silent wrong-element click) is high for
exactly this PRD's hard targets.

## Provenance

Spiked 2026-06-28 during PRD planning, at the user's request to verify B's
difficulty before deferring it. Pairs with
`click-and-type-already-frame-scoped-via-framelocator.md` (the frame spike). Spike
script `/tmp/frame-spike/ref-spike.mjs` (throwaway; not committed).
