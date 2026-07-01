---
title: serve records a per-session verb trace (the distill backbone)
slug: serve-session-verb-trace
prd: distill-session-into-hand
blockedBy: [env-placeholder-substitution-and-dotenv-loading]
covers: [2]
---

## What to build

Make the long-lived `serve` process RECORD a per-session **verb trace**: as verbs
drive the live page, `serve` accumulates an ordered record of what actually ran
(verb name, the locator/args, and enough of each result's shape to reconstruct the
step later). This trace is the PORTABLE, ground-truth BACKBONE the `distill` verb
(a later task) crystallizes into a hand scaffold, so it must be faithful to what
drove the page, not a reconstruction.

Scope decisions fixed by the prd:

- **In-memory for the live session is the default.** The trace lives with the
  running `serve` session; `distill` reads it from the same session. Persisting the
  trace to the profile dir (surviving `stop`) is an ADDITIVE, later opt-in and is
  NOT required here (design the record so persistence can be added without
  reshaping it, but do not build persistence now).
- **No literal secrets in the trace.** Because the `{ENV:NAME}` substitution task
  (`env-placeholder-substitution-and-dotenv-loading`) landed first, a typed
  credential is already the token `{ENV:PASSWORD}` by the time a verb records it,
  so the trace records the TOKEN, never the resolved secret. This task must NOT
  re-introduce the literal: record the value AS THE AGENT PASSED IT (the
  placeholder), NOT the post-substitution resolved string.
- **No redaction of non-credential content.** Non-`ENV` typed values (search
  terms, addresses, amounts) and returned page content are recorded as-is; they
  are unavoidable and already agent-readable by definition. Only the credential
  class is a placeholder, and that already happened upstream.
- **Expose the trace to an in-process reader.** The trace must be readable by the
  `distill` verb within the same `serve` session (an internal accessor on the
  session/controller). Do NOT build the `distill` verb here (that is a separate
  task); just make the trace exist and be readable.

## Acceptance criteria

- [ ] Driving a sequence of verbs (`goto`, `click`, `type`, `script`, ...) against
      a served session produces an ORDERED trace whose entries reconstruct those
      steps (verb + locator/args + enough result shape).
- [ ] A `type '<locator>' '{ENV:PASSWORD}'` records the TOKEN `{ENV:PASSWORD}` in
      the trace, NOT the resolved secret value (asserted: the trace never contains
      the secret).
- [ ] The trace is readable in-process within the same `serve` session (an
      accessor the future `distill` verb will use).
- [ ] The trace is per-session and in-memory (no write to the profile dir / disk in
      this task).
- [ ] Non-credential typed values and page reads are recorded as-is (no redaction
      pass added here).
- [ ] Tests cover trace accumulation + the no-secret guarantee (mirror the repo's
      existing session/controller test style).
- [ ] **Shared/global write isolation:** this task keeps the trace in memory, so it
      should write nothing outside its own temp fixtures; assert no unexpected disk
      write of the trace. If any incidental temp file is used, isolate it to a
      scratch dir and assert the real profile dir is untouched.

## Blocked by

- `env-placeholder-substitution-and-dotenv-loading`, the trace's no-literal-secret
  guarantee depends on `{ENV:NAME}` substitution already turning typed credentials
  into tokens before a verb records them.

## Prompt

> Make webhands' long-lived `serve` process record a per-session VERB TRACE: an
> ordered, in-memory record of the verbs that drove the live page (verb name,
> locator/args, enough result shape to reconstruct the step). This is the backbone
> the `distill` verb (a later task in
> `work/prds/tasked/distill-session-into-hand.md`) turns into a hand scaffold.
>
> FIRST, check this task against reality (launch snapshot, may have DRIFTED):
> confirm how `serve` owns the session/controller today (ADR-0005: one long-lived
> browser, verbs are thin clients driving the same page), and confirm the
> `{ENV:NAME}` substitution task landed as assumed (typed credentials are already
> `{ENV:...}` tokens at record time, verify in `work/tasks/done/`). If the
> dependency landed differently, route to needs-attention rather than building on a
> stale premise.
>
> Domain vocabulary: **controller / serve** owns the live page and the verb loop;
> a **verb** is one action against that page. The trace records what the agent
> PASSED (so a `{ENV:NAME}` placeholder stays a placeholder), not the resolved
> secret. Keep it in-memory + per-session; design the shape so disk persistence
> could be added later, but do NOT build persistence now.
>
> Seams to test at: drive a served session through several verbs and assert the
> trace reconstructs them in order; assert a typed `{ENV:PASSWORD}` records the
> TOKEN, never the secret. Do NOT build the `distill` verb here, only make the
> trace exist and be readable in-process (an accessor the distill task will use).
>
> RECORD non-obvious in-scope decisions (exactly what result shape is captured per
> verb, the accessor's shape) in a `## Decisions` note in the done record, or an
> ADR if it meets the gate.
>
> Every change requires a changeset (`pnpm changeset`).
