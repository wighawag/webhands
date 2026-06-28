---
title: For the `query` ref MINT fallback the MECHANISM is a `data-webhands-ref` ATTRIBUTE, not a page-world `WeakMap<Element,id>` — against REAL React-18 keyed-list and Svelte-4 `{#each}` re-renders the two survive/die on the EXACT same cases (move + kept-node re-render survive; keyed NODE REPLACEMENT kills both), so the WeakMap's hypothesized "survives React attribute-stripping" edge does NOT materialize (React 18 never strips our unknown `data-*` on a kept node), while the attribute is a plain CSS selector the ONE existing resolver resolves and the WeakMap would need a parallel page-world resolve path (ADR-0004 says the ref is ALWAYS a locator string)
slug: query-ref-mint-mechanism-attribute-beats-weakmap
type: finding
status: incubating
source: 'live spike 2026-06-28 (/tmp/ref-spike/spike.mjs + strip-probe.mjs) — real Playwright 1.61.1 Chromium, a REAL React 18 (react/react-dom UMD) keyed `<li key={id}>` list AND a REAL Svelte 4 (4.2.20) compiled keyed `{#each rows as row (row.id)}` component (bundled to an iife with esbuild). A 4-row buy-button list. Per framework, on Charlie''s `<li>` we mint BOTH a `data-webhands-ref` attribute AND a page-world `WeakMap<Element,id>` entry, then drive three real reconciliations and resolve both mechanisms after each: (A) prepend Zeta (DOM MOVE / index drift), (B) re-render that KEEPS Charlie (kept-node attribute-stripping case), (C) change Charlie''s key (keyed NODE REPLACEMENT). strip-probe.mjs additionally hammered 10 mixed re-renders on a kept node. Throwaway; not committed.'
---

## What this settles

The single OPEN DESIGN POINT the prior finding
(`query-minted-dom-ref-is-a-cheap-durable-handle.md`) left for the B task's
opening spike: the minting MECHANISM for ladder step 2 (the fallback for an
anonymous element with no stable unique address) —

> Attribute (`data-webhands-ref`) vs. a page-world `WeakMap<Element,id>` that
> keys on NODE IDENTITY (so it survives the attribute-stripping case React
> causes, though not node REPLACEMENT). The B task MUST open with a spike
> against a real React keyed-list re-render and a Svelte `{#each}` re-render to
> pick the mechanism, the way the A-vs-B spike picked B.

The prior A-vs-B spike tested only a DOM MOVE (a prepend). This spike closes the
two HARDER cases that motivated the question: NODE REPLACEMENT and
ATTRIBUTE-STRIPPING on a KEPT node, against REAL React and REAL Svelte
reconciliation (not a hand-mocked DOM).

## Result (verified)

Per framework, the same mint on Charlie's `<li>`, resolved after each real
reconciliation. `stable` = the framework's OWN attribute (`data-name="Charlie"`,
ladder step 1); `attr` = a minted `data-webhands-ref` (mech 1); `weak` = a
page-world `WeakMap<Element,id>` keyed on node identity (mech 2). Each cell is
the number of currently-attached nodes the handle resolves to (1 = good, 0 =
loud-stale).

| Reconciliation | stable attr (step 1) | minted ATTRIBUTE (mech 1) | WeakMap (mech 2) |
| --- | --- | --- | --- |
| initial | 1 | 1 | 1 |
| **(A) prepend (DOM MOVE / index drift)** | 1 | **1 — rides with the node** | **1** |
| **(B) re-render KEEPING Charlie** (kept-node strip case) | 1 | **1 — React did NOT strip it** | **1** |
| **(C) rekey Charlie (NODE REPLACEMENT)** | 1 | **0 — loud-stale** | **0 — loud-stale** |

IDENTICAL for React 18 keyed and Svelte 4 `{#each}`. And `strip-probe.mjs`
hammered 10 mixed (re-render + prepend) cycles on a KEPT node: the minted
attribute survived all 10 (`survived: true`).

## The decision: ATTRIBUTE (`data-webhands-ref`), not WeakMap

The spike's decisive negative result is that **mech 2 has no advantage over mech
1**. The WeakMap was proposed because it "survives the attribute-stripping case
React causes" — but against REAL React 18 that case DID NOT OCCUR: React never
stripped our unknown `data-webhands-ref` on a node it KEPT (10/10 survived). The
two mechanisms survive and die on the EXACT same boundary:

- both **survive** a DOM move and a kept-node re-render, and
- both **die** on keyed NODE REPLACEMENT — *nothing* survives that (the old node,
  with both our attribute AND its WeakMap entry on it, is detached; the new node
  has neither). The WeakMap keys on the OLD node's identity, so a replaced node
  is a `WeakMap` miss exactly as it is an attribute miss.

Given equal durability, the tie breaks HARD on the seam:

1. **The attribute IS a locator string; the WeakMap is not.** ADR-0004 and the
   prior finding both fix the invariant that *the ref is ALWAYS just a locator
   string resolved through the ONE existing `resolveLocator`*. A minted
   `data-webhands-ref="wrN"` ref resolves as the plain CSS selector
   `[data-webhands-ref="wrN"]` through that same resolver — ZERO new machinery,
   the R1 single-resolver invariant intact. A WeakMap mint would have NO locator
   string to hand back; `click`/`type` would need a PARALLEL page-world resolve
   path (look the id up in the WeakMap in page-world, then act), a second
   addressing scheme the whole design forbids.
2. **Staleness detection is the same machinery as resolving.** Because the ref is
   a selector, resolve-to-ZERO and resolve-to-MANY (a cloned subtree carrying our
   attr) are just `.count()` on the existing locator — the typed `StaleRefError`
   falls out of the resolver, no WeakMap scan needed.
3. **Human-legible + debuggable.** `[data-webhands-ref="wr3"]` is visible in the
   DOM and in a snapshot; a WeakMap entry is invisible.

So the WeakMap buys nothing real and costs a parallel resolver. **Mint a
namespaced `data-webhands-ref` attribute.**

## What the ladder looks like, confirmed

- **Step 1 (reuse a stable unique attribute) is genuinely durable** — the
  framework's OWN `data-name`/`id`/`data-testid` survives ALL three
  reconciliations including node replacement (`stable` = 1 in every row), because
  the framework re-renders it from its vDOM onto the new node. This is why the
  ladder prefers it: minting is only for elements with no stable address, and
  those are exactly where durability matters least.
- **Step 2 (mint a `data-webhands-ref` attribute) is a SHORT-LIVED handle** that
  survives a move and a kept-node re-render but correctly fails LOUD-stale
  (resolve-to-zero) on keyed node replacement and on full-page navigation — the
  honest scope the prior finding already stated, now MEASURED against real
  React/Svelte.

## Consequence for the B task

Mechanism is settled: **attribute mint**. The implementation is the prior
finding's ladder with `data-webhands-ref` as the fallback rung, the ref handed
back as a locator string and resolved (and staleness-detected) through the ONE
existing resolver. No page-world WeakMap, no parallel addressing path. This is a
`## Decisions`-grade choice, not an ADR: it is reversible (the ref is opaque to
the agent — swapping the mint mechanism later does not change the seam) and the
spike removed the trade-off the ADR gate wants (the two mechanisms turned out
equivalent in durability, so there is no live tension to record durably).

## Provenance

Spiked 2026-06-28 as the OPENING spike of the `query-durable-ref-handle` task
(deliverable B / T1b of `broaden-agent-verb-surface`, ## Resolved decisions R4).
Closes the "minting MECHANISM is spike-decided" open point in
`query-minted-dom-ref-is-a-cheap-durable-handle.md`. Pairs with that finding (the
A-vs-B / ladder spike) and the frame spike
`click-and-type-already-frame-scoped-via-framelocator.md`. Spike scripts
`/tmp/ref-spike/spike.mjs` + `/tmp/ref-spike/strip-probe.mjs` (real React 18 UMD +
real Svelte 4 compiled component; throwaway, not committed).
