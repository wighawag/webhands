---
title: review, crystallize a just-driven session into a tested hand scaffold
slug: review-crystallizes-session-into-hand
humanOnly: true
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
  While the spec has unresolved questions blocking autonomous tasking:
    1. Set `needsAnswers: true` in the frontmatter above.
    2. List the questions under the `## Open questions` heading below.
    3. Clear the flag (and let apply strip this block) once they are answered.
  Delete the whole fenced block — markers and all — if the prd launches fully resolved.
-->

## Open questions

1. **The verb-trace redaction contract (the one blocking decision).** The
   `serve` verb trace that backs `review` will contain what the agent TYPED,
   including credentials (a login flow types a password), and possibly returned
   page content. Both the emitted hand scaffold and the human-readable review
   markdown must NOT leak secrets. What is the redaction policy: redact `type`
   values into named placeholders by default (e.g. `type <secret:0>` with the
   scaffold referencing a `process.env` / config lookup)? Redact everything by
   default and require an explicit opt-in to include literal values? Where is the
   contract recorded (an ADR)? This is a security decision a human must make; it
   gates tasking because getting it wrong writes secrets to disk.
2. **Trace persistence + lifetime.** Does the `serve` verb trace live only in the
   running `serve` process memory (so `review` must run in the SAME session), or
   is it persisted to the profile dir (surviving `stop`), and if persisted, what
   is its retention / cleanup and does that widen the secret-at-rest surface from
   Q1? Lean: in-memory for the live session is the minimal safe default; persistence
   is a separate, later opt-in. Confirm before tasking, since it interacts with Q1.

<!-- /open-questions -->

## Problem Statement

An agent frequently burns many verb turns EXPLORING an unfamiliar site before a
flow finally works: `goto`, `snapshot`, a few `eval` probes, `click`, a `script`
batch, until it reaches the goal (log in, run a search, complete a checkout). The
moment the session ends, that hard-won knowledge is THROWN AWAY. The next run
re-pays the entire exploration cost from scratch.

That recurring waste is exactly what a **hand** exists to remove: a hand turns a
known N-turn sub-flow into ONE cheap verb call (the "token collapse" axis in
`evals/SCOREBOARD.md` and the README hands story). But TODAY, authoring that hand
means hand-writing a Playwright module after the fact, re-deriving the very
selectors and steps the agent ALREADY discovered live this session. There is no
path from "the agent just made this flow work" to "a reusable hand," so the
cheapest possible authoring moment (right after success, with the working steps
fresh and real) is lost.

## Solution

Add a **`review`** verb that CRYSTALLIZES the just-driven session into a reusable
hand SCAFFOLD, and can validate it immediately, so the flow an agent explored once
becomes a one-call verb thereafter.

**What `review` produces:**

- A **hand module scaffold** at a caller-named path (a `Hand` in the frozen
  ADR-0007 shape, closing over `ctx.pwPage`), pre-filled from the discovered steps
  as a strong starting point (not a guaranteed-correct module).
- A **human-readable review markdown**: what the flow does, its steps, the
  selectors used, and notable decisions/dead-ends, so a human can judge it fast.

**What `review` crystallizes FROM (layered, portable backbone first):**

- **Backbone: webhands' own verb trace (portable, ground-truth).** `serve`
  records every verb the agent issued this session (`goto`, `click "<locator>"`,
  `type`, `script ./flow.js`, ...). `review` builds the scaffold from what
  ACTUALLY drove the page. No conversation access, no harness coupling; it is what
  really ran, not a reconstruction. This is the default source.
- **Enrichment, `--summary <text>` (portable).** The agent passes its own
  intent/recollection as text, capturing WHY steps happened (which the bare trace
  lacks). A reconstruction, so it enriches rather than replaces the trace.
- **Enrichment, `--session-file <path>` (opt-in, explicit path).** When the
  agent can reach its own transcript, it passes the file so `review` can mine the
  real reasoning. A PLAIN path webhands is HANDED (the file-path-only discipline of
  `script`); webhands never DISCOVERS where a harness stores transcripts. Producing
  that path is the separate `harness-seam-session-awareness` idea's job, optional
  and graceful; here it is just an input `review` accepts when given.

**Test it right away, adopt by hand (the trust line):**

- `review` can VALIDATE the emitted scaffold by running it against the LIVE page
  through the EXISTING `script` verb and reporting pass/fail, BEFORE any adoption.
  That yields a tested scaffold, and it stays in the sandboxed page-context tier
  (writing a `.js` file + running it via `script` grants the agent no persistent
  Node authority).
- **`review` NEVER loads the hand.** Adopting means the HUMAN names it in
  `hands.json` (ADR-0007: loading a hand == trusting an in-process npm dependency).
  `review` emits and tests; the human reviews the file and adopts. Auto-loading is
  the load-bearing thing this PRD refuses (it is the arbitrary-in-process-RCE
  hazard the `agent-provided-hand-via-cli-arg` idea guards).

**The pipeline:** explore → `review` (emit scaffold + notes, validate via
`script`) → human reviews the file → human names it in `hands.json` → next run is
one cheap call.

This **refines ADR-0007 and ADR-0012, does not discard them.** ADR-0012's `script`
(file-path-only, driver-context) is reused verbatim as the VALIDATION mechanism.
ADR-0007's explicit, operator-scoped hand-loading is preserved exactly: `review`
authors a candidate, the operator still performs the trust act. A new ADR records
the verb-trace + redaction contract (Open question #1).

## User Stories

1. As an agent that just made a flow work after much exploration, I want one
   `review` call to turn that session into a reusable hand scaffold, so the flow
   is not thrown away and the next run is a single cheap call.
2. As an agent, I want `review` to build the scaffold from webhands' OWN verb
   trace by default, so it works with no harness support and reflects what really
   drove the page (not my possibly-faulty recollection).
3. As an agent, I want to pass a `--summary` of my intent, so the scaffold and its
   notes capture WHY steps happened, not just the mechanical step list.
4. As an agent whose harness exposes my transcript, I want to pass it via
   `--session-file <path>`, so `review` can mine the real reasoning; and where my
   harness cannot, I want `review` to still produce a useful hand from the trace.
5. As an agent, I want `review` to VALIDATE the scaffold against the live page via
   `script` and tell me pass/fail, so I hand the human a TESTED starting point,
   not a guess.
6. As a human operator, I want `review` to EMIT a hand file + a readable review
   markdown but NEVER load it, so adopting a hand stays my explicit, operator-scoped
   trust act (I name it in `hands.json`).
7. As a security-conscious operator, I want the verb trace and the emitted scaffold
   to REDACT secrets I typed (credentials), so crystallizing a login flow does not
   write my password to disk.
8. As an agent, I want to crystallize a caller-named SLICE of the session (the
   checkout sub-flow, not the earlier failed probes), so the hand encodes the
   flow that matters, not the whole noisy transcript.
9. As a hand author, I want the emitted scaffold in the frozen `Hand`/`HandContext`
   shape (closing over `ctx.pwPage`), so it drops into the existing loading path
   with no new mechanism once I adopt it.
10. As a maintainer, I want `review` to be ONE flagged verb (mirroring `script`'s
    single-source simplicity), so the surface stays small.

### Autonomy notes

- **`humanOnly: true` (DECIDED).** A human must drive the TASKING of this PRD. It
  introduces a security-sensitive surface: a verb trace that captures typed
  secrets, an emitted-code path adjacent to the hand trust tier, and a redaction
  contract. A human should own the decomposition and the ADR scope, even though
  the resulting tasks may themselves be agent-buildable. (This does NOT propagate
  to the tasks' own gates.)
- **`needsAnswers: true` (DISCOVERED).** The redaction contract (Open question #1)
  and trace lifetime (#2) are unresolved SECURITY decisions that must be settled
  before tasking; a wrong default writes secrets to disk. The auto-tasker must
  refuse until they are answered and the flag cleared.

## Implementation Decisions

Decided at launch (to seed tasking; trimmed into tasks/ADRs at `to-task`):

- **One flagged verb.** `review` with `--summary <text>`, `--session-file <path>`,
  `--out <path>` (scaffold destination), `--test` (validate via `script`), and a
  SLICE selector (e.g. `--from`/`--to` over the trace, exact form a task detail).
  Not a verb family. Mirrors `script`'s single-source shape.
- **Verb trace lives in `serve`.** The controller records the session's verbs
  (verb name, locator/args, and enough result shape to reconstruct steps). Scope
  and redaction are Open questions #1/#2; the DEFAULT bias is in-memory for the
  live session and redact-typed-values, pending the human decision.
- **Scaffold shape = frozen ADR-0007 `Hand`.** The emitted module exports a `Hand`
  closing over `ctx.pwPage`, so adoption needs no new loading mechanism.
- **Faithful replay + annotated TODOs.** `review` writes a faithful replay of the
  discovered steps; turning it into a PARAMETERIZED hand (e.g. `checkout(itemId)`)
  is left as annotated TODOs informed by `--summary`/`--session-file`, not
  auto-invented.
- **Validation reuses `script` (ADR-0012) verbatim.** No new execution surface;
  `--test` runs the scaffold as a driver-context script against the live page.
- **HARD INVARIANT: `review` never writes `hands.json` and never `import()`s the
  module.** Emit + test only. Adoption is the human's operator-scoped act.

## Testing Decisions

- Behaviour, not internals: given a recorded verb trace (a fixture), `review`
  emits a `Hand`-shaped module whose replay drives the SAME steps, and a review
  markdown listing them.
- The trust invariant is a TEST: `review` must not add to `hands.json` nor load
  the module (assert no config write, no `import()`), mirroring how the existing
  hand-loading tests assert explicit-declarative loading.
- The redaction contract (once decided) gets a test: a trace containing a typed
  secret produces a scaffold + notes with the secret REDACTED (a placeholder), not
  the literal.
- `--test` validation: a scaffold that replays correctly reports PASS against the
  live page; a broken one reports FAIL loudly (reusing `script`'s error path).
- Reuse the eval fixtures (`saucedemo`/`parabank`/the local dynamic + messy-DOM
  fixtures) as realistic flows to crystallize, so the emitted hand is exercised on
  a real sub-flow, not a toy.

## Out of Scope

- **webhands discovering the transcript location itself.** Where Claude Code /
  Cursor / pi / an MCP client stores a session is harness-specific; `review` only
  accepts a `--session-file` PATH it is handed. Producing that path (optionally,
  gracefully) is the separate `work/notes/ideas/harness-seam-session-awareness.md`
  idea, not this PRD.
- **Auto-loading / adopting the generated hand.** Naming a hand in `hands.json`
  stays a human, operator-scoped act (ADR-0007). `review` emits + tests only. The
  operator-gated `--hand`/`allowAgentHands` runtime-loading path is the separate
  `agent-provided-hand-via-cli-arg` idea's concern.
- **A guaranteed-correct, ready-to-ship hand.** `review` emits a SCAFFOLD (a
  strong starting point from real steps); the `script` test raises confidence, the
  human still reviews. Perfect parameterization/generalization is not promised.
- **A hand marketplace / distribution / portability format.** Out, exactly as the
  parent hands PRD scoped it; `review` authors a LOCAL scaffold for local adoption.

## Further Notes

- This is the cheapest hand-authoring moment: right after success, from the REAL
  steps, with no re-derivation. It makes the hands "token collapse" story
  actionable rather than aspirational (the README/scoreboard hands framing points
  here).
- Composition with the sibling ideas is clean and each guards a different line:
  `review` = AUTHOR (emit + test, never load); `agent-provided-hand-via-cli-arg` =
  operator-gated LOAD; `harness-seam-session-awareness` = optional transcript
  SOURCE. None smuggles auto-load.
- "Proven by reuse": `review` validates via the existing `script` verb and emits
  the existing `Hand` shape, so it adds an authoring convenience on top of frozen
  contracts rather than a new privilege tier.
