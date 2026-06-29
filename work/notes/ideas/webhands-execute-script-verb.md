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

## The idea

A first-class verb (`execute-script` / `run` / `batch`, name TBD) that takes a
SCRIPT and runs it once against the live served session, returning a structured
result. Two flavours worth weighing:

- **Page-context script** (extends `eval`): a multi-statement async JS body run in
  the PAGE (`() => { ... return result }`), so the agent can do several DOM reads/
  writes and return a structured blob in one call. Cheap to build on top of `eval`;
  limited to what page-context JS can do (no Playwright auto-waiting / actionability).
- **Driver-context script** (the more powerful one): a snippet that gets the
  Playwright `page` (or the webhands verb set) and can use real locators + actions +
  auto-waiting, e.g. `async (page) => { await page.fill(...); await page.click(...);
  return await page.locator(...).textContent() }`. This is exactly what the baseline
  agent writes by hand; giving it as a verb closes the ergonomic gap directly. It
  reuses the same served browser, so it stays single-session and the harness can
  still read the end state.

Either way: structured stdout (like the other verbs), runs against the ONE live
page, no new browser. The discrete verbs stay the floor + the safe snapshot-cheap
path; the script verb is the power ramp for when the agent already knows the flow.

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
