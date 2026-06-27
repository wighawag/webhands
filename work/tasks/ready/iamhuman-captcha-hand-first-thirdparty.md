---
title: Load iamhuman captcha-solving as the first third-party hand (Phase 2 proof)
slug: iamhuman-captcha-hand-first-thirdparty
prd: hands-pluggable-page-capabilities
blockedBy: [third-party-hand-loading-and-public-api, agent-exposed-hand-verb-over-rpc]
covers: [3, 4]
---

## What to build

The end-to-end Phase-2 proof: load iamhuman captcha-solving as the FIRST
third-party hand through the public hand API, and surface its capability to the
agent as a verb (Model B). This is the "user installed webhands, needs iamhuman"
scenario resolved: the operator names iamhuman as a hand and their agent gains
its verb, WITHOUT hand-wiring Playwright themselves.

iamhuman's `PlaywrightDriver(page)` code plugs straight into the live
hand-context (`{pwPage, context, ensureOpen}`) — Model A in-process page access
is exactly the foundation it needs (everything iamhuman's driver uses —
`page.screenshot`, `page.mouse.*`, `page.evaluate`, `page.click`, AND
`frameLocator`-chained traversal for the nested-frame case — is already on the
live `pwPage`). Its agent-facing result is surfaced over the session RPC as a
serializable value (Model B).

Q6 STATUS (see `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`):
the Playwright mechanism is verified — both absolute-coordinate mouse+screenshot
AND `frameLocator(WAF).frameLocator(hcaptcha)` DOM read/click two cross-origin
frames deep work on a synthetic tree, so the approach is NOT foreclosed by a
Playwright limitation. STILL OPEN (iamhuman-owned, does not block this task): the
live-Imperva END-TO-END — whether a CDP-driven Chromium is served the same DOM
(vs. an anti-bot block) and whether inject-token + fire-callback satisfies live
Imperva server-side validation — which only a live-Imperva spike can close. (The
Imperva sitekey itself is PAGE-READABLE: per iamhuman's finding
`work/notes/findings/imperva-nests-hcaptcha-in-cross-origin-iframes.md` ##
Update 2026-06-27 — corrected per-frame probe on `imperva.tender-lab.dev`,
2026-06-27 — the sitekey is scrapeable from the same-origin `#main-iframe` as
`div.h-captcha[data-sitekey]` and in the hCaptcha iframe `src` hashes; the
earlier "out-of-band sitekey" claim was a too-shallow top-frame probe and is
no longer true.) THEREFORE scope this task's proof to a STANDARD direct
hCaptcha embed (no nested frames) — which exercises the load + Model-B wiring
fully without depending on the unverified Imperva end-to-end — because the open
spike is the live-Imperva end-to-end (anti-bot detection + server-side token
acceptance), NOT sitekey acquisition. The Imperva end-to-end proof is a named
follow-up, not part of this task's done.

The captcha LOGIC lives in iamhuman, not in this repo (prd Out of Scope); this
task is the LOADING + WIRING + PROOF that a real third-party hand composes
through the host and reaches the agent.

## Acceptance criteria

- [ ] (Q6 — PARTIALLY resolved; recorded in
      `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`)
      The Playwright frame MECHANISM is spike-verified (coordinate+screenshot AND
      `frameLocator`-chained read/click two cross-origin frames deep), so the
      approach is not foreclosed and webhands' `pwPage` exposes all of it. The
      REAL-Imperva end-to-end stays an iamhuman-owned open spike and is OUT of
      this task's scope.
- [ ] This task's captcha proof targets a STANDARD direct hCaptcha embed (no
      nested frames, sitekey scrapeable); it does NOT depend on the unverified
      Imperva end-to-end.
- [ ] iamhuman is loaded as a third-party hand via the explicit declarative
      mechanism (named in config, pinned entry) and plugs into the same host the
      built-in hands use.
- [ ] iamhuman's capability is surfaced to the agent as a verb over the session
      RPC (Model B), returning a serializable result; the agent never holds a
      live page.
- [ ] The captcha logic is NOT implemented in this repo (it lives in iamhuman);
      this task only loads + wires + proves.
- [ ] Tests cover the wiring path (mirror the repo's test style).
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
> Q6 IS PARTIALLY RESOLVED (this task is unblocked but scoped): read
> `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md` FIRST,
> and iamhuman's own `work/notes/findings/imperva-nests-hcaptcha-in-cross-origin-iframes.md`
> — specifically its ## Update 2026-06-27 (the correction; corrected per-frame
> probe on `imperva.tender-lab.dev`, 2026-06-27).
> Key results: (1) On Imperva, hCaptcha tiles are nested TWO cross-origin frames
> deep and unreachable from the host document; BUT the sitekey IS page-readable
> — it is scrapeable from the same-origin `#main-iframe` (as
> `div.h-captcha[data-sitekey]` and in the hCaptcha iframe `src` hashes), so the
> earlier "sitekey out-of-band on Imperva" claim (a too-shallow top-frame probe)
> no longer holds. (2) Playwright's frame MECHANISM is
> spike-verified — BOTH absolute-coordinate mouse+screenshot AND
> `frameLocator(WAF).frameLocator(hcaptcha)` DOM read/click two cross-origin
> frames deep work — so the live `pwPage` the hand-context provides exposes
> everything iamhuman needs. (3) STILL OPEN (iamhuman-owned, NOT this task's
> blocker): the live-Imperva END-TO-END — whether a CDP-driven Chromium is served
> the same DOM (vs. an anti-bot block) and whether inject-token + fire-callback
> satisfies live Imperva server-side validation, which a static capture cannot
> close. THEREFORE scope THIS task's captcha proof to a STANDARD direct
> hCaptcha embed (no nested frames); leave the live-Imperva end-to-end as a named
> iamhuman-side follow-up. The open spike is the live end-to-end, NOT sitekey
> acquisition — on Imperva the sitekey is page-readable from the same-origin
> `#main-iframe`.
>
> FIRST also check against reality: read the landed
> `third-party-hand-loading-and-public-api` (public `Hand`/`HandContext` +
> explicit loading) and `agent-exposed-hand-verb-over-rpc` (Model B surfacing
> over `session-rpc.ts`). If either landed differently than assumed here, route
> to needs-attention.
>
> Domain vocabulary: a **hand** closes over the live Page (`{pwPage, context,
> ensureOpen}`); **Model A** is in-process page access (iamhuman's
> `PlaywrightDriver(page)` plugs straight in — it uses `page.screenshot`,
> `page.mouse.*`, `page.evaluate`, `page.click`, and for nested frames
> `frameLocator`-chained traversal, all on the live `pwPage`); **Model B**
> surfaces a hand's capability to the agent as a serializable verb over the RPC.
> The captcha logic lives in iamhuman (prd Out of Scope) — this task is loading +
> wiring + proof only, scoped to a standard direct hCaptcha embed.
>
> What "done" means: iamhuman loads as a third-party hand via the
> explicit declarative mechanism and plugs into the shared host; its capability
> is invokable by the agent as a verb returning a serializable result; the
> captcha logic stays in iamhuman; tests cover the wiring; a changeset is added;
> shared locations are isolated in tests.
