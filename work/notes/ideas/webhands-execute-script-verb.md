# Idea: an `execute-script` (batch) verb so the agent can run a sub-flow in one shot

## The gap

The scoreboard transcripts (`work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`)
show the Playwright-only baseline beats webhands on tokens largely because it
WRITES A SCRIPT (locate -> click -> type -> wait -> read) and runs it in ONE turn,
while the webhands agent must shell out one `webhands <verb>` per action, each a
separate model turn (re-primed context => the `cacheRead` that dominates the
total). webhands has no way to batch a sub-flow.

`eval` is close but not it: it runs a single JS EXPRESSION and returns a
serializable value. It cannot run a multi-statement automation snippet that
locates, acts, waits, and reads several things in the served page/Playwright
context.

## The idea (RESOLVED design, conversation 2026-06-29)

A first-class verb that takes a SCRIPT and runs it once against the live served
session, returning a structured result. The discrete verbs stay the floor + the
safe snapshot-cheap path; the script verb is the power ramp for when the agent
already knows the flow.

**Resolved decisions:**

1. **DRIVER-CONTEXT, full Playwright `page`** (not page-context). The script gets
   the live Playwright `Page` and uses real locators + actions + auto-waiting,
   e.g. `async (page) => { await page.fill(...); await page.click(...); return
   await page.locator(...).textContent() }`. This is EXACTLY what the baseline
   agent writes by hand; giving it as a verb closes the ergonomic gap directly.
   - **ADR-0003 does NOT apply here** (user call): ADR-3 governs what crosses the
     SEAM (the verb WIRE contract / agent-facing JSON, no Playwright/CDP types in
     the returned message). A driver-context script runs IN-PROCESS Node JS where
     `page` is just a JS object the script closes over; the API the script uses is
     JS, not the seam. This is the SAME shape a **hand** already has
     (`packages/core/src/hand-host.ts`: a hand is in-process code that closes over
     the live `pwPage`, "one live page, one process", page access only). So
     `execute-script` is essentially an **ad-hoc, agent-supplied hand**: reuse the
     hand host's live-page access, just driven by a caller-supplied script instead
     of a registered hand module. The script's RETURN value is still serialized
     across the seam as structured output (that part stays ADR-3-clean); the
     `page` object itself never crosses the wire.
2. **Does NOT supersede `eval`.** `eval` stays (a single page-world JS
   expression). `execute-script` is a sibling: the NAME should signal that you get
   a FULL Playwright `page` (driver context), distinct from `eval`'s page-world
   expression. (Name candidates that hint "full playwright page":
   `playwright-script` / `with-page` / `script --page` / `drive`; pick one that
   makes the "you get the real `page`" affordance obvious. NOT a bare
   `execute-script` that reads like a bigger `eval`.)
3. **Same security model as `eval`/hands** (user call): the serve endpoint already
   runs caller-supplied code (README "Security note"); a driver-context script
   widens it from one expression to an arbitrary body + the `page` object, but it
   is the SAME loopback-only, your-own-machine trust model, documented as the SAME
   code-execution surface (and the SAME surface a hand already has), not a new
   privilege.

**Philosophy fit** (user call): this is the exception that confirms the rule.
Verbs are used when they make sense; an agent could already drop to raw Playwright
anyway (the baseline proves it). webhands offering a script verb is just a NICER
way to get that, against a page it ALREADY opened (the warmed, logged-in, single
served session), instead of launching its own browser. It does not dilute the
composable-verbs identity; it acknowledges the power-user path webhands users take
regardless.

Structured stdout (like the other verbs), runs against the ONE live page, no new
browser.

## Why it fits webhands

- It is the "provide both APIs where it makes sense" stance: keep the composable
  verbs, ADD a batch escape hatch, rather than forcing every interaction through a
  separate process.
- It directly attacks Cause 2 of the token gap (one-process-per-action), the
  recurring cost, without touching the verb surface's safety story.

## Risks / open questions

- **The eval/`eval` security note already applies** (the serve endpoint runs
  caller-supplied code; README "Security note"). A script verb widens that surface
  from one expression to an arbitrary body, so the SAME loopback-only + trust model
  must hold, and it should be documented as the same code-execution surface, not a
  new privilege.
- Driver-context vs page-context is the real design fork (Playwright power vs
  page-JS simplicity). Spike both against a real eval and measure the token saving
  before committing.
- Does it undercut the snapshot-cheap discipline? (A script can read a lot at once;
  that is the point, but it should still return STRUCTURED, bounded output, not dump
  the DOM.)
- Measure it on the scoreboard: a webhands agent WITH the script verb should close
  much of the gap to the Playwright baseline; that delta is the idea's payoff and is
  directly measurable via `run-eval --compare`.

## Provenance

Conversation 2026-06-29, analysing the first webhands-vs-Playwright scoreboard runs
(`evals/SCOREBOARD.md`) at the transcript level. The user observed that the
baseline's advantage comes from executing scripts and proposed webhands support the
same directly.
