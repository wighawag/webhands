---
title: A distill verb that reduces a just-driven session into a tested hand scaffold
slug: distill-session-into-hand
type: idea
status: incubating
created: 2026-07-01
---

## The opportunity

An agent often burns MANY verb turns EXPLORING an unfamiliar site before it
finally gets a flow working: `goto`, `snapshot`, `click`, a couple of `eval`
probes, a `script` batch, until it reaches the goal (log in, run a search,
complete a checkout). Right now, the moment the session ends, that hard-won
knowledge is THROWN AWAY. The next run re-pays the whole exploration cost from
scratch.

That waste is exactly the token cost a HAND is built to amortize. A hand turns a
known N-turn sub-flow into ONE cheap verb call (the Axis-B "token collapse" story
beside the Axis-A "new capability" one: `evals/SCOREBOARD.md` shows the
webhands agent already partly wins on messy DOMs by not re-deriving lifecycle
boilerplate every run; a hand takes that to the limit by authoring the flow ONCE).
But authoring a hand today means hand-writing a Playwright module after the fact,
re-deriving the selectors and steps the agent ALREADY discovered this session.

The idea: a **`distill`** verb that REDUCES the just-driven session into a
reusable hand. After the agent finally gets the flow working, one `distill` call
emits a starting-point hand module (plus a human-readable notes markdown of
what it saw and why), and can VALIDATE it immediately via the existing `script`
verb against the live page. The result is a tested hand SCAFFOLD the human can
adopt, so the flow the agent explored once becomes a one-call verb forever after.

## The input source: what does `distill` work FROM?

`distill` needs to know what the successful flow WAS. Three sources, layered, in
increasing order of magic and harness-coupling. The design intent is that the
LOW-magic, PORTABLE source is the BACKBONE and the richer ones are enrichments on
top, so `distill` works everywhere and gets better where the environment allows.

- **Backbone (portable, ground-truth) - webhands' OWN verb trace.** The `serve`
  process already SAW every verb the agent issued this session (`goto`,
  `click "<locator>"`, `type`, `script ./flow.js`, ...). If `serve` keeps a
  per-session VERB TRACE, `distill` builds the scaffold from webhands' own record of what
  ACTUALLY drove the page. This needs NO conversation access and NO harness
  coupling, and it is ground-truth (it is what really ran, not a reconstruction).
  This is the source `distill` leans on by default.
- **Enrichment 1 (portable) - an agent-supplied `--summary` string.** The agent
  passes its own recollection / intent as text
  (`npx webhands distill --summary "logged in via #email + #pass, clicked
  .checkout, waited for #confirm"`). Cheap, universal, and it captures INTENT the
  bare verb trace lacks (WHY a step happened, which dead-ends were avoided). Its
  weakness is it is a RECONSTRUCTION (an agent can misremember a selector), which
  is exactly why it enriches the verb-trace backbone rather than replacing it.
- **Enrichment 2 (opt-in, explicit path) - a `--session-file <path>` arg.** When
  the agent CAN read its own transcript, it passes the session file explicitly so
  `distill` can mine the real reasoning + step sequence. This is a PLAIN PATH the
  caller provides (the same file-path-only discipline as `script` and the `--hand`
  idea): webhands reads a file it is handed, it does NOT go discover where some
  harness stores transcripts. HOW the agent OBTAINS that path (whether its harness
  even exposes the transcript) is deliberately OUT of this idea and lives in the
  separate `harness-seam-session-awareness` note; here it is just an optional
  input `distill` accepts when given.

So: the verb trace is the portable backbone; `--summary` and `--session-file`
enrich it. A harness that exposes nothing still gets a useful hand from the trace
+ summary; a richer harness produces a better-annotated one.

## Test it right away with `script` (and where the trust line is)

After `distill` emits a scaffold (e.g. `./hands/checkout.js`), it can IMMEDIATELY
validate it by running the hand's function against the LIVE page through the
existing `script` verb, and checking it returns the expected result, BEFORE the
human ever adopts it. That yields a TESTED scaffold, not a guessed one.

This is safe because it respects the existing trust tiers:

- **Emitting + testing the scaffold stays in the sandboxed tier.** Writing a
  `.js` FILE to disk and validating it via `script` (page-context JS, structured-
  clone-by-value, no persistent Node authority granted to the agent) does NOT
  cross the hand trust line.
- **Adopting it is the human's act.** LOADING the file as a real hand means naming
  it in `hands.json` (ADR-0007: loading a hand == trusting an in-process npm
  dependency). `distill` MUST NOT auto-load what it generated - that is exactly the
  arbitrary-in-process-RCE hazard the `agent-provided-hand-via-cli-arg` idea
  guards. `distill` EMITS and TESTS; the human REVIEWS the file and ADOPTS it.

The safe pipeline end to end:

> explore -> `distill` (emit scaffold + notes, validate via `script`) -> human
> reviews the file -> human names it in `hands.json` -> next run is one cheap call.

## Design sketch (to be pinned in a PRD, not here)

- `distill` inputs: the session VERB TRACE (from `serve`, the backbone), optional
  `--summary <text>`, optional `--session-file <path>`. Omitting the enrichments
  still produces a scaffold from the trace.
- `distill` outputs: (1) a hand MODULE scaffold at a caller-named path (a `Hand`
  in the frozen ADR-0007 shape, closing over `ctx.pwPage`), pre-filled with the
  discovered steps/selectors as a starting point; (2) a human-readable REVIEW
  markdown (what the flow does, the steps, the selectors, the notable
  decisions/dead-ends) so a human can judge it fast.
- `serve` keeps a per-session verb trace to make the backbone possible (scope: how
  much to record - locators, args, results? - is a PRD question; a redaction pass
  matters because traces may contain typed secrets).
- Validation: `distill --test` (or a follow-up) runs the scaffold via `script`
  against the live page and reports pass/fail, so the emitted hand is tested.
- HARD RULE: `distill` never adds to `hands.json` and never loads the module. Emit
  + test only; adoption is a separate, human, operator-scoped act.

## Rejected / out of scope

- **Auto-loading the generated hand - REJECTED.** Crosses the ADR-0007 trust line
  (arbitrary in-process Node the operator did not name). Adoption stays a human
  act. This is the load-bearing safety property.
- **webhands discovering the transcript location itself - OUT (separate note).**
  Knowing where Claude Code / Cursor / pi / an MCP client stores a session is
  harness-specific; baking it into webhands core would couple the tool to every
  harness. `distill` accepts a `--session-file` PATH it is handed; producing that
  path is the `harness-seam-session-awareness` idea's job, optional and graceful.
- **A perfect, ready-to-ship hand - NOT the goal.** `distill` emits a SCAFFOLD (a
  strong starting point from real steps), not a guaranteed-correct module. The
  `script` test raises confidence; the human still reviews.

## Open questions

1. What exactly does the `serve` verb trace record, and how is it REDACTED? A
   trace of a login flow contains typed credentials; the distilled scaffold and
   the notes markdown must not leak secrets. (Likely a PRD-level decision with an
   ADR for the redaction contract.)
2. Is `distill` one verb with flags (`--summary`, `--session-file`, `--test`,
   `--out`) or a small family? Lean: one verb, flagged, mirroring `script`'s
   single-source simplicity.
3. Does `distill` target the WHOLE session or a caller-named SLICE (e.g. "just the
   checkout sub-flow, not the earlier failed probes")? The verb trace makes a
   slice possible; the agent likely knows the sub-flow boundaries.
4. How much of the hand does `distill` actually write vs leave as TODO? A faithful
   replay of the verb trace is mechanical; turning it into a PARAMETERIZED hand
   (e.g. checkout(itemId)) needs the agent's intent (the `--summary`/session-file
   enrichment), and may be left as annotated TODOs for the human.
5. Relationship to `--hand`/`allowAgentHands` (the `agent-provided-hand-via-cli-arg`
   idea): `distill` is the AUTHORING half (emit+test a scaffold), that idea is the
   LOADING half (an operator-gated way to name a hand at runtime). They compose;
   confirm the boundary so neither smuggles auto-load.

## Provenance

Surfaced in conversation 2026-07-01 while reworking the hands story in the README
+ scoreboard (the Axis-A new-capability / Axis-B token-collapse framing). The
observation: after an agent finally drives a flow to success, that knowledge is
discarded, yet it is exactly what a token-collapsing hand should encode - so a
`distill` verb that distills the just-driven session into a tested hand
scaffold is the cheap authoring path. Pairs with
`agent-provided-hand-via-cli-arg` (the loading/trust half) and
`harness-seam-session-awareness` (the optional transcript-source half). Nothing
built; pre-PRD.
