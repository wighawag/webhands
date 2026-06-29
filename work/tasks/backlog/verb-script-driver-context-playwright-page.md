---
title: A driver-context `script` verb (hand the agent the live Playwright page to run one batched script) so a webhands agent can compose a sub-flow in ONE turn
slug: verb-script-driver-context-playwright-page
blockedBy: []
covers: []
---

## What to build

A new webhands verb that runs a caller-supplied **driver-context script** against
the ONE live served session, handing the script the real Playwright `Page` so it
can locate + act + auto-wait + read in a SINGLE invocation, and returns the
script's serializable result as structured output. This closes the ergonomic gap
the scoreboard exposed: the Playwright-only baseline wins largely because it
WRITES A SCRIPT and runs it in one turn, while a webhands agent must shell out one
verb per action (the "one process per action" cost, finding
`work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`).
This verb lets a webhands agent batch a sub-flow into one turn too, against the
page it ALREADY opened (warmed, logged-in, single served session) rather than
launching its own browser.

Resolved design (idea `work/notes/ideas/webhands-execute-script-verb.md`,
conversation 2026-06-29):

- **DRIVER context, full Playwright `page`.** The script is an async function
  body that receives the live Playwright `Page` (Node-side), e.g.
  `async (page) => { await page.fill('#user', u); await page.click('#login');
  return await page.locator('.inventory_list').count(); }`. It uses REAL locators +
  actions + auto-waiting (exactly what the baseline agent writes by hand), not
  page-world `eval`.
- **It does NOT supersede `eval`.** `eval` stays (a single page-world JS
  expression run via `page.evaluate`). This verb is a SIBLING. The NAME must
  signal that you get a FULL Playwright `page` / driver context (NOT a bigger
  `eval`): pick a name that makes the "you get the real `page`" affordance obvious
  (candidates: `script`, `drive`, `with-page`, `playwright-script`). Decide + RECORD
  the name; do not ship a bare `execute-script` that reads like a heavier `eval`.
- **Reuse the HAND mechanism, do not invent a new one.** A hand
  (`packages/core/src/hand-host.ts`) is already in-process code that closes over
  the live `pwPage` with "one live page, one process" page-access-only trust. This
  verb is essentially an AD-HOC, agent-supplied hand: run the caller's script with
  the SAME live-page access the hand host grants, instead of a registered hand
  module. Reuse that path; the script's RETURN value is serialized to structured
  output across the seam (that stays clean), the `page` object itself never crosses
  the wire.
- **ADR-0003 does NOT apply to the script's API.** ADR-3 governs what crosses the
  SEAM (the verb WIRE contract / agent-facing JSON: no Playwright/CDP types in the
  RETURNED message). A driver-context script runs in-process Node JS where `page`
  is just a JS object it closes over; the API the script calls is JS, not the seam.
  The returned VALUE must still be seam-clean (serializable structured output, no
  Playwright/CDP type leaking into the JSON). RECORD this boundary in the verb's
  doc so a future reader does not "fix" an ADR-3 non-violation.
- **Same security model as `eval` / hands.** The serve endpoint already runs
  caller-supplied code (README "Security note (the `serve` endpoint runs arbitrary
  code)"). This widens it from one expression to an arbitrary body + the `page`
  object, but it is the SAME loopback-only, your-own-machine trust model, and the
  SAME surface a hand already has. Document it as the same code-execution surface,
  extend the README security note to mention the script verb, do NOT present it as
  a new privilege, and keep it loopback-only like the rest.

End-to-end vertical slice:

- The seam/transport gains a way to run a driver-context script against the live
  `pwPage` (reusing the hand host's live-page access), returning the script's
  serializable result. Keep the live `page` confined exactly where `pwPage`/hands
  already live (never leak a Playwright type onto the public seam types).
- The CLI gains the new verb: it reads the script (from an arg, a `--file`, or
  stdin, pick the ergonomic that suits a CLI the agent shells out to), runs it,
  and prints the structured result in the same shape as the other verbs (and a
  clear structured error if the script throws).
- Real unit coverage in `packages/core`/`packages/cli` (it is a gated-packages
  change): a script that drives the local fixture page (locate + act + read) and
  returns a known structured result; a throwing script returns a clean structured
  error; the `page` access matches the hand-host trust model; the returned value
  is seam-serializable.
- Docs: the verb's `--help` + the `--llms-full` entry + the README security note,
  framed as the power-user batch path (verbs are the floor; this is the ramp).
- Auto-generated `webhands-<verb>` skill picks it up (the skills sync), and the
  `use-webhands` skill gains a short "batch a sub-flow with one script" note.

This is a REAL new verb in the gated packages (NOT eval-harness-only). The eval
harness is the natural place to MEASURE its payoff afterwards (a follow-up, see
below), but this task is the verb itself + its package tests/docs.

## Acceptance criteria

- [ ] A new driver-context script verb runs a caller-supplied async script with
      the live Playwright `Page` against the ONE served session and returns the
      script's serializable result as structured output (same output shape as other
      verbs; a throwing script -> a clean structured error, never a crash).
- [ ] It does NOT change or supersede `eval`; the name clearly signals a FULL
      Playwright `page` / driver context (decision recorded).
- [ ] It reuses the hand host's live-page access (the ad-hoc-hand framing), with
      the SAME "one live page, one process, page-access-only" trust; the live `page`
      never leaks onto the public seam types, and the RETURNED value is seam-clean
      (no Playwright/CDP type in the JSON).
- [ ] The verb's doc RECORDS that ADR-0003 governs the seam wire contract (which
      this respects), and that the script's in-process JS `page` API is not an
      ADR-3 surface.
- [ ] Same loopback-only code-execution trust model as `eval`/hands; the README
      security note is extended to cover it (not presented as a new privilege).
- [ ] Real unit coverage in `packages/core`/`packages/cli` (drive the local
      fixture: locate+act+read returns a known result; a throwing script -> clean
      error; trust/seam-clean asserted). `pnpm test` stays green.
- [ ] Docs updated: `--help`, `--llms-full`, the README batch-path framing, the
      auto-generated `webhands-<verb>` skill + a `use-webhands` note. A changeset
      is added.

## Blocked by

- None. Builds on the existing hand host (`packages/core/src/hand-host.ts`,
  `tasks/done/hand-host-primitive-and-builtin-hands.md`) and the `eval` verb.

## Prompt

> Goal: add a webhands verb that runs a caller-supplied DRIVER-CONTEXT script
> against the ONE live served session, handing the script the real Playwright
> `Page` so it can locate + act + auto-wait + read in a SINGLE invocation, and
> returns the serializable result as structured output. This closes the
> "one process per action" gap the scoreboard found
> (`work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`):
> it lets a webhands agent batch a sub-flow into one turn, like the Playwright
> baseline does, but against the page it ALREADY opened. Full resolved design in
> `work/notes/ideas/webhands-execute-script-verb.md`.
>
> READ FIRST: `packages/core/src/hand-host.ts` (a hand is in-process code closing
> over the live `pwPage` with "one live page, one process" page-access-only trust;
> this verb is an AD-HOC agent-supplied hand and should reuse that path);
> `packages/core/src/seam.ts` (the `eval` verb + the ADR-3 seam boundary: no
> Playwright/CDP types cross the WIRE); the `eval` implementation; the CLI verb
> wiring (`packages/cli/src/cli.ts`); README "Security note (the `serve` endpoint
> runs arbitrary code)".
>
> KEY DESIGN POINTS (resolved): DRIVER context, the script gets the full
> Playwright `Page` (NOT page-world `eval`). It does NOT supersede `eval`; the verb
> NAME must signal you get a full `page` (decide + record it). Reuse the hand host's
> live-page access rather than inventing a new mechanism. ADR-0003 governs the SEAM
> wire contract (the returned value must stay seam-clean / serializable, no
> Playwright type in the JSON), but the script's in-process JS `page` API is NOT an
> ADR-3 surface, record that so nobody "fixes" a non-violation. SAME loopback-only
> code-execution trust as eval/hands; extend the README security note, do not
> present it as a new privilege. Real unit coverage in the gated packages (drive
> the local fixture, locate+act+read returns a known result; throwing script ->
> clean structured error; trust + seam-clean asserted). Update --help / --llms-full
> / README / the generated skill + a use-webhands note. Add a changeset.
>
> What "done" means: a webhands agent can run one driver-context Playwright script
> against the warmed served page and get a structured result; eval is untouched;
> the live page reuses the hand trust model and never leaks onto the seam; the
> returned value is seam-clean; same security posture as eval, documented; gated
> packages stay green.
>
> FIRST, check against current reality: confirm the hand host still exposes live
> `pwPage` access as described and the `eval` verb shape is as described (they may
> have evolved); reconcile rather than duplicate. RECORD the non-obvious decisions
> (the verb name + how it signals "full page", how the script is supplied
> (arg/file/stdin), the exact return/error shape, and the ADR-3 boundary note).
>
> FOLLOW-UP (NOT this task): once the verb exists, MEASURE its payoff on the
> scoreboard, a webhands(-skilled)+script agent vs Playwright via `run-eval
> --compare3`/`--compare`, expected to close much of the token gap. File/leave that
> as the next eval task; do not build it here.
