---
title: Cross-invocation session persistence (long-lived browser between CLI calls)
slug: cross-invocation-session-persistence
prd: browser-controller-cli
blockedBy: [cli-incur-wiring-and-errors]
covers: []
---

## What to build

The mechanism that keeps a single browser session alive ACROSS separate CLI
invocations, so an agent can run `launch`, then later `goto`, then `snapshot`,
then `click` as distinct commands and have them all act on the SAME live page.
This is the enabling INFRASTRUCTURE (seeded by the prd's "session/daemon question"
paragraph) that makes the per-verb and launch user stories usable end-to-end from
a CLI; it does not deliver the verb or launch surface itself (those are owned by
the verb and launch tasks) — hence `covers: []`.

**Mechanism (resolved — see `docs/adr/0005`):** a long-lived **`incur serve`**
process (`cli.fetch` over `/mcp`/HTTP) owns the one Playwright browser + the active
`Session`/page; each `webhands <verb>` is a **thin client** that calls
the running server and exits. The browser launches ONCE in the served process,
NEVER per verb invocation (this is the whole point — the live page state, not just
the on-disk profile, must survive between calls). The bespoke-daemon alternative
was rejected (the incur server is already being built, so it hosts the loop for
free and satisfies ADR-0001).

**Lifecycle is EXPLICIT (no auto-spawn in v1, per ADR-0005):** `serve` (and
`launch`/`attach`) bring the session up; a verb invocation with NO live server
prints a clear, actionable error naming the fix (run `serve` first) and exits
non-zero — it does NOT silently spawn a browser. The server writes its endpoint
(port/socket) under the config dir (`~/.webhands/`) for client verbs
to discover; teardown is explicit (`stop` / signal). Exactly ONE session in v1: a
second `launch`/`attach` while one is live is a clear "already active" error.

A thin vertical slice: `serve` brings up the session in one process; a subsequent
separate verb invocation drives the SAME live page; the session is discoverable,
single, and tear-down-able. Tests assert the persistence at the chosen seam against
the local fixture page (one served process spans two separate client invocations;
the second reuses the first's live session).

## Acceptance criteria

- [ ] A long-lived `incur serve` process hosts the browser + single session; a single session survives between two separate CLI invocations; the second invocation's verb drives the same live page (the browser is launched ONCE in the server, never per verb).
- [ ] Exactly one active session is held in v1 (multi-session is out of scope); a second concurrent `launch`/`attach` while one is live is a clear "already active" error.
- [ ] Lifecycle is EXPLICIT (ADR-0005): `serve`/`stop` bring the session up/down; a verb with NO live server prints a clear, actionable error naming the fix (run `serve` first) and exits non-zero — it never auto-spawns a browser in v1.
- [ ] The served process writes its endpoint under the config dir for client verbs to discover; the process is startable, discoverable, and tear-down-able.
- [ ] **Shared-write isolation:** any on-disk state (socket/pid/endpoint files, profile dir) is isolated to a temp dir in tests and the real shared location is asserted untouched.
- [ ] Tests assert persistence at the chosen seam against the local fixture page (a process spans two verb invocations; the second reuses the first's session).
- [ ] A changeset is added. (The mechanism decision is recorded in `docs/adr/0005`.)
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `cli-incur-wiring-and-errors` (the CLI verb surface and incur `serve`/`cli.fetch` wiring it may build on must exist first).

## Prompt

> Goal: implement cross-invocation session persistence — keep one browser alive
> between separate `webhands <verb>` CLI processes. Read the prd
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
> The mechanism IS DECIDED (read `docs/adr/0005` FIRST): a long-lived `incur serve`
> process (`cli.fetch`) owns the one browser + session; verbs are thin clients that
> call it and exit; the browser launches once in the server, never per verb.
> Lifecycle is EXPLICIT — `serve`/`stop`, and a verb with no live server errors
> clearly (run `serve` first) rather than auto-spawning. Single session in v1; a
> second `launch`/`attach` while one is live is an "already active" error. Do NOT
> reintroduce the rejected bespoke-daemon path.
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
> FIRST, check this task against current reality — confirm the CLI wiring landed as
> assumed and that `docs/adr/0005` is still the governing decision; if the serve
> surface differs from what the wiring task built, reconcile rather than building on
> a stale premise.
