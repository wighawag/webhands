---
title: Load iamhuman captcha-solving as the first third-party hand (Phase 2 proof)
slug: iamhuman-captcha-hand-first-thirdparty
prd: hands-pluggable-page-capabilities
needsAnswers: true
blockedBy: [third-party-hand-loading-and-public-api, agent-exposed-hand-verb-over-rpc]
covers: [3, 4]
---

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
  This task is blocked on the prd's deferred Q6 spike (an iamhuman-specific
  risk). Resolve the spike, record the result, then clear `needsAnswers`.
-->

## Open questions

1. **Does Playwright actually reach + operate the nested cross-origin frame
   case iamhuman needs?** (The prd's deferred Q6.) The captcha case assumes
   Playwright can reach a WAF iframe containing a captcha iframe via
   `frameLocator(...).frameLocator(...)`, perform coordinate clicks, and take a
   screenshot, all through nested cross-origin frame boundaries. This is
   UNVERIFIED. Run a throwaway spike to confirm before committing iamhuman's
   approach. Per the prd, a spike FAILURE falsifies the captcha EXAMPLE, not the
   hands abstraction (webhands still benefits from built-in hands + in-process
   composition + any non-captcha third-party hand) — so on failure, record the
   finding and reshape/withdraw this task rather than forcing the approach.

<!-- /open-questions -->

## What to build

The end-to-end Phase-2 proof: load iamhuman captcha-solving as the FIRST
third-party hand through the public hand API, and surface its capability to the
agent as a verb (Model B). This is the "user installed webhands, needs iamhuman"
scenario resolved: the operator names iamhuman as a hand and their agent gains
its verb, WITHOUT hand-wiring Playwright themselves.

iamhuman's `PlaywrightDriver(page)`-style code plugs straight into the live
hand-context (`{pwPage, context, ensureOpen}`) — Model A in-process page access
is exactly the foundation it needs (screenshots, coordinate mouse, nested
`frameLocator`). Its agent-facing result is surfaced over the session RPC as a
serializable value (Model B).

The captcha LOGIC lives in iamhuman, not in this repo (prd Out of Scope); this
task is the LOADING + WIRING + PROOF that a real third-party hand composes
through the host and reaches the agent.

This task is `needsAnswers: true` because the iamhuman approach hinges on the
unresolved Q6 spike (see Open questions) — flag, don't guess.

## Acceptance criteria

- [ ] (Gate) The Q6 spike is run and recorded: a `work/notes/findings/` doc
      captures whether Playwright reaches the nested cross-origin frame case
      (with its `source:` provenance). `needsAnswers` is cleared only after this.
- [ ] iamhuman is loaded as a third-party hand via the explicit declarative
      mechanism (named in config, pinned entry) and plugs into the same host the
      built-in hands use.
- [ ] iamhuman's capability is surfaced to the agent as a verb over the session
      RPC (Model B), returning a serializable result; the agent never holds a
      live page.
- [ ] The captcha logic is NOT implemented in this repo (it lives in iamhuman);
      this task only loads + wires + proves.
- [ ] Tests cover the wiring path (mirror the repo's test style); if the spike
      shows Playwright cannot reach the case, this task is reshaped/withdrawn
      rather than forcing the approach (record the decision).
- [ ] A changeset is added (`pnpm changeset`) per the repo convention.
- [ ] Shared-write isolation: tests point any profile/config/endpoint paths at
      temp/scratch locations and assert the real ones are untouched.

## Blocked by

- `third-party-hand-loading-and-public-api` — needs the public hand API + the
  explicit load mechanism.
- `agent-exposed-hand-verb-over-rpc` — needs the Model B surfacing path to expose
  iamhuman's verb to the agent.

## Prompt

> Goal: load iamhuman captcha-solving as the FIRST third-party hand and surface
> its capability to the agent as a verb — the end-to-end Phase-2 proof of the
> "hands" prd (`work/prds/tasked/hands-pluggable-page-capabilities.md`).
>
> DO NOT START BUILDING until the open question is resolved. This task is
> `needsAnswers: true`: it is blocked on the prd's deferred Q6 spike (an
> iamhuman-specific risk, NOT a hands-primitive risk). FIRST run a throwaway
> spike to confirm Playwright can reach + operate the nested cross-origin frame
> case iamhuman needs (a WAF iframe containing a captcha iframe, via
> `frameLocator(...).frameLocator(...)` + coordinate clicks + screenshot).
> Record the result as a `work/notes/findings/<slug>.md` with a `source:`
> (captured trace / dated observation). If the spike FAILS, that falsifies the
> captcha EXAMPLE, not the hands abstraction — reshape or withdraw this task and
> surface that to a human; do not force the approach. Only after the spike
> passes and a human clears `needsAnswers` should you build the wiring.
>
> FIRST also check against reality: read the landed
> `third-party-hand-loading-and-public-api` (public `Hand`/`HandContext` +
> explicit loading) and `agent-exposed-hand-verb-over-rpc` (Model B surfacing
> over `session-rpc.ts`). If either landed differently than assumed here, route
> to needs-attention.
>
> Domain vocabulary: a **hand** closes over the live Page (`{pwPage, context,
> ensureOpen}`); **Model A** is in-process page access (iamhuman's
> `PlaywrightDriver(page)` plugs straight in — it needs screenshots, coordinate
> mouse, nested `frameLocator`, none expressible as a locator verb); **Model B**
> surfaces a hand's capability to the agent as a serializable verb over the RPC.
> The captcha logic lives in iamhuman (prd Out of Scope) — this task is loading +
> wiring + proof only.
>
> What "done" means (post-spike): iamhuman loads as a third-party hand via the
> explicit declarative mechanism and plugs into the shared host; its capability
> is invokable by the agent as a verb returning a serializable result; the
> captcha logic stays in iamhuman; tests cover the wiring; a changeset is added;
> shared locations are isolated in tests.
