---
title: review, crystallize a just-driven session into a tested hand scaffold
slug: review-crystallizes-session-into-hand
humanOnly: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Resolved decisions (were open questions)

The two questions that once gated tasking are DECIDED (2026-07-01), and the
decision reshapes the solution rather than just answering it:

1. **Credentials handled by `{ENV:NAME}` substitution, not by redacting a leaked
   literal (DECIDED, and it is task #1).** The earlier framing ("redact typed
   secrets out of the trace") was theater: if the agent calls `type '#pass'
   'hunter2'`, the agent ALREADY holds the secret, so redacting the trace closes a
   door already open. The real move is to keep the literal OUT of the tool-call and
   the artifacts entirely: webhands resolves a `{ENV:NAME}` placeholder in `type`
   values from its OWN process env at type-time. The agent types
   `type '#pass' '{ENV:PASSWORD}'`; webhands substitutes the real value; the
   tool-call, the verb trace, and the emitted scaffold all record only the
   non-secret token `{ENV:PASSWORD}`. This is in-scope for THIS prd and is the
   FIRST task (every other task is `blockedBy` it), because it is what makes the
   trace safe to keep and the scaffold reusable.
2. **Persistence is fine, BECAUSE of #1 (DECIDED).** The only real objection to
   persisting the trace to the profile dir was secret-at-rest (a plaintext password
   surviving `stop`). With `{ENV:NAME}` the trace never holds the credential (only
   the token), so there is nothing sensitive to persist and the at-rest objection
   evaporates. The two decisions are the SAME insight: `{ENV:NAME}` is what makes
   persistence safe.

**Honest framing (why `{ENV:NAME}` is HYGIENE, not a security boundary).** Even
with `{ENV:PASSWORD}`, the substituted value lands in the DOM and can be read back
(and a local agent could read the env itself). So `{ENV:NAME}` does NOT create a
secret boundary the agent cannot cross, and it is not trying to: the execution
context is one that ALREADY TRUSTS THE AGENT (a local agent on the operator's
machine). Its point is HYGIENE, not containment: do not gratuitously write a
literal credential into the tool-call, the on-disk trace, and the reusable scaffold
when a placeholder works identically and keeps every artifact clean and shareable.

**Other sensitive content is out of scope by nature.** Non-credential typed values
(a search term, an address, an amount) and returned page content (a balance, an
order detail) are UNAVOIDABLE and are ALREADY part of what the agent reads by
definition, so `review` does not attempt to redact them: it records what drove the
page. Only the credential class gets the `{ENV:NAME}` treatment, because only there
is a placeholder both possible and worthwhile.

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
  really ran, not a reconstruction. This is the default source. Credentials never
  enter the trace as literals: an agent types `{ENV:NAME}` placeholders (see
  *Resolved decisions* #1), so the trace and the emitted scaffold carry only the
  non-secret token, which is also what makes the scaffold reusable.
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
the verb-trace + the `{ENV:NAME}` substitution contract (see *Resolved decisions*).

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
7. As an agent, I want to type a credential as an `{ENV:NAME}` placeholder that
   webhands resolves from its own process env at type-time, so my password never
   appears in the tool-call, the verb trace, or the emitted scaffold (and the
   scaffold stays reusable without embedding a secret).
8. As an agent, I want the SKILL and the `type` tool DESCRIPTION to TELL me that
   `{ENV:NAME}` exists and that I should use it for passwords/tokens the operator
   put in the environment, so I handle sensitive info WITHOUT reading it by
   default, instead of typing the literal because I never knew the placeholder
   existed. (An unadvertised capability is an unused one.)
9. As an operator, I want webhands to load `.env` / `.env.local` files (via
   `ldenv`) so I can put `PASSWORD=...` in a gitignored `.env.local` and have
   `{ENV:PASSWORD}` resolve, without exporting secrets into my interactive shell.
10. As an agent, I want to crystallize a caller-named SLICE of the session (the
    checkout sub-flow, not the earlier failed probes), so the hand encodes the
    flow that matters, not the whole noisy transcript.
11. As a hand author, I want the emitted scaffold in the frozen `Hand`/`HandContext`
    shape (closing over `ctx.pwPage`), so it drops into the existing loading path
    with no new mechanism once I adopt it.
12. As a maintainer, I want `review` to be ONE flagged verb (mirroring `script`'s
    single-source simplicity), so the surface stays small.

### Autonomy notes

- **`humanOnly: true` (DECIDED).** A human must drive the TASKING of this PRD. It
  introduces a security-adjacent surface: a verb trace, an emitted-code path
  adjacent to the hand trust tier, and the `{ENV:NAME}` substitution. A human
  should own the decomposition, the task ordering (`{ENV:NAME}` first, everything
  `blockedBy` it), and any ADR scope, even though the resulting tasks may
  themselves be agent-buildable. (This does NOT propagate to the tasks' own gates.)
- **`needsAnswers` cleared (RESOLVED).** The two once-blocking questions (the
  credential/redaction contract and trace persistence) are DECIDED in *Resolved
  decisions* above: `{ENV:NAME}` substitution replaces redaction, and persistence
  is safe because of it. The prd is tasking-ready.

## Implementation Decisions

Decided at launch (to seed tasking; trimmed into tasks/ADRs at `to-task`):

- **`{ENV:NAME}` substitution is TASK #1; every other task is `blockedBy` it.**
  webhands resolves an `{ENV:NAME}` placeholder in `type` values (and any other
  value-bearing verb where a credential is typed) from its OWN process env at
  type-time, substituting the real value into the page while the tool-call and the
  recorded value stay the token. This lands FIRST because it is what keeps the
  verb trace (task #2) and the scaffold free of literal secrets. It is a general
  webhands capability (useful outside `review`), but it is built here as the
  foundation `review` depends on. Honest scope: it is HYGIENE, not a secret
  boundary (the value is DOM-readable; the context already trusts the agent).
  Task #1 has three parts, all shipping together:
  - **Resolution + `.env` loading via `ldenv`.** `serve` loads `.env` /
    `.env.local` / `.env.<mode>` files into the environment at startup using
    `ldenv`'s importable `loadEnv()` (it wraps dotenv + dotenv-expand and already
    honours the operator's real env at highest priority), so `{ENV:NAME}` resolves
    against a gitignored `.env.local` and NOT only the interactive shell. An
    UNRESOLVED `{ENV:NAME}` fails LOUD (never a silent empty type). Substitution
    is webhands' own `{ENV:NAME}` grammar at type-time; `ldenv` is the loader
    underneath, not the placeholder syntax.
  - **Agent-facing DESCRIPTIONS.** The `type` verb's tool/`--help` description
    states that a value may be `{ENV:NAME}` and that the agent SHOULD use it for
    credentials the operator placed in the environment, so the agent handles
    secrets without reading them BY DEFAULT rather than typing a literal for lack
    of knowing the option exists.
  - **The `use-webhands` SKILL.** The skill gains a short "handling sensitive
    info" rung: prefer `type '#pass' '{ENV:PASSWORD}'` over a literal; the
    operator supplies the value via env / `.env.local`; you never need to read it.
    (Held to the no-priming spirit already enforced on the skill: generic, no site
    selectors.)
- **One flagged verb.** `review` with `--summary <text>`, `--session-file <path>`,
  `--out <path>` (scaffold destination), `--test` (validate via `script`), and a
  SLICE selector (e.g. `--from`/`--to` over the trace, exact form a task detail).
  Not a verb family. Mirrors `script`'s single-source shape.
- **Verb trace lives in `serve`.** The controller records the session's verbs
  (verb name, locator/args, and enough result shape to reconstruct steps).
  Credentials are already `{ENV:NAME}` tokens by task #1, so the trace holds no
  literal secret; it may therefore be in-memory for the live session OR persisted
  to the profile dir (persistence is safe, see *Resolved decisions* #2). Default
  bias: in-memory for the live session, persistence an additive opt-in. It does
  NOT redact non-credential typed values or page reads (out of scope by nature).
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
- **`{ENV:NAME}` substitution (task #1) gets its own tests:** `type '#pass'
  '{ENV:PASSWORD}'` types the RESOLVED env value into the page, while the recorded
  trace value stays the literal token `{ENV:PASSWORD}` (assert the trace never
  contains the secret); an unset env var fails LOUD (not a silent empty type); a
  plain value with no `{ENV:...}` is typed verbatim (backward compatible); and a
  value defined only in a gitignored `.env.local` resolves (proving `ldenv`'s
  file loading is wired), while the operator's real shell env still wins on a
  conflict (`ldenv`'s documented priority).
- **The agent-awareness deliverables are checked, not assumed:** an assertion that
  the `type` verb description mentions `{ENV:NAME}`, and that the `use-webhands`
  skill's sensitive-info rung is present and stays no-priming-clean (the existing
  `assertSkilledReferenceUnprimed`-style guard). An unadvertised capability is the
  failure mode this story exists to prevent, so its advertisement is a test.
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
- **Redacting non-credential content.** Non-`ENV` typed values (search terms,
  addresses, amounts) and returned page content (balances, order details) are
  UNAVOIDABLE and already agent-readable by definition; `review` records what drove
  the page and does NOT attempt to scrub them. Only the credential class gets the
  `{ENV:NAME}` placeholder (see *Resolved decisions*).
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
