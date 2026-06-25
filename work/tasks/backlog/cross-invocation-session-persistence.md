---
title: Cross-invocation session persistence (long-lived browser between CLI calls)
slug: cross-invocation-session-persistence
prd: browser-controller-cli
blockedBy: [cli-incur-wiring-and-errors]
needsAnswers: true
covers: []
---

<!-- open-questions -->

## Open questions

The prd explicitly SEEDS but does NOT decide the mechanism by which a browser stays
alive between separate CLI invocations (verbs need a persistent browser between
calls, but each `my-browser-controller <verb>` is a fresh process). The two
candidate mechanisms named in the prd are a genuine design fork that changes the
architecture, the IPC surface, and the test seam — so this is flagged rather than
guessed:

1. **Background daemon vs. `incur serve`?** The prd names two options: (a) a
   long-lived `core` background daemon process the CLI talks to, or (b) lean on
   `incur`'s `cli.fetch` serve-as-API (`/mcp`) to host the long-lived browser in a
   served process the CLI invocations call over fetch. Which is the v1 mechanism?
2. **Lifecycle & addressing:** how is the long-lived process started, discovered,
   and torn down (explicit `serve`/`start` + `stop`, or auto-spawn on first verb)?
   How does a verb invocation address the single active session?
3. **Single-session scope:** the prd fixes single active session in v1 (multi-session
   is out of scope) — confirm the chosen mechanism holds exactly one session and
   what happens on a second concurrent `launch`/`attach`.
4. **Test seam:** what is the highest deterministic seam to test the persistence
   (process survives between two verb calls against the local fixture; second call
   reuses the first call's page/session)?

Resolve these (human or a design ADR) before building; the answer likely warrants
an ADR since it is hard to reverse and shapes the whole IPC surface.

<!-- /open-questions -->

## What to build

The mechanism that keeps a single browser session alive ACROSS separate CLI
invocations, so an agent can run `launch`, then later `goto`, then `snapshot`,
then `click` as distinct commands and have them all act on the SAME live page.
This is the enabling INFRASTRUCTURE (seeded by the prd's "session/daemon question"
paragraph) that makes the per-verb and launch user stories usable end-to-end from
a CLI; it does not deliver the verb or launch surface itself (those are owned by
the verb and launch tasks) — hence `covers: []`.

A thin vertical slice once the fork is resolved: starting/attaching a session in
one CLI invocation leaves a live browser that a subsequent invocation's verb drives,
and the session is discoverable, single, and tear-down-able. Tests assert the
persistence at the chosen seam against the local fixture page (one process spans
two verb invocations; the second reuses the first's session).

## Acceptance criteria

- [ ] (Once the open questions are resolved) A single browser session survives between two separate CLI invocations; the second invocation's verb drives the same live page.
- [ ] Exactly one active session is held in v1 (multi-session is out of scope); a clear behaviour is defined for a second concurrent `launch`/`attach`.
- [ ] The long-lived process is startable, discoverable, and tear-down-able, with clear errors when no session is live.
- [ ] **Shared-write isolation:** any on-disk state (socket/pid/endpoint files, profile dir) is isolated to a temp dir in tests and the real shared location is asserted untouched.
- [ ] Tests assert persistence at the chosen seam against the local fixture page (a process spans two verb invocations; the second reuses the first's session).
- [ ] A changeset is added; the mechanism decision is recorded as an ADR if it meets the ADR gate.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `cli-incur-wiring-and-errors` (the CLI verb surface and incur `serve`/`cli.fetch` wiring it may build on must exist first).

## Prompt

> Goal: implement cross-invocation session persistence — keep one browser alive
> between separate `my-browser-controller <verb>` CLI processes. Read the prd
> `work/prds/ready/browser-controller-cli.md` (Implementation Decisions — the
> "session/daemon question" paragraph; User Stories 3 and 6 give the motivating
> launch→goto→snapshot chain this enables) and ADR-0001 (the CONTROLLER owns the
> long-lived control loop — that is exactly this loop's home). Read `CONTEXT.md`
> (`controller`, `incur` — note `cli.fetch` serve-as-API + `/mcp`).
>
> SCOPE: this task delivers the persistence INFRASTRUCTURE, not the verb or launch
> user stories themselves (those land in their own tasks) — hence `covers: []`. It
> is what makes those stories work end-to-end across separate CLI processes.
>
> THIS TASK CARRIES OPEN QUESTIONS (`needsAnswers: true`): the prd deliberately
> seeds but does NOT decide the daemon-vs-`incur serve` mechanism. Do NOT guess —
> the questions in `## Open questions` must be resolved (by a human or a design ADR)
> before building. The choice is hard to reverse and shapes the whole IPC surface,
> so record it as an ADR in `docs/adr/` when decided.
>
> Depends on `cli-incur-wiring-and-errors`. Test at a deterministic seam against the
> LOCAL FIXTURE PAGE: one long-lived process must span two separate verb invocations
> and the second must reuse the first's session. Isolate any socket/pid/endpoint/
> profile state to a temp dir in tests and assert the real location is untouched.
>
> "Done" = a single session survives between CLI calls, is single/discoverable/
> tear-down-able, the mechanism decision is recorded, and persistence is tested at
> the seam.
>
> FIRST, check this task against current reality — confirm the CLI wiring landed and
> whether an ADR has since resolved the fork (if so, the open questions may already
> be answered; clear the flag and build). Building on the wrong mechanism is
> expensive, so resolve the fork first.
