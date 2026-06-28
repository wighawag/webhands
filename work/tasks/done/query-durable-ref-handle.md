---
title: Durable `query` `ref` handle (stable-attr ladder + mint fallback)
slug: query-durable-ref-handle
prd: broaden-agent-verb-surface
blockedBy: [query-and-state-verbs]
covers: [1]
---

## What to build

The opt-in durable element `ref` for `query`, so an agent can read rows, pick
one, and act on THAT element later even if the list mutates between read and act
(fixing the index-drift footgun where `.nth(i)` silently clicks the wrong row).
The ref is ALWAYS just a locator string resolved through the existing resolver
(no new addressing engine); it is computed per matched element by a PREFERENCE
LADDER (R4):

1. **Reuse a stable, unique EXISTING attribute** when present — priority `id`,
   then `data-testid`/`data-test`/`data-id`, `name`, a link's `href`, a unique
   `aria-label` — PRESENT and VERIFIED-UNIQUE on the page (within its frame). The
   ref IS the real locator (`#buy-charlie`, `[data-testid="x"]`): durable across
   framework reconciliation (the framework keeps its own attrs), legible, ZERO
   DOM mutation.
2. **MINT only as the fallback** for an anonymous element with no stable unique
   address.

Refs are OPT-IN (e.g. a `withRefs` flag / `pw:['ref']`), so the DEFAULT `query`
stays a pure read. `click`/`type` (and the other action verbs) accept a `ref` and
resolve it through the one existing resolver. A ref that resolves to ZERO
elements (node replaced / reloaded) OR to MORE THAN ONE (a cloned subtree) fails
LOUD with a typed `StaleRefError` — NEVER a silent wrong-element action. This is a
SHORT-LIVED handle, not a stable identity (it correctly fails stale across an
intervening re-render or a full-page navigation — Web 1.0 reload sites are covered
by the stale contract, not persisted across).

THIS TASK MUST OPEN WITH A SPIKE (record it as a `work/notes/findings/` note)
before committing the mechanism: validate the ref against a REAL React keyed-list
re-render AND a Svelte `{#each}` re-render, measuring (i) does a reused stable
attribute survive reconciliation (expected yes), (ii) does a minted attribute get
stripped/replaced (expected sometimes), (iii) attribute-mint (`data-webhands-ref`)
vs. a page-world `WeakMap<Element,id>` mint (keys on node identity, so it survives
the attribute-stripping case React causes). Let the SPIKE pick the minting
mechanism — exactly as the A-vs-B spike picked B
(`work/notes/findings/query-minted-dom-ref-is-a-cheap-durable-handle.md`).

## Acceptance criteria

- [ ] A SPIKE (recorded as a finding) validates the ref against a real React
      keyed-list re-render and a Svelte `{#each}` re-render, and the chosen
      minting mechanism is justified by that spike's evidence.
- [ ] `query` (opt-in) returns a `ref` per row; reusing a unique existing
      attribute (id/data-testid/...) when present, minting only as fallback;
      uniqueness is VERIFIED (a duplicate id falls through the ladder).
- [ ] `click`/`type` accept a `ref` and act on the right element AFTER a DOM
      mutation that would break a positional `.nth()` (a fixture that reorders /
      inserts a row between query and act).
- [ ] A stale ref (element removed/replaced) and an ambiguous ref (matches >1)
      BOTH fail with a typed `StaleRefError`; neither silently acts on the wrong
      element.
- [ ] Refs are OPT-IN: the default `query` performs NO DOM write and returns no
      ref. Minted attributes are namespaced and single-`query`-scoped (a new
      `query` supersedes/sweeps prior mints).
- [ ] The `ref` is an additive optional row field and resolves through the ONE
      existing resolver (R1 reversibility shape preserved).
- [ ] Tests cover the ladder, the drift-survival, and the loud-stale failures as
      real-browser + local fixture seam tests (mirror the repo style).
- [ ] Shared-write isolation: profile paths point at per-test temp dirs; the real
      `~/.webhands` is untouched.
- [ ] A changeset is added (`pnpm changeset`).

## Blocked by

- `query-and-state-verbs` — this extends the `query` verb that task introduces
  (same files: the query hand + RPC + CLI), so it is serialized after it.

## Prompt

> Goal: add an opt-in durable `ref` to the `query` verb so an agent can act on a
> previously-read element even after the page mutates, fixing the index-drift
> hazard. This is deliverable B of the prd
> `work/prds/tasked/broaden-agent-verb-surface.md` (read ## Resolved decisions R4)
> and the finding
> `work/notes/findings/query-minted-dom-ref-is-a-cheap-durable-handle.md`.
>
> FIRST check against reality: the `query-and-state-verbs` task must have landed
> (its `query` verb is what you extend). Confirm its options-object signature and
> the single locator resolver are as the prd's R1 invariant requires; if it landed
> differently, route to needs-attention rather than building on a stale premise.
>
> START WITH A SPIKE (and record it as a `work/notes/findings/` note, matching the
> existing finding's style): drive a REAL React keyed-list re-render and a real
> Svelte `{#each}` re-render and measure whether (i) a reused stable attribute
> survives reconciliation, (ii) a minted `data-webhands-ref` attribute gets
> stripped/replaced, (iii) a page-world `WeakMap<Element,id>` mint (keyed on node
> identity) survives the attribute-stripping case. Let THAT evidence pick the
> minting mechanism — do not assume; the prior A-vs-B and frame spikes are the
> model. (The prior ref spike recorded in
> `work/notes/findings/query-minted-dom-ref-is-a-cheap-durable-handle.md` only
> tested a DOM MOVE; node replacement + attribute stripping are the harder cases
> this spike must close.)
>
> Domain vocabulary: a **ref** is a short-lived locator-string handle to a matched
> element. The LADDER: prefer the element's own stable UNIQUE attribute
> (`id`/`data-testid`/`name`/`href`/unique `aria-label`) as the ref; MINT
> (`data-webhands-ref` or WeakMap) only when no stable unique address exists.
> Staleness must be DETECTED (resolve-to-zero OR resolve-to-many => typed
> `StaleRefError`), never silent. Refs are OPT-IN so the default `query` stays a
> pure read.
>
> What "done" means: the spike is recorded and justifies the mechanism; `query`
> opt-in returns refs via the ladder; `click`/`type` resolve a ref and hit the
> right element after a drift a `.nth()` would get wrong; stale/ambiguous refs fail
> loud; default `query` writes nothing; tests + a changeset; profile paths
> isolated to temp. RECORD the minting-mechanism decision as an ADR if it meets the
> ADR gate (hard to reverse + a real trade-off), else as a `## Decisions` note.
