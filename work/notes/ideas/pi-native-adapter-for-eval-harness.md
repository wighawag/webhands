---
title: A pi-native AgentUnderTest adapter for the eval harness (parse pi's --mode json event stream as a first-class capability: live structured messages + exact token usage + a session-file audit trail)
slug: pi-native-adapter-for-eval-harness
type: idea
status: proposed
created: 2026-06-29
---

## The idea

Add a **pi-native adapter** behind the eval harness's `AgentUnderTest` launch seam, alongside the generic shell adapter. It runs `pi --mode json [--session <path>]` and PARSES the NDJSON event stream as a first-class capability, instead of treating the agent's stdout as an opaque blob the way the generic shell adapter does. Modelled on dorfl's `packages/dorfl/src/harness.ts` `pi` adapter (vs its `null`/shell adapter).

## Why it earns its keep (it kept coming up)

The deferred pi adapter was framed in the prd `agent-capability-eval-harness` (## Resolved decisions D1, ## Out of Scope) as merely "pi-native session/liveness niceties". The live demo on 2026-06-29 showed that UNDERSOLD it. `pi --mode json` emits one JSON event per line AS THINGS HAPPEN (`session.subscribe(event => writeRawStdout(JSON.stringify(event)))` in pi `packages/coding-agent/src/modes/print-mode.ts`), and those events carry real structure the shell adapter throws away:

- **Live structured messages.** Event types include `agent_start`/`turn_start`/`message_start`/`message_update` (with `text_delta` token streaming)/`message_end`/`tool_call`/`tool_result`/`agent_end`. A pi-native adapter can surface the agent's reasoning + tool calls LIVE and STRUCTURED (not the demo-grade regex/line tee the shell adapter now does, see `evals/src/agent-under-test.ts`).
- **Exact token usage.** Each assistant `message`/`message_update` event carries a `usage` object (`input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens`/`cost`). This is the clean source for the token-accounting task (`work/tasks/ready/eval-token-accounting-for-webhands-vs-baseline.md`): a pi-native adapter gets exact usage for free, where the generic shell adapter can only best-effort-parse or report unknown.
- **Audit trail.** `pi --session <path>` writes a `.jsonl` session file (the dorfl `pi-harness.ts` mechanism), a durable record of the run for later inspection.

So the pi-native adapter is the natural HOME for three things that otherwise get bolted onto the generic shell adapter awkwardly: live message rendering, exact token capture, and a per-run audit trail.

## Scope / boundaries

- It is ONE implementation behind the EXISTING `AgentUnderTest` seam (non-breaking, exactly as D1 promised); the generic shell adapter stays for arbitrary agents (`claude -p`, a Playwright-only agent, etc.).
- It does NOT change the no-priming rule, the harness's own end-state assertion, or the non-gating posture; it only changes how ONE adapter launches + observes its agent.
- Token usage must still surface through the SAME toolkit-agnostic field the token-accounting task defines (a pi-native adapter just fills it exactly rather than best-effort), so a pi run and a non-pi run stay comparable.

## Relationship to current work

- The generic shell adapter currently does a demo-grade tee + NDJSON pretty-print (`evals/src/agent-under-test.ts`, committed 2026-06-29) so a human can watch pi live. That is scaffolding; this adapter is the first-class replacement for the pi case.
- Pairs with `work/tasks/ready/eval-token-accounting-for-webhands-vs-baseline.md` (exact usage source) and `work/notes/observations/eval-end-state-assertion-needs-the-agent-to-leave-the-session-open.md` (the agent-toolkit-agnostic stance this adapter must honour).

## Status

Proposed (idea), 2026-06-29, justified by the live demo (not theory). Promote to a task when the harness wants live structured pi output and/or exact pi token usage; it is independent of the per-tier evals.
