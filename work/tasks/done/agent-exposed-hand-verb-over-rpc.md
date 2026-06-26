---
title: Surface a hand-contributed verb to the agent over the session RPC (Phase 2, Model B)
slug: agent-exposed-hand-verb-over-rpc
prd: hands-pluggable-page-capabilities
blockedBy: [third-party-hand-loading-and-public-api]
covers: [5]
---

## What to build

Phase 2, Model B: surface a hand-contributed verb to the AGENT as a
verb/tool over the long-lived session RPC, so the agent gains a new tool WITHOUT
ever holding a live page handle. The agent invokes it like any other verb; the
served process runs the hand against its own live page internally and returns a
SERIALIZABLE result.

The serialization boundary is the load-bearing rule (prd's resolved Q3): a live
Playwright object (`Page`, `Locator`, `ElementHandle`, `BrowserContext`) may
flow ONLY within a single in-process call chain (Model A). The moment a value is
returned to an AGENT-EXPOSED verb (it crosses the RPC), it MUST be serializable
under the SAME structured-clone contract the `eval` verb already documents
(richer than JSON: preserves `NaN`/`BigInt`/circular-as-`[Circular]`; DOM nodes
come back as opaque preview strings, never live handles). This is not a new
constraint — it is the existing seam law (ADR-0003 no-leak; `eval`-style clone)
extended to hand verbs. Enforced by CONVENTION + TYPES, NOT a blanket runtime
clone (a blanket clone would corrupt legitimate in-process Model A returns); a
host-side runtime clone of agent-verb results is noted as available HARDENING,
not built here.

End-to-end path: a loaded hand contributes a verb → it is registered into the
agent-facing RPC surface → the agent calls it over the wire → the server runs it
against the live page → a serializable result returns; a page-side throw rejects
faithfully on the client (as `eval` already does).

## Acceptance criteria

- [ ] A hand-contributed verb can be surfaced over the session RPC so an agent
      invokes it like a built-in verb; the agent never holds a live page handle.
- [ ] The agent-exposed result crosses the wire as a SERIALIZABLE value under
      the same structured-clone contract `eval` documents; a page/in-hand throw
      REJECTS faithfully on the client.
- [ ] The serializable-only rule is enforced by convention + types (no blanket
      runtime clone); the in-process (Model A) path is unaffected (a hand may
      still pass/return live handles in a single in-process call chain).
- [ ] The RPC request/response shape stays the single source of truth shared by
      server and client (no parallel/ drifting second verb surface).
- [ ] Tests cover the new behaviour: a test hand's verb is invoked over the RPC
      and its serializable result asserted; a throwing hand verb is asserted to
      reject on the client with a faithful message.
- [ ] A changeset is added (`pnpm changeset`) per the repo convention.
- [ ] Shared-write isolation: any test that opens a session/server points its
      profile root + endpoint paths at temp/scratch locations and asserts the
      real ones are untouched.

## Blocked by

- `third-party-hand-loading-and-public-api` — needs the public hand API + the
  load mechanism to have a hand whose verb to surface; also both this and that
  task touch the agent-facing layer, so serializing them avoids a merge
  conflict.

## Prompt

> Goal: surface a hand-contributed verb to the agent over the long-lived session
> RPC (Model B of the "hands" prd,
> `work/prds/tasked/hands-pluggable-page-capabilities.md`), enforcing the
> serializable-only boundary. The agent gains a new tool and never holds a live
> page.
>
> FIRST, check against reality: the agent-facing RPC is
> `packages/core/src/session-rpc.ts` — `SessionRpcRequest` is a closed union and
> `applySessionRpc` maps each verb 1:1 to a `Page` method; it is the SINGLE
> source of truth shared by the server handler and the client proxy. The `eval`
> verb's serialization contract is documented on `Page.eval` in
> `packages/core/src/seam.ts` and is your canonical definition of "serializable".
> Read the landed `third-party-hand-loading-and-public-api` work for how a hand
> is loaded and how it contributes a verb. If any of that landed differently,
> route to needs-attention rather than guessing.
>
> The rule (prd's resolved Q3): live Playwright objects flow ONLY within a single
> in-process call chain (Model A); anything returned to an agent-exposed verb
> crosses the RPC and MUST be serializable under `eval`'s structured-clone
> contract. Do NOT add a blanket runtime clone of every result (it would corrupt
> legitimate in-process Model A returns); enforce by convention + types, and you
> MAY note a host-side runtime clone as future hardening for untrusted hands. A
> page/in-hand throw must REJECT faithfully on the client, exactly as the `eval`
> RPC path already does.
>
> What "done" means: a loaded hand's verb is invokable over the session RPC and
> returns a serializable value to the agent; a throwing hand verb rejects on the
> client with a faithful message; the in-process Model A path is unaffected; the
> RPC shape stays the single shared source of truth; a changeset is added. Test
> at the RPC dispatch + a live served session, isolating profile/endpoint paths.
>
> RECORD non-obvious in-scope decisions (how a dynamically-loaded hand verb is
> represented in the RPC union vs the closed built-in union, how its name is
> namespaced, error mapping). Note them in the done record (or an ADR if a choice
> meets the ADR gate).
