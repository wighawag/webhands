---
title: distill verb emits a hand scaffold + notes from the session (never loads it)
slug: distill-verb-emits-hand-scaffold
prd: distill-session-into-hand
blockedBy: [serve-session-verb-trace]
covers: [1, 2, 3, 4, 6, 10, 11, 12]
---

## What to build

The `distill` verb: reduce the just-driven session into a reusable HAND SCAFFOLD
plus a human-readable NOTES markdown, so a flow the agent explored once becomes a
one-call verb after a human adopts it. This is the authoring half of the prd;
validation (running the scaffold via `script`) is a SEPARATE task.

Behaviour (thin end-to-end path):

- **Input, layered.** The BACKBONE is the in-memory session verb trace (from
  `serve-session-verb-trace`). Two optional enrichments, both plain inputs webhands
  is HANDED (never discovered): `--summary <text>` (the agent's intent /
  recollection, captures WHY steps happened) and `--session-file <path>` (a plain
  path to a transcript the agent can already reach; webhands reads the file it is
  given, it does NOT go find where a harness stores sessions). With no
  enrichments, a useful scaffold still comes from the trace alone.
- **Slice.** Support crystallizing a caller-named SLICE of the session (e.g.
  `--from`/`--to` over the trace, exact flag shape your call) so the hand encodes
  the sub-flow that matters, not the earlier failed probes. Default: the whole
  session.
- **Output.** (1) A hand MODULE scaffold at a caller-named path (`--out <path>`),
  a `Hand` in the FROZEN ADR-0007 shape (closing over `ctx.pwPage`), pre-filled as
  a FAITHFUL REPLAY of the discovered steps; parameterization (e.g.
  `checkout(itemId)`) is left as annotated TODOs informed by the enrichments, NOT
  auto-invented. (2) A human-readable NOTES markdown: what the flow does, its
  steps, the selectors used, notable decisions/dead-ends, so a human can judge it
  fast.
- **One flagged verb.** `distill` with `--summary`, `--session-file`, `--out`, the
  slice selector (and a `--test` flag reserved for the NEXT task; you may accept +
  ignore it or leave it unimplemented, but do not build validation here). Mirror
  `script`'s single-source simplicity, not a verb family.

**HARD INVARIANT (load-bearing safety):** `distill` NEVER writes `hands.json` and
NEVER `import()`s the module. It EMITS and (next task) TESTS only; ADOPTING a hand
(naming it in `hands.json`) stays the human's explicit, operator-scoped trust act
(ADR-0007: loading a hand == trusting an in-process npm dependency). Auto-loading
is exactly the arbitrary-in-process-code hazard this prd refuses.

## Acceptance criteria

- [ ] Given a recorded verb trace (use a fixture trace, or drive a served session),
      `distill --out <path>` emits a `Hand`-shaped module whose replay drives the
      SAME steps in order.
- [ ] `distill` also emits a human-readable notes markdown listing the flow's steps
      / selectors / decisions.
- [ ] `--summary <text>` and `--session-file <path>` are accepted as OPTIONAL
      enrichments; omitting both still yields a scaffold from the trace alone.
- [ ] `--session-file` reads a plain path it is HANDED and does not attempt to
      discover a transcript location (out of scope by contract).
- [ ] A caller-named SLICE crystallizes only that sub-flow (default = whole
      session).
- [ ] The emitted module is a valid ADR-0007 `Hand` (closing over `ctx.pwPage`) so
      it drops into the existing loading path once a human adopts it.
- [ ] **The trust invariant is a TEST:** `distill` does NOT add to `hands.json` and
      does NOT load/`import()` the module (assert no config write, no import),
      mirroring the existing explicit-declarative hand-loading tests.
- [ ] Tests cover the emit behaviour + the trust invariant (mirror the repo's
      existing verb/CLI + hand-loading test style); reuse an eval fixture flow
      (saucedemo / parabank / the local dynamic or messy-DOM fixture) as a realistic
      sub-flow to crystallize where practical.
- [ ] **Shared/global write isolation:** `distill` writes files (the scaffold +
      notes), tests must write them to a TEMP/scratch dir (via `--out`) and assert
      no write to any real home/config location and specifically NOT to
      `hands.json`.

## Blocked by

- `serve-session-verb-trace`, `distill` reads the session verb trace that task
  produces.

## Prompt

> Build the `distill` verb: reduce a just-driven webhands session into a reusable
> HAND scaffold (frozen ADR-0007 `Hand` shape) plus a human-readable notes
> markdown, from the in-memory session verb trace, optionally enriched by
> `--summary` / `--session-file`. It EMITS and does NOT load. See the prd
> `work/prds/tasked/distill-session-into-hand.md`.
>
> FIRST, check against reality (launch snapshot, may have DRIFTED): confirm the
> session verb-trace accessor from `serve-session-verb-trace` landed as assumed
> (in `work/tasks/done/`), and re-read the FROZEN `Hand` / `HandContext` contract
> (ADR-0007) so the emitted module matches it exactly. If the trace or the Hand
> contract differs from what this task assumes, route to needs-attention rather than
> building on the stale premise.
>
> Domain vocabulary: a **hand** is a capability module closing over `ctx.pwPage`
> that contributes verbs (ADR-0007); ADOPTING one means the operator NAMES it in
> `hands.json` (the trust act). The verb TRACE is the ground-truth backbone. A
> `--session-file` is a plain path webhands is HANDED (transcript DISCOVERY is out
> of scope, it belongs to the `harness-seam-session-awareness` idea, not here).
>
> Seams to test at: given a trace fixture, does the emitted module replay the same
> steps? Is it a valid `Hand`? THE TRUST INVARIANT IS A TEST, assert `distill`
> writes NO `hands.json` and never `import()`s the module. Write scaffold/notes to
> a temp `--out` dir in tests and assert real locations are untouched.
>
> Do NOT build `--test` validation here (that is the next task,
> `distill-test-validates-scaffold-via-script`); you may reserve the flag but leave
> validation to that task.
>
> RECORD non-obvious in-scope decisions (the slice flag shape, how much of the hand
> is written vs left as TODO, the notes-markdown format) in a `## Decisions` note or
> an ADR if it meets the gate.
>
> Every change requires a changeset (`pnpm changeset`).
