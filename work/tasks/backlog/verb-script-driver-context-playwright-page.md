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
- **The verb NAME is `script`** (decided). It does NOT supersede `eval`: `eval`
  stays (a single page-world JS expression run via `page.evaluate`); `script` is a
  SIBLING whose name + help signal that you get the FULL Playwright `page` (driver
  context), not a bigger `eval`.
- **`script` reads its JS from `--file <path>` OR an inline string argument**
  (and optionally stdin). The common case is `webhands script --file ./flow.js`,
  the agent writes a flow file (exactly what the baseline agent does) and points
  the verb at it; an inline `webhands script "<js>"` gives `eval`-style parity for
  short snippets. NOTE the precise distinction: reading a `.js` SOURCE file (or a
  string) and running it is the SAME page-script trust surface as `eval` (caller
  JS against your own session); it is NOT "loading a hand" (no `hands.json`, no npm
  MODULE import, no persistent in-process peer). "No module load" means no hand /
  npm dependency loading, NOT "no reading a source file".
- **Implement it as a new BUILT-IN hand `scriptHand` contributing the `script`
  verb** (the same shape `evalHand` contributes `eval`;
  `packages/core/src/hand-host.ts`). In webhands' language a VERB is contributed by
  a HAND, and the eight shipped verbs ARE built-in hands composed over the
  hand-host (CONTEXT.md). So `scriptHand` closes over the live `HandContext.pwPage`
  (like `evalHand`) and runs the caller's driver-context script against it. This is
  a BUILT-IN hand, NOT a third-party `hands.json`-loaded hand: it carries the
  page-script trust surface of `eval`, not the larger npm-dependency trust surface
  of a loaded hand (the CONTEXT.md "loading a hand == trusting an in-process npm
  dependency" warning does NOT apply here). The script's RETURN value is serialized
  to structured output across the seam (that stays clean); the `page` object itself
  never crosses the wire.
- **ADR-0003 does NOT apply to the script's API.** ADR-3 governs what crosses the
  SEAM (the verb WIRE contract / agent-facing JSON: no Playwright/CDP types in the
  RETURNED message). A driver-context script runs in-process Node JS where `page`
  is just a JS object it closes over; the API the script calls is JS, not the seam.
  The returned VALUE must still be seam-clean (serializable structured output, no
  Playwright/CDP type leaking into the JSON). RECORD this boundary in the verb's
  doc so a future reader does not "fix" an ADR-3 non-violation.
- **Same code-execution surface as `eval` (NOT the hand-loading surface).** The
  serve endpoint already runs caller-supplied code (README "Security note (the
  `serve` endpoint runs arbitrary code)"). `script` widens that from one page-world
  EXPRESSION to a driver-context async BODY + the `page` object, but it is the SAME
  loopback-only, your-own-machine, page-script trust surface as `eval`. It is
  EXPLICITLY NOT the larger `hands.json` hand-loading surface ("loading a hand ==
  trusting an in-process npm dependency", CONTEXT.md) because no npm module is
  loaded, only a JS source file/string is read and run. Extend the README security
  note to mention `script` alongside `eval`, framed as the same surface (not a new
  privilege), and keep it loopback-only.
- **Record the decision in a short ADR** (finding from review). A new public verb
  that widens the `serve` code-execution surface deserves an ADR sibling to
  ADR-0004 (which governs the locator-expression surface): write
  `docs/adr/<next>-script-verb-driver-context-page.md` capturing WHY a `script`
  verb (the one-process-per-action token cost the scoreboard exposed), the
  driver-context-`page` design, the `scriptHand`-built-in-hand mechanism, and the
  TRUST BOUNDARY (same page-script surface as `eval`; NOT the hands.json
  module-loading surface; loopback-only). Follow the repo's ADR format.

End-to-end vertical slice:

- A new built-in `scriptHand` in `packages/core/src/hand-host.ts` contributing the
  `script` verb, modeled on `evalHand`: it closes over `HandContext.pwPage` and
  runs the caller's driver-context script against the live page, returning the
  script's serializable result. Keep the live `page` confined exactly where
  `pwPage`/the other hands already live (never leak a Playwright type onto the
  public seam types).
- The CLI gains the `script` verb: it reads the script from `--file <path>` OR an
  inline string argument (and optionally stdin), runs it, and prints the structured
  result in the same shape as the other verbs (and a clear structured error if the
  script throws). Mirror how `eval` is wired in `packages/cli/src/cli.ts`.
- Real unit coverage in `packages/core`/`packages/cli` (it is a gated-packages
  change): a script (via `--file` AND via inline string) that drives the local
  fixture page (locate + act + read) and returns a known structured result; a
  throwing script returns a clean structured error; the `page` access matches the
  hand-host trust model; the returned value is seam-serializable.
- Docs: the verb's `--help` + the `--llms-full` entry + the README security note +
  the new ADR, framed as the power-user batch path (verbs are the floor; this is
  the ramp).
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
- [ ] The verb is named `script`, does NOT change or supersede `eval`, and its
      name + help signal you get the FULL Playwright `page` (driver context).
- [ ] `script` reads its JS from `--file <path>` AND an inline string argument
      (stdin optional); both paths are unit-covered.
- [ ] It is implemented as a new BUILT-IN `scriptHand` contributing the `script`
      verb (the `evalHand` shape), closing over `HandContext.pwPage`; the live
      `page` never leaks onto the public seam types, and the RETURNED value is
      seam-clean (no Playwright/CDP type in the JSON).
- [ ] The trust surface is the SAME page-script surface as `eval` (caller JS,
      loopback-only), EXPLICITLY NOT the `hands.json` hand-loading / npm-dependency
      surface; this is stated in the verb doc + the ADR.
- [ ] The verb's doc RECORDS that ADR-0003 governs the seam wire contract (which
      this respects), and that the script's in-process JS `page` API is not an
      ADR-3 surface.
- [ ] A short ADR (`docs/adr/<next>-...`) records the script verb: why, the
      driver-context-`page` + `scriptHand` design, and the trust boundary
      (eval-like page-script surface, not hand-loading; loopback-only).
- [ ] The README security note is extended to cover `script` (same surface as
      `eval`, not a new privilege).
- [ ] Real unit coverage in `packages/core`/`packages/cli` (drive the local
      fixture: locate+act+read returns a known result; a throwing script -> clean
      error; trust/seam-clean asserted). `pnpm test` stays green.
- [ ] Docs updated: `--help`, `--llms-full`, the README batch-path framing, the
      auto-generated `webhands-script` skill + a `use-webhands` note. A changeset
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
> READ FIRST: `packages/core/src/hand-host.ts` (verbs are BUILT-IN HANDS composed
> over the hand-host; `evalHand` is the model, it closes over `HandContext.pwPage`
> with "one live page, one process" page-access-only trust); `CONTEXT.md` (the
> `verb`/`hand` glossary: a verb is contributed by a hand; a third-party hand is
> the `hands.json` npm-dependency trust act, which `script` is NOT);
> `packages/core/src/seam.ts` (the `eval` verb + the ADR-3 seam boundary: no
> Playwright/CDP types cross the WIRE); the `eval` implementation; the CLI verb
> wiring (`packages/cli/src/cli.ts`); README "Security note (the `serve` endpoint
> runs arbitrary code)"; the repo ADR format under `docs/adr/`.
>
> KEY DESIGN POINTS (resolved): the verb is named `script`. DRIVER context: the
> script gets the full Playwright `Page` (NOT page-world `eval`); it does NOT
> supersede `eval`. Implement it as a NEW BUILT-IN `scriptHand` contributing the
> `script` verb (the `evalHand` shape, closing over `HandContext.pwPage`), NOT a
> third-party `hands.json`-loaded hand. `script` reads its JS from `--file <path>`
> OR an inline string arg (stdin optional). TRUST: same page-script surface as
> `eval` (caller JS, loopback-only), EXPLICITLY NOT the hands.json hand-loading /
> npm-dependency surface (no module is loaded, only a source file/string is read).
> ADR-0003 governs the SEAM wire contract (the returned value must stay seam-clean
> / serializable, no Playwright type in the JSON), but the script's in-process JS
> `page` API is NOT an ADR-3 surface, record that so nobody "fixes" a non-violation.
> Write a short ADR (sibling to ADR-0004) recording the verb, the design, and the
> trust boundary. Extend the README security note to cover `script` (same surface
> as `eval`, not a new privilege). Real unit coverage in the gated packages (via
> `--file` AND inline string: drive the local fixture, locate+act+read returns a
> known result; throwing script -> clean structured error; trust + seam-clean
> asserted). Update --help / --llms-full / README / the generated `webhands-script`
> skill + a use-webhands note. Add a changeset.
>
> What "done" means: a webhands agent can run one driver-context Playwright script
> (from `--file` or an inline string) against the warmed served page and get a
> structured result; `eval` is untouched; `script` is a built-in `scriptHand` whose
> live page reuses the hand-host access and never leaks onto the seam; the returned
> value is seam-clean; same eval-like (not hand-loading) security surface,
> documented in the README + a new ADR; gated packages stay green.
>
> FIRST, check against current reality: confirm the hand host still exposes live
> `pwPage` access via `HandContext` and `evalHand` is shaped as described, and that
> no `script` verb already exists (they may have evolved); reconcile rather than
> duplicate. RECORD the non-obvious decisions (how `script` signals "full page",
> the `--file`/inline source handling, the exact return/error shape, the ADR-3
> boundary note, and the ADR's trust-boundary statement).
>
> FOLLOW-UP (NOT this task): once the verb exists, MEASURE its payoff on the
> scoreboard, a webhands(-skilled)+script agent vs Playwright via `run-eval
> --compare3`/`--compare`, expected to close much of the token gap. File/leave that
> as the next eval task; do not build it here.
