---
'@webhands/core': minor
'webhands': minor
---

Add the `distill` verb: reduce a just-driven session into a reusable HAND SCAFFOLD plus a human-readable NOTES markdown, from the session's verb trace. This is the authoring half of the `distill-session-into-hand` prd (validation via `script` is a separate follow-on task). It EMITS and NEVER loads.

- **`distill` core (`@webhands/core`).** `distillTrace(entries, options)` reduces the ordered verb trace into a frozen ADR-0007 `Hand` module scaffold (a default-export factory closing over `ctx.pwPage`) that FAITHFULLY replays the discovered steps in order, plus a notes markdown listing the flow's steps / selectors / decisions. Reads/probes and escape hatches (`eval`/`script`/hand verbs) are left as annotated TODOs rather than auto-invented. A typed `{ENV:NAME}` credential stays the TOKEN in the scaffold and notes (never a resolved secret). Exposed as `distillTrace` / `sliceTrace` / `DEFAULT_HAND_VERB`.
- **The SLICE selector.** `--from`/`--to` crystallize a caller-named sub-flow (0-based, inclusive index range over the trace) so the hand encodes the flow that mattered, not the earlier failed probes; the default is the whole session. Out-of-range bounds clamp; an inverted range yields an empty slice.
- **Optional enrichments.** `--summary <text>` (the agent's intent) and `--session-file <path>` (a transcript webhands is HANDED, read as a plain path; it does NOT discover transcript locations) enrich the notes; omitting both still yields a scaffold from the trace alone.
- **Thin-client trace fetch.** The trace lives in the long-lived `serve` process; the `distill` verb is a thin client, so it reads the SAME session's ordered trace over a new read-only route (`SESSION_TRACE_PATH` / `readSessionTrace`), mirroring how the verb proxy fetches results. Read-only: it never drives the page.
- **HARD TRUST INVARIANT (tested).** `distill` writes NO `hands.json` and never `import()`s the emitted module: it writes only the scaffold to `--out` and the notes beside it as `<out>.notes.md`. Adopting a hand (naming it in `hands.json`) stays the operator's explicit trust act (ADR-0007). A `--test` flag is RESERVED for the next task (validation via `script`) and is accepted-and-ignored here.
