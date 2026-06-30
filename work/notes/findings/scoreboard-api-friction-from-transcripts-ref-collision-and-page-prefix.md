# What the scoreboard transcripts say webhands' API surface should fix (2026-06-29)

A second transcript-level pass over the four-way scoreboard runs
(`~/.pi/agent/sessions/--tmp-scoreboard3-evals--`), this time mining the
agent-under-test sessions specifically for **webhands API-surface friction**: verb
descriptions, argument formats, the ref/handle model, and where the agent fought
the tool. Grounded in the bytes (9 webhands legs across cold/skilled/script-forward
x core-flow/discovery/parabank), not intuition. Two concrete, recurring issues
stand out, plus smaller ones.

## 1. The `ref=eN` ↔ locator MISMATCH (a two-"ref" collision) — NEW

`snapshot` returns an accessibility view whose nodes are tagged `[ref=e1]`,
`[ref=e2]`, `[ref=e3]`... The agent NATURALLY reads a snapshot, sees the element it
wants tagged `[ref=e3]`, and tries to act on it. But the action verbs
(`click`/`type`) do NOT accept a snapshot `ref=eN`: they take a Playwright LOCATOR
string, or (since the durable-ref work) a `--by-ref` handle minted by a SEPARATE
verb, `query --with-refs`. So there are TWO different things both surfaced to the
agent as a "ref":

- `snapshot`'s `[ref=eN]` — a positional tag in the a11y dump, NOT actionable.
- `query --with-refs`' `ref` — a durable handle you feed to `click/type --by-ref`.

Same word, two meanings, only one actionable. In the transcripts the agent reads
the snapshot, tries the snapshot ref (or a `getByRole` it reads off the a11y
roles), fails, and falls back to `eval` + `document.querySelectorAll(...)` to
discover real selectors, then `query`/locators to act. That fallback-to-`eval`
loop is a recurring, measurable round-trip tax (the parabank cold leg spent
`eval:7` doing exactly this DOM-spelunking).

**Fix direction (a real API-coherence fix, not a harness change):** make the
snapshot ref and the actionable ref the SAME concept, OR clearly distinguish them.
Best: `snapshot` (at least with a flag) emits refs that are DIRECTLY usable with
`click/type --by-ref`, so "read the page -> act on what you read" is one coherent
loop with no detour through `query --with-refs` or `eval`. At minimum, the
snapshot output + docs must say loudly that `[ref=eN]` is NOT a `--by-ref` handle
and point at `query --with-refs`. This is the single highest-leverage surface fix
the transcripts point at: it would collapse the read->act detour every cold run
paid.

## 2. The `page.` prefix footgun — CONFIRMED + QUANTIFIED

The locator grammar requires `page.` (`page.getByRole(...)`,
`page.locator('#id')`); a bare `getByRole(...)` throws "getByRole is not defined"
and a bare `#id` parses as a JS private field. This was already filed
(`work/notes/observations/locator-grammar-requires-page-prefix-unintuitive-for-agents.md`);
this run CONFIRMS and QUANTIFIES it: the `page.`-prefix / bare-locator confusion
recurred across ~9 of the webhands legs, e.g. the agent ran
`type "locator('[name=...]')" ...` (failed, `code: unknown`) then immediately
re-ran `type "page.locator('[name=...]')" ...` (worked), and elsewhere
`click "getByRole('link', {name:'Register'})"` -> "getByRole is not defined" ->
fell back to `eval`. Every instance is wasted turns/tokens, and it is a top
contributor (alongside #1) to the cold leg's bloat.

**Fix direction (unchanged from the observation, now with evidence to prioritise
it):** the cheapest high-leverage fix is the error + docs (make `--llms-full`/help
show ONLY the `page.`-prefixed form, and turn "getByRole is not defined" into "did
you mean `page.getByRole(...)`?"). The richer fix is to accept the bare form by
evaluating the locator with `page`/`p` in scope (an ADR-0004 addressing-contract
change, must be consistent across all locator-taking verbs). Worth a real
verb-surface task now that the scoreboard shows the cost.

## 3. Smaller friction worth noting

- **Bin discovery / `npx webhands` resolution.** Several legs burned 3-6 turns just
  finding the binary (`npx webhands` -> "not found" -> `which` -> hunt for
  `dist/bin.js`). This is partly a harness/packaging artifact (the eval cwd has no
  installed `webhands`), but it shows that the FIRST thing a cold agent does is
  fight to invoke the tool. The skilled/script-forward preambles that name the bin
  removed most of this, more evidence the discovery tax is real and skill-in-context
  is the honest config.
- **`select` / dropdown timing.** One leg hit `page.waitForSelector` /
  `locator('#fromAccountId option')` timeouts waiting for a `<select>`'s options to
  be "visible" (options are hidden by nature). A `select` verb that waits for the
  option to be ATTACHED (not visible) and selects by value/label (which exists) is
  the steer; the agent reached for raw `eval`/locators instead. Worth confirming the
  `select` verb's docs make it the obvious first choice over hand-rolled option
  locators.
- **`script` shrinks all of this.** The script-forward legs (13/12 calls vs 24-32
  cold) showed the agent writing ONE `script` function that did the whole sub-flow
  with the real `page` API, sidestepping the per-verb locator-grammar friction
  entirely (it used standard Playwright inside the function, no `page.`-prefix
  string gymnastics). So `script` is itself a partial mitigation for #1 and #2,
  another reason it closed the token gap, but the discrete verbs should still be
  fixed for the look-then-act loop where `script` is overkill.

## So: the prioritised API-surface backlog the transcripts justify

1. **Unify / disambiguate the snapshot ref vs the actionable `--by-ref` handle**
   (#1) — highest leverage; collapses the read->act detour.
2. **Fix the `page.`-prefix grammar friction** (#2) — docs+error first (cheap), the
   accept-bare-form resolver change second (ADR-0004).
3. **Make `select` (and the read verbs) the obvious choice** over falling back to
   `eval`/`querySelectorAll` (#3) — smaller, doc-led.

Each is a webhands VERB-SURFACE improvement (not an eval-harness change); the
harness just measured them. Filed as a finding so a verb-surface task can pick the
top one. The token cost of each is now measurable on the scoreboard (re-run a
cold-vs-fixed comparison to quantify the win).
