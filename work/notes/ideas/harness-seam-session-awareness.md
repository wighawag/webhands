---
title: Session/transcript awareness built into the harness seam (optional, graceful)
slug: harness-seam-session-awareness
type: idea
status: incubating
created: 2026-07-01
---

## The opportunity

Some webhands tools would be far more useful if they could see the AGENT'S OWN
CONVERSATION, not just what happened on the page. The first concrete consumer is
the `distill` verb (see `distill-session-into-hand`): to distill a
just-driven flow into a hand, the richest input is the agent's transcript (the
real reasoning, the intent, the dead-ends avoided), not only webhands' verb trace.

But there is no PORTABLE way for an agent to get its own transcript. WHERE a
session lives is HARNESS-SPECIFIC: Claude Code stores it one way, Cursor another,
`pi` another (`pi --print --mode json` emits a JSON stream; sessions land under
`~/.pi/agent/sessions/...`), an MCP client something else again. So "read the
conversation" is not one thing an agent can just do.

The idea: make **session awareness a first-class, OPTIONAL capability of the
harness seam**. A harness that knows where its transcript lives EXPOSES it (a
path, or a slice) through a small, agreed shape; a harness that cannot simply does
not, and every consumer DEGRADES GRACEFULLY. Agents (and tools like `distill`) then
have ONE way to ask "can I see this session?" that works where supported and
no-ops where not, instead of each tool hard-coding one harness's file layout.

## Where the seam lives (NOT in webhands core)

The load-bearing design point: this seam must NOT put harness-specific knowledge
inside webhands core. webhands stays harness-agnostic (it drives a browser; it
does not know Claude Code's session format). The awareness lives at the AGENT/SKILL
layer, which is already harness-delivered:

- The **`use-webhands` skill** is the natural home for the OPTIONAL instruction:
  "if your harness exposes the current session/transcript, obtain its path and pass
  the relevant slice to `distill --session-file <path>` (or `--summary`)." A harness
  that cannot surface a transcript just skips that step; the skill already
  degrades.
- webhands core consumers accept a PLAIN input (a `--session-file` PATH, a
  `--summary` string). They never go discover a transcript. The seam PRODUCES the
  path/slice; the tool CONSUMES what it is handed. That keeps the file-path-only
  discipline (`script`, the `--hand` idea) and the harness coupling on the correct
  side of the boundary.

So the seam is a SKILL/agent-side convention plus, optionally, a tiny normalized
descriptor of "how to reach this session," not a webhands-core dependency on any
harness's internals.

## Honest scoping: optional, best-effort, privacy-sensitive

- **Optional by construction.** No consumer may REQUIRE session awareness; it is
  always an enrichment over a portable fallback (for `distill`, the verb trace).
  "Harness does not support it" is a first-class, silent, correct outcome.
- **Privacy-sensitive.** A transcript can contain secrets, other users' data, or
  content the operator never meant a tool to ingest. Handing a session file to a
  tool is a DISCLOSURE act; the convention must make that explicit and opt-in, not
  ambient. (Redaction concerns compound with `distill`'s own trace-redaction
  question.)
- **Best-effort shape.** Transcripts differ (JSON stream vs message log vs
  provider-specific). The seam normalizes only enough for a consumer to find the
  relevant slice; it does not promise a universal transcript schema.

## Design sketch (to be pinned in a PRD, not here)

- A small NORMALIZED descriptor a supporting harness can surface: e.g. session
  file path + format tag (+ optionally a way to request just the current
  turn/sub-flow), delivered via the skill/agent layer (an env var the harness
  sets, a documented file location the skill reads, or a convention the agent is
  told to follow) - NOT a new webhands-core API that imports harness internals.
- The `use-webhands` skill carries the optional "surface your session to
  `distill`" rung, written to degrade to the verb-trace/`--summary` path when the
  descriptor is absent.
- A per-harness ADAPTER note documents, per known harness (Claude Code, Cursor,
  pi, MCP clients), whether/how a transcript is reachable - as guidance, kept OUT
  of webhands core.

## Rejected / out of scope

- **webhands core hard-coding any harness's session layout - REJECTED.** Couples
  the tool to every harness and rots as they change. The awareness stays at the
  skill/agent layer; core only accepts a plain path/summary.
- **A universal transcript schema - OUT.** Over-ambitious; harnesses differ too
  much. Normalize only enough to locate a slice, best-effort.
- **Requiring session awareness anywhere - REJECTED.** It is always optional with
  a portable fallback, so features never break on a harness that lacks it.

## Open questions

1. What is the minimal normalized descriptor (path + format tag + optional
   slice hint), and HOW does a harness surface it (env var the harness sets? a
   documented location the skill reads? a convention the agent follows)?
2. Which harnesses can realistically surface a transcript today, and what does
   each expose (pi's JSON session, Claude Code's store, MCP clients)? Needs a
   short recon pass to know if the seam has real consumers now or is speculative.
3. Privacy/consent model: how is handing a transcript to a tool made explicit and
   opt-in rather than ambient, and does redaction belong here or in the consumer
   (`distill`)?
4. Is this worth a seam at all, or does `distill`'s `--session-file <path>` +
   `--summary` (the agent pastes/points at whatever it can already reach) cover
   enough that a formalized harness seam is premature? Lean: start with the
   plain-input path in `distill`; only formalize this seam once a supporting
   harness makes it concretely useful.

## Provenance

Surfaced in conversation 2026-07-01, split off from
`distill-session-into-hand` at the user's request: the distill verb's
richest input is the agent's conversation, but reading it is harness-specific, so
"session awareness in the harness seam" is its own (more speculative) idea rather
than a coupling baked into `distill`. Kept separate so `distill` can ship on the
portable verb-trace/`--summary`/`--session-file` path while this seam incubates.
Nothing built; pre-PRD.
