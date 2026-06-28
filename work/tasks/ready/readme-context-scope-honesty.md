---
title: README/CONTEXT scope-honesty update (capable, not a solver)
slug: readme-context-scope-honesty
prd: broaden-agent-verb-surface
blockedBy: [frame-aware-query-token-harvest-captcha-proof, vision-tile-captcha-end-to-end-proof]
covers: [15, 16]
---

## What to build

Update the project's scope/positioning prose (README.md, CONTEXT.md, and the
bundled `use-webhands` skill where it echoes the scope claim) to be HONEST about
the broadened surface, WITHOUT overclaiming. The current docs say "this tool does
NOT bypass authentication or solve CAPTCHAs". After this prd, that statement needs
a precise refinement:

- webhands still ships NO solver and NO provider key, and still does the one-time
  human login / challenge-clearance in `setup-profile`. "We do not solve it" stays
  true.
- BUT the verb surface is now rich enough that a capable agent WITH ITS OWN KEY
  can solve a captcha by poking the page (both families: token-harvest via the
  frame-aware `query` read + `type` + callback; vision/tile via the Tier-4
  coordinate/screenshot/cross-origin verbs). So the honest line is: "we do not
  solve it; we no longer stand in the way" — capability, not a solver.
- Reaffirm the HAND tier as the SIMPLER path: a dumb agent + a third-party hand
  (iamhuman today, a future buy-on-amazon hand) still gets there in one call, even
  though a smart agent can now do it over several verb turns. Both paths coexist.
- Keep the personal-use / own-session / own-IP framing and the security note
  intact (the broadened surface does not change those).

This is a docs/positioning task: prose accuracy is the deliverable. It must
reflect what actually landed (the proofs), so it is sequenced AFTER both captcha
proofs.

## Acceptance criteria

- [ ] README.md and CONTEXT.md scope/positioning sections are updated to the
      "capable, not a solver" framing: no built-in solver/key, but the surface no
      longer PREVENTS an agent (with its own key) from solving a captcha.
- [ ] The hand tier is reaffirmed as the simpler path (dumb agent + hand = one
      call), coexisting with the verbs-only path.
- [ ] The personal-use / own-session / own-IP scope and the `serve`-endpoint
      security note are preserved (not weakened).
- [ ] The bundled `use-webhands` skill's scope wording (if it restates the
      no-captcha claim) is updated consistently.
- [ ] The claims MATCH what landed (the two captcha proofs + the Tier-1/3/4 verbs);
      no overclaim (we still ship no solver/key).
- [ ] A changeset is added if the repo convention treats doc/skill changes as
      changeset-worthy (follow the existing convention).

## Blocked by

- `frame-aware-query-token-harvest-captcha-proof` and
  `vision-tile-captcha-end-to-end-proof` — the prose must describe BOTH captcha
  families as actually-proven, so it lands after both proofs.

## Prompt

> Goal: update webhands' scope/positioning prose to be honest about the broadened
> verb surface — "we do not solve captchas (no solver, no key shipped), but the
> surface no longer stands in the way of a capable agent that brings its own key"
> — while reaffirming hands as the simpler path. Deliverable from the prd
> `work/prds/tasked/broaden-agent-verb-surface.md` (User Stories 15, 16).
>
> CHECK REALITY FIRST: both captcha-proof tasks
> (`frame-aware-query-token-harvest-captcha-proof`,
> `vision-tile-captcha-end-to-end-proof`) must have landed — your prose must
> describe what ACTUALLY shipped, not the plan. Read what they proved and the
> Tier-1/3/4 verbs that landed; if reality differs from this task's assumptions,
> route to needs-attention.
>
> Where to look: the top-level README.md "Scope and honesty" section and the
> "No login-bypass, no CAPTCHA-solving" bullet; CONTEXT.md's scope framing; the
> bundled `use-webhands` skill if it restates the no-captcha claim. Keep the
> personal-use / own-session / own-IP framing and the `serve` security note
> intact.
>
> Domain vocabulary: webhands ships NO solver and NO provider key; the agent brings
> its own. The token-harvest family solves via a frame-aware `query` read of the
> sitekey + `type` + callback; the vision/tile family via the Tier-4
> coordinate/screenshot/cross-origin verbs. A **hand** (iamhuman, etc.) is the
> SIMPLER path (one call for a dumb agent); the verbs-only path is for a capable
> agent. Both coexist.
>
> What "done" means: README + CONTEXT (+ the skill if applicable) state the
> "capable, not a solver" line accurately, reaffirm the hand path, preserve the
> existing scope/security framing, and overclaim nothing; a changeset if the
> convention applies.
