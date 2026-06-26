---
'@webhands/core': minor
---

Surface a hand-contributed verb to the AGENT over the long-lived session RPC
(Phase 2, Model B of the "hands" prd; ADR-0007). A dynamically-loaded hand's
verb is now invokable over the wire, so the agent gains a new tool WITHOUT ever
holding a live page handle: the served process runs the hand against its own
live page and returns a serializable result.

The eight built-in verbs stay a CLOSED `SessionRpcRequest` union (now named
`SessionRpcBuiltInRequest`), the single 1:1 source of truth for the built-in
surface. A hand verb \u2014 whose name `core` does not know at compile time \u2014 crosses
as one generic `SessionRpcHandRequest` variant (`{verb: 'hand', name, args}`)
that names the contributed verb at runtime, the exact wire parallel of how a
hand verb composes into the page object. `applySessionRpc` dispatches it to the
named verb on the composed page; `callHandVerb` is the client mirror, and
`connectRemoteSession(url, handVerbs)` attaches the loaded hand verbs to the
remote page as dynamic methods.

The serializable-only boundary (prd's resolved Q3) is enforced by convention +
types, NOT a blanket runtime clone (which would corrupt legitimate in-process
Model A returns); a host-side runtime clone of agent-verb results is noted as
available future hardening for untrusted hands. A page/in-hand throw rejects
faithfully on the client, exactly as the `eval` RPC path does. The in-process
Model A path is unaffected.
