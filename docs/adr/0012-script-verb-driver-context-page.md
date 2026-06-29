---
status: accepted
---

# A `script` verb hands the caller the live Playwright page (driver context), batching a sub-flow into one call (sits beside ADR-0004; the return stays ADR-0003-clean)

webhands gains a `script` verb: it runs a caller-supplied DRIVER-CONTEXT script against the ONE live served session, handing the script the real Playwright `Page`, so a single call can locate + act + auto-wait + read a whole sub-flow and return its serializable result. This is the power-user batch ramp beside the composable verb floor: the verbs stay the safe, snapshot-cheap default; `script` is the escape hatch for when the agent already knows the flow.

We add it because the first webhands-vs-Playwright scoreboard runs showed the Playwright-only baseline wins largely on TOKENS, and the transcript analysis (`work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`) traced that to ONE PROCESS PER ACTION: the baseline WRITES A SCRIPT (locate -> click -> type -> wait -> read) and runs it in one model turn, while a webhands agent shells out one `webhands <verb>` per action, each a separate re-primed turn (the `cacheRead` that dominates the total). `eval` is close but not it: it runs a single page-world EXPRESSION via `page.evaluate` and cannot drive a multi-step flow with real locators + actions + auto-waiting. `script` closes the gap directly, against the page the agent ALREADY opened (the warmed, logged-in, single served session) rather than launching its own browser.

## What it is (the resolved design)

- **DRIVER context, the FULL Playwright `page`.** The script is JS that evaluates to a function of the page, e.g. `async (page) => { await page.fill('#user', u); await page.click('#login'); return await page.locator('.inventory_list').count(); }`. It uses REAL locators + actions + auto-waiting (exactly what the baseline agent writes by hand), NOT a page-world `evaluate`. The verb's NAME + help signal this driver context, so `script` is a SIBLING to `eval`, not a bigger `eval`.
- **It does NOT supersede `eval`.** `eval` stays unchanged (a single page-world JS expression). `script` is a distinct verb; the two coexist.
- **A new BUILT-IN `scriptHand`.** In webhands' language a VERB is contributed by a HAND, and the shipped verbs ARE built-in hands composed over the internal hand-host (CONTEXT.md; ADR-0006). `script` is contributed by a new built-in `scriptHand` shaped exactly like `evalHand`: it closes over the live `HandContext.pwPage` and runs the caller's script against it in-process. It is a BUILT-IN hand, NOT a third-party `hands.json`-loaded hand (see the trust boundary below).
- **Source from `--file <path>` OR an inline string OR stdin** (exactly one). The common case is `webhands script --file ./flow.js` (the agent writes a flow file and points the verb at it, like the baseline does); an inline `webhands script "<js>"` gives `eval`-style parity for a short snippet; stdin is the optional third source.

## The two boundaries (load-bearing; record so nobody "fixes" a non-violation)

- **ADR-0003 does NOT apply to the script's `page` API.** ADR-3 governs what crosses the SEAM (the verb WIRE contract / agent-facing JSON: no Playwright/CDP types in the RETURNED message). A driver-context script runs IN-PROCESS Node JS where `page` is just a JS object the script closes over; the API the script CALLS (`page.fill`, `page.locator`, ...) is plain JS, NOT the seam. So there is NO ADR-3 constraint on what Playwright methods the script uses. A future reader must not "fix" this as an ADR-3 leak: it is not one. This is the SAME shape a hand already has (in-process code over the live `pwPage`); `script` is essentially an ad-hoc, agent-supplied hand body.
- **The RETURN VALUE must stay ADR-3-clean.** What DOES cross the seam (and, over the served session, the RPC wire) is the script's RETURN. So it MUST be seam-clean: a serializable value with no Playwright/CDP type (return a `.count()` number, a `.textContent()` string, a plain object, never a live `Locator`/`Page`/handle). The live `page` itself NEVER crosses; the script closes over it in-process and only its serializable result comes back, exactly as `eval`'s structured-clone result does. A script that THROWS rejects with a transport-neutral `Error` (no Playwright/CDP type leaks), so a thrown script is a CLEAN structured error, never a crash. ADR-0003 therefore STANDS and is RESPECTED on the return; it is simply not the surface that governs the in-process `page` calls.

## The trust boundary

`script` is the SAME page-script code-execution surface as `eval`: caller-supplied JS run against your own logged-in session, loopback-only, your-own-machine. The `serve` endpoint already runs caller-supplied code (`eval` runs a JS expression; a `click`/`type` locator is a raw Playwright expression the controller evaluates, ADR-0004). `script` widens that from one page-world EXPRESSION to a driver-context BODY + the `page` object, but it is the SAME loopback-only trust model, NOT a new privilege.

It is EXPLICITLY NOT the larger `hands.json` hand-loading surface. "Loading a hand == trusting an in-process npm dependency" (CONTEXT.md; ADR-0007), a strictly larger surface than the page-sandboxed `eval`. `script` loads NO module: it reads a JS SOURCE file (or a string, or stdin) and runs it. "No module load" means no hand / npm-dependency import, NOT "no reading a source file". So the CONTEXT.md hand-loading warning does NOT apply to `script`; its surface is the page-script `eval` one. This boundary is stated in the verb doc and in the README security note (extended to name `script` alongside `eval`, framed as the same surface, not a new privilege).

## Considered options

- **Page-context (`page.evaluate`) script (rejected):** simpler (page-world JS only), but it cannot use real locators / auto-waiting / actions, so it would NOT match what the baseline writes and would not close the ergonomic gap. The whole point is the DRIVER context.
- **A third-party `hands.json`-loaded hand (rejected):** that is the larger npm-dependency trust surface, gated by the explicit `hands.json` trust act (ADR-0007). `script` needs the page-script surface of `eval`, not module loading; a built-in `scriptHand` is the right tier.
- **Extending `eval` to a multi-statement body (rejected):** would re-mean `eval` (a single page-world expression) and conflate the page-world vs driver context. A distinct `script` verb keeps both surfaces honest.

## Consequences

- ADR-0003 STANDS and is RESPECTED: the script's RETURN is seam-clean (serializable, no Playwright/CDP type); the in-process `page` API is not an ADR-3 surface. ADR-0004 (the locator-expression code-execution surface) is the closest sibling; `script` widens the same loopback-only page-script surface.
- `eval` is untouched. `script` is a new built-in verb across the seam, the RPC wire (a closed `{verb: 'script', source, options?}` request, 1:1 to `page.script`), and the CLI/MCP surface; the auto-generated `webhands-script` skill picks it up.
- The README security note now names `script` alongside `eval` (same surface, not a new privilege); the endpoint stays loopback-only.
- FOLLOW-UP (separate task): MEASURE the payoff on the scoreboard (a webhands(-skilled)+`script` agent vs the Playwright baseline via `run-eval --compare`), expected to close much of the token gap. Not built here.
