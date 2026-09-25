---
title: The loopback-jail symptom is not reliably a TIMEOUT: the live run reset the connection after the request was sent
slug: loopback-jail-failure-surfaces-as-reset-not-only-timeout
type: observation
status: spotted
spotted: 2026-09-25
---

## What was spotted

ADR-0017 (`serve --socket`) was motivated by a measurement in which a jailed account's loopback traffic produced a **timeout**, and the timeout-versus-refusal distinction was written into the diagnosis in the ADR, the README and the bundled skill: a refusal means nothing is listening, a timeout means the packet is being dropped by a filter.

The live acceptance run, same box and same account on 2026-09-25, produced a **different shape** for the same condition. Recorded measurement, from the task that commissioned the feature:

```
$ curl -sv --max-time 5 http://127.0.0.1:41419/ 2>&1 | tail -3
  *   Trying 127.0.0.1:41419...
  * Connection timed out after 5002 milliseconds
```

Live run, inside `anonctl exec --as 01`, against a TCP `serve` that had just reported `ok: true`:

```
  curl against it, bounded at 5s:
    * Request completely sent off
    * Recv failure: Connection reset by peer
    * closing connection #0
  and a verb against it:
    code: unknown
    message: "could not reach the session server at http://127.0.0.1:34015: fetch failed"
```

"Request completely sent off" means the TCP handshake COMPLETED and the request was written, and the connection was then reset. That is not what a `drop` on the SYN looks like.

## Why this matters

The advice we ship keys on the symptom. An agent following the skill's rung literally ("if it is refused, restart `serve`; if it times out, use `--socket`") would meet a reset, match neither branch, and either restart a healthy server or escalate. So the diagnosis had to be rewritten around what is actually invariant:

- `serve` reports `ok: true` with a url and a live pid, and the process stays healthy.
- Every verb fails to reach that url anyway, and so does a bare `curl`.
- The failure is NOT "connection refused" (which is the one shape that really does mean nothing is listening).

That triple is the signal; the specific error text is not. The docs now say a timeout OR a reset, and name "connection refused" as the single shape that means something else. The fix is the same either way, and the feature was verified end to end in exactly this environment.

## Cause: not established

The rule text in `anonctl` 0.9.0 is a plain `drop` (read out of the shipped binary: `meta skuid %d ip daddr 127.0.0.0/8 drop`, alongside `meta skuid %d ip daddr 127.0.0.1 tcp dport %d` accepts for the account's own shim port and `... 127.0.0.0/8 return` for explicit exemptions). A drop on the outbound SYN is consistent with the recorded timeout and NOT with a completed handshake, so something else accounted for the reset. Candidates, none verified:

- an earlier rule in the effective chain accepting the loopback path for the initial packets, with the reset arriving from whatever ultimately received the request;
- the forcing intercepting loopback-destined TCP toward the shim, which would complete a handshake and then reset on a request that is not the proxy protocol it expects;
- ruleset state on the box differing between the two runs.

Determining which would need root and a look at the live ruleset (`nft list ruleset`) plus a packet capture on `lo`, neither of which this observation needs: the webhands-side conclusion is unchanged, since both shapes mean the same thing (a healthy server at an unusable address) and both are fixed by the unix socket.

## Suggested follow-up

If someone with root is already in that box: capture `nft list ruleset` and a `tcpdump -i lo` during a jailed `curl` to a non-shim loopback port, and record which of the candidates it is. It belongs in the anonctl notes rather than here; the value for webhands is only that our published diagnosis must keep covering both shapes.
