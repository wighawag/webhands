---
title: Make `snapshot`'s `[ref=eN]` directly actionable (close the read->act gap between the snapshot ref and the `--by-ref` handle)
slug: snapshot-ref-actionable-unify-with-by-ref
blockedBy: []
covers: []
---

## What to build

Close the highest-leverage API-surface gap the scoreboard transcripts exposed
(finding
`work/notes/findings/scoreboard-api-friction-from-transcripts-ref-collision-and-page-prefix.md`):
`snapshot` shows the agent elements tagged `[ref=e1]`, `[ref=e2]`..., the agent
naturally tries to ACT on `[ref=e3]`, but the action verbs do not accept a
snapshot ref, so it falls back to `eval` + `querySelectorAll` to rediscover real
selectors. Two different "ref" concepts are surfaced under the same word, and only
one is actionable:

- `snapshot`'s `[ref=eN]` — from Playwright's native `ariaSnapshot({mode:'ai'})`;
  resolvable ONLY via Playwright's `aria-ref=` locator engine
  (`page.locator('aria-ref=eN')`), which nothing tells the agent.
- `query --with-refs`' `ref` + `click/type --by-ref` — a SEPARATE mechanism that
  mints/reuses a `data-webhands-ref` attribute and resolves via CSS.

Make "read the page with `snapshot`, then act on what you read" ONE coherent loop,
with no detour through `query --with-refs` or `eval`.

**SETTLE FIRST (the design fork, resolve before building):** how to make the
snapshot ref actionable. Options to weigh (a short spike to confirm Playwright
behaviour is warranted):

- **(A) Teach the action verbs to accept the snapshot `aria-ref=eN`.** Since
  `resolveLocator` evaluates `page.<expr>` (`packages/core/src/hand-host.ts`), an
  agent could ALREADY write `page.locator('aria-ref=eN')` to act on a snapshot ref
  (Playwright supports the `aria-ref=` engine). The minimal fix may be: document
  this, AND/OR let `click/type --by-ref` accept a bare `eN` / `aria-ref=eN` and
  resolve it via `aria-ref=`. This makes the snapshot ref first-class actionable
  with the SAME `--by-ref` flag the durable ref uses.
- **(B) Make `snapshot` (optionally) emit the durable `data-webhands-ref` refs**
  the `--by-ref` path already understands, so the snapshot ref IS the durable ref.
  Heavier (mutates the page to mint attrs during a read; weigh against snapshot
  being a pure read).
- **(C) Docs-only disambiguation** (cheapest, lowest value): snapshot output + docs
  state loudly that `[ref=eN]` is NOT a `--by-ref` handle and show
  `page.locator('aria-ref=eN')` as the way to act on it, and point at
  `query --with-refs` for the durable path.

NOTE the durability difference and PRESERVE the `--by-ref` safety contract: the
`query` durable ref deliberately survives list mutation and asserts
resolves-to-exactly-one (`assertRefResolvesToOne`, `StaleRefError`); a snapshot
`aria-ref=eN` is positional/snapshot-scoped and can go stale after a DOM change.
Whatever option is chosen must NOT silently regress the durable ref's
stale/ambiguous-fails-loud guarantee, and should be honest about a snapshot ref's
weaker durability (it is a "act on what I just saw" handle, not a survive-mutation
one). RECORD which option was taken and why.

End-to-end vertical slice (shape depends on the chosen option):

- The actionable-snapshot-ref mechanism in `packages/core` (the verbs + resolver),
  staying within ADR-0003 (the ref crosses the seam as an opaque string; no
  Playwright type leaks) and ADR-0004 (locator-expression addressing).
- The CLI surface: whatever flag/arg lets the agent act on a snapshot ref (reuse
  `--by-ref` if option A; a documented locator form at minimum).
- `snapshot`'s output and/or help makes the actionable path OBVIOUS (the read->act
  loop is the point).
- Real unit coverage in `packages/core`/`packages/cli`: snapshot a fixture, take a
  `[ref=eN]`, act on it via the new path, assert it hit the right element; a stale
  snapshot ref after a DOM change fails loud (or is documented as snapshot-scoped);
  the durable `query --by-ref` path is UNCHANGED and still passes.
- Docs: `--help`, `--llms-full`, and a `use-webhands` skill note showing the
  read-then-act loop with a snapshot ref. A changeset.

This is a webhands VERB-SURFACE change (gated packages). The eval harness is where
to MEASURE the win afterwards (a cold-vs-fixed `--compare` should cut the
`eval`-fallback round-trips), but that re-measurement is a FOLLOW-UP, not this task.

## Acceptance criteria

- [ ] A `[ref=eN]` from `snapshot` is DIRECTLY actionable by `click`/`type` (no
      detour through `eval`/`querySelectorAll` or a separate `query` just to act on
      what the snapshot already showed); the chosen mechanism is recorded.
- [ ] The existing `query --with-refs` + `click/type --by-ref` durable-ref path is
      UNCHANGED and its stale/ambiguous-fails-loud safety
      (`assertRefResolvesToOne`/`StaleRefError`) still holds.
- [ ] The durability difference is honest: a snapshot ref is documented as a
      "act on what I just saw" handle (snapshot-scoped), distinct from the durable
      `query` ref that survives list mutation; neither silently does the other's job.
- [ ] Stays within ADR-0003 (ref crosses the seam as an opaque string, no
      Playwright type leak) and ADR-0004 (locator addressing); the verb doc records
      the choice. NOTE: ADR-0004 explicitly considered + REJECTED "CSS selector +
      snapshot ref-ids only" as the addressing model ("forces a snapshot round-trip
      ... cannot express compound/positional locators"); making the snapshot ref
      ACTIONABLE revisits that boundary, so record the decision in a short ADR (or
      an explicit ADR-0004 amendment), like `script` got ADR-0012. The point here
      is ADD an actionable snapshot ref ALONGSIDE the locator grammar, not replace
      it, state that relationship to ADR-0004.
- [ ] Real unit coverage in `packages/core`/`packages/cli` (snapshot -> act on its
      ref hits the right element; durable `--by-ref` path still green). `pnpm test`
      stays green.
- [ ] Docs updated: `--help`, `--llms-full`, a `use-webhands` read->act note; a
      changeset is added.

## Blocked by

- None. Builds on `snapshot` (`ariaSnapshot`), the durable-ref work
  (`tasks/done/query-durable-ref-handle.md`), and `resolveLocator`.

## Prompt

> Goal: make `snapshot`'s `[ref=eN]` DIRECTLY actionable so "read the page with
> `snapshot`, then act on what you read" is ONE loop, closing the gap the scoreboard
> transcripts exposed (finding
> `work/notes/findings/scoreboard-api-friction-from-transcripts-ref-collision-and-page-prefix.md`:
> the agent reads a snapshot ref, can't act on it, and falls back to
> `eval`/`querySelectorAll`). Today two different "ref" concepts share the word: the
> snapshot `[ref=eN]` (Playwright `ariaSnapshot`/`aria-ref=` engine) and the durable
> `query --with-refs` ref + `click/type --by-ref` (`data-webhands-ref`/CSS). Only the
> latter is actionable.
>
> READ FIRST: `packages/core/src/hand-host.ts` (the `snapshot` hand calling
> `pwPage.ariaSnapshot({mode:'ai'})` -> `[ref=eN]`; `resolveLocator` doing
> `new Function('page','p','return ('+expr+')')` so `page.locator('aria-ref=eN')`
> already resolves; the `interactionHand` `--by-ref` path + `assertRefResolvesToOne`
> + `StaleRefError`; the `query` ref minting `data-webhands-ref`); ADR-0003 (seam:
> no Playwright type crosses the wire), ADR-0004 (locator-expression addressing);
> `tasks/done/query-durable-ref-handle.md`.
>
> KEY DESIGN POINTS: SETTLE the fork FIRST (spike if needed): (A) accept the
> snapshot `aria-ref=eN` in the action verbs (reuse `--by-ref`; an agent can already
> write `page.locator('aria-ref=eN')`, so this may be mostly wiring + docs); (B)
> make `snapshot` emit the durable `data-webhands-ref` refs (heavier, mutates on a
> read); or (C) docs-only disambiguation (cheapest). PRESERVE the durable
> `--by-ref` safety (stale/ambiguous fails loud) and be HONEST that a snapshot ref
> is snapshot-scoped (weaker durability than the `query` ref), do not let one
> silently do the other's job. Stay in ADR-0003 (opaque-string ref over the seam)
> and ADR-0004. Real unit coverage (snapshot -> act on its ref hits the right
> element; durable path unchanged + still fails loud on stale/ambiguous). Update
> --help/--llms-full and a use-webhands read->act note. Add a changeset. RECORD the
> chosen option + why.
>
> What "done" means: an agent can `snapshot`, see `[ref=eN]`, and `click`/`type` it
> directly (recorded mechanism); the durable `query --by-ref` path and its
> fail-loud safety are unchanged; the durability distinction is documented;
> ADR-0003/0004 hold; gated packages green; docs + a skill note show the read->act
> loop.
>
> FIRST, check against current reality: confirm `snapshot` still emits `[ref=eN]`
> via `ariaSnapshot`, `resolveLocator` still evaluates `page.<expr>`, and the
> `--by-ref`/`StaleRefError` path is as described (they may have evolved); reconcile
> rather than duplicate. RECORD the non-obvious decisions (the chosen option, the
> exact actionable-ref syntax, the durability framing, the ADR-0004 implication).
>
> FOLLOW-UP (NOT this task): re-measure on the scoreboard (cold-vs-fixed `--compare`)
> to quantify the cut in `eval`-fallback round-trips. Leave/file that as a follow-up.
