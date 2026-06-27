---
title: Let the agent provide a hand at runtime via a --hand CLI arg (gated)
slug: agent-provided-hand-via-cli-arg
type: idea
status: incubating
created: 2026-06-27
---

## The opportunity

Today an agent scripts ad-hoc page logic through `eval`: a single JS EXPRESSION
run INSIDE the page (`page.evaluate`), structurally cloned out by value. That is
limiting: it is one expression (not multi-step), it runs in the PAGE world (so it
cannot use the Playwright `Page` API — no `frameLocator`, no coordinate mouse, no
screenshots — the very page-level operations the captcha case needs), and it is
stateless (no named, reusable action).

Now that **hands** exist (ADR-0006/0007), the natural richer authoring shape is a
hand: a real module that closes over the live Playwright `Page` and contributes
named verbs. The idea: let the agent **provide a module file path at runtime**
that webhands loads as a hand, so the agent gets a natural mechanism for specific
page actions WITHOUT the operator having to pre-declare every hand in config.

## Why this is delicate (the trust delta — read before building)

This is NOT "a more natural `eval`". It is **larger by an entire trust tier**:

- **`eval`** is sandboxed to the page's JS world — a DOM node never crosses the
  process boundary; the worst an agent does is to the PAGE.
- **A hand** is arbitrary Node code in the webhands PROCESS, holding the live
  Node-side `Page`/`BrowserContext` and the full Node runtime (filesystem,
  network, env, `context.close()`). ADR-0007's mental model: **loading a hand ==
  trusting an in-process npm dependency.**

So "let the agent provide a hand" = "let the agent achieve arbitrary code
execution in the webhands process, decided at runtime." Whether that is harmless
or dangerous depends ENTIRELY on the deployment:

- **World 1 — the agent has a shell** (a local coding agent with filesystem +
  config write). Here the operator-trust gate is already a formality: the agent
  could already write a module + edit `hands.json` to load it. A `--hand` arg
  just removes a two-step dance for a thing it could already do. The trust
  decision ("is this agent/machine trusted") was already made at launch.
- **World 2 — the agent only speaks the verb seam** (webhands as an MCP/RPC
  server; the agent's whole surface is verbs over the wire, no shell, no
  filesystem — ADR-0005's served session hands out only verbs + locator strings).
  Here the operator-trust gate is a REAL wall, and an `agent-provide-a-hand` path
  would punch arbitrary RCE straight through it.

The same feature is "convenience" in World 1 and "remote RCE" in World 2. The
gate below is what keeps World 2 safe; its docs must say so plainly.

## The design (simplified — operator-scoped trust only)

Two provenance paths, BOTH operator-scoped and machine-global. **No per-repo
config, no directory discovery, no dir-trust** (see "Rejected" below):

| Path | How a hand is named | Trust act | Default |
| --- | --- | --- | --- |
| **Global config** | `~/.webhands/hands.json` (the existing ADR-0007 file) | the operator wrote their own home config | honoured |
| **`--hand <path>` CLI arg** | a module file PATH passed at launch (repeatable) | the `allowAgentHands` gate is ON | gate OFF |

- **`--hand` is FILE-PATH-ONLY** — never module source over the wire. The agent
  names a path to a file that already exists on disk (it wrote it, or it is
  present). This keeps the feature honestly scoped to "the agent that already has
  filesystem access" (World 1); it does not let a seam-only World-2 agent ship
  code.
- **It reuses the frozen contract.** A `--hand` path loads through the EXACT
  existing `loadHands` / `composeWithHands` path an operator-named hand uses (the
  module must export a `Hand`). No new hand mechanism, no new trust tier — the
  ONLY new thing is WHO may name the path, gated by `allowAgentHands`.
- **`allowAgentHands` resolution: CLI flag > global config > default OFF.** It is
  the operator gate. It is set by the human who launches webhands (a launch flag
  or their global config); it can NEVER be enabled over the agent verb seam (else
  a World-2 agent self-escalates). Default off, loud docs:

  > Enabling `allowAgentHands` lets the connected agent execute arbitrary Node
  > code in the webhands process. Enable it ONLY when the agent is as trusted as
  > the operator (a local, single-user setup where the agent already has
  > shell-equivalent access). Do NOT enable it on a webhands exposed to a remote
  > or semi-trusted agent.

This refines ADR-0007 (it does not discard it): the explicit, operator-owned,
local-only trust act stays; `--hand` is one more operator-gated way to name a
hand, file-path-only, behind a default-off switch.

## Rejected (and why)

- **Per-repo / parent-lookup `hands.json` discovery — REJECTED.** A hand is a
  CAPABILITY: it is trusted or not, and that trust is OPERATOR-scoped, not
  DIRECTORY-scoped. Per-repo discovery would add a feature ("a repo ships its
  hands") that is inseparable from a vulnerability ("a repo runs its code on the
  process the moment you `cd` in and launch" — the `.npmrc` / `.vscode` /
  `.git/hooks` drive-by class). Crucially it brings nothing NEW over "the
  operator trusts this hand" — it only adds the risk. Dropping it also deletes an
  entire layer that existed only to make discovery safe: trust-on-first-use, a
  per-directory `trust.json`, and the "can per-repo config set `allowAgentHands`"
  self-escalation hazard all evaporate.
- **Module source over the wire — REJECTED.** Strictly more World-2-dangerous;
  defeats the file-path-only scoping above.
- **A Node-less "page-script" sandbox** (give agent-supplied code the Playwright
  `Page` but strip Node ambient authority) — a real alternative middle tier, but
  NOT chosen: a credible Node sandbox is hard (`vm` is not a security boundary
  per Node's own docs; honest isolation wants a separate process / worker), and
  the World-1 framing makes the full-Node `--hand` acceptable behind its gate.
  Recorded as the fallback if a World-2-safe richer-than-`eval` path is ever
  wanted.

## Open questions

1. Does `--hand` take just a path, or also an optional name / verb-namespace
   (to namespace the agent-provided verb, or disambiguate two `--hand`s that
   contribute the same verb name)? (Minor.)
2. Does `eval` stay as-is alongside this? (Lean: yes — `eval` is the
   page-sandboxed tier, `--hand` is the full-Node tier; different trust levels,
   both have a place. This idea ADDS a tier, it does not replace `eval`.)
3. Confirm against the code that enabling `allowAgentHands` is provably NOT
   reachable over the agent verb seam (the no-self-escalation invariant) — verify
   how the served session / config loading actually wires, so the World-2 wall is
   real and not assumed.

## Provenance

Surfaced in conversation 2026-06-27 while reflecting on the just-landed hands
work (ADR-0006/0007, the Phase-1/Phase-2 task chain). Pre-PRD; the natural next
step is a small PRD that refines ADR-0007 with the `--hand` + `allowAgentHands`
gate. Nothing built.
