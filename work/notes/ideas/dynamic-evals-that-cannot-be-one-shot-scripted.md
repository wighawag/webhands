# Idea: DYNAMIC evals that cannot be one-shot-scripted (the goal/state shifts mid-run)

## Why

The scoreboard's honest read is that raw Playwright is cheapest on the current
evals because they are **statically scriptable**: the whole flow can be PLANNED
UP FRONT and run blind in one script (`evals/SCOREBOARD.md`; the `script`-forward
webhands config closes most of the gap by doing the same). That makes the current
tier-1/2 evals measure "can the agent author a correct script", which favours the
write-once-run-once shape and UNDER-measures the thing webhands' verb surface is
actually for: the **look -> decide -> act loop**, reading live page state and
reacting to it.

To measure where the verb surface earns its keep, we need evals that a one-shot
script CANNOT win, because the correct next action **depends on information only
visible at runtime**, and that information **changes** so it cannot be precomputed
or hardcoded. Then both toolkits must do an observe-then-act loop; the comparison
shifts from "who writes the better blind script" to "who drives an interactive
flow more cheaply/reliably", which is the real question.

## What makes an eval non-scriptable (design levers)

The goal/state must SHIFT in a way the agent can only resolve by READING the live
page mid-flow:

- **Runtime-revealed target.** The goal names WHAT to achieve but the specifics are
  only on the page at run time and vary per run: "buy the CHEAPEST in-stock item"
  on a catalogue whose prices/stock change; "transfer your ENTIRE balance" where the
  balance is whatever the account shows now; "click the product whose price ends in
  a 7". A blind script can't hardcode the choice; it must read, then pick.
- **Branch-on-observed-state.** The flow forks on something only visible at run
  time: an A/B-varied layout, a sometimes-present interstitial/cookie wall/upsell, a
  form whose required fields differ per run, an account that may or may not be in the
  broken state (the `saucedemo-discovery` `problem_user` switch is a small taste of
  this, and notably it was the eval where the gap narrowed most).
- **Multi-step where each step's input is the previous step's OUTPUT.** "Find the
  order number shown after checkout, then use it to look up the order status, then
  cancel it if it is still pending", a chain where each step needs the runtime
  result of the last, so the script can't be linear-precomputed and a re-plan is
  forced at each hop.
- **Mid-run goal shift (the strongest).** The goal itself changes based on what the
  page reveals: "add items to the cart until the subtotal exceeds the free-shipping
  threshold SHOWN ON THE PAGE, then check out", "keep transferring $X between
  accounts until one account is overdrawn, then stop and report which". The
  termination condition is a live, changing value; no fixed script encodes it.
- **Adversarial-to-precompute (anti-fragile to memorisation).** Per-run NONCE
  content (the harness already mints nonces for ParaBank): make the TARGET itself
  nonce-derived (e.g. "find the row whose memo contains <today's nonce> and act on
  it"), so even a cached script from a prior run is useless.

A good dynamic eval combines two of these so the agent provably cannot win by
scripting blind: it has to snapshot/query, reason on the result, and act, the verb
surface's home turf.

## What this measures (the hypothesis)

On a non-scriptable eval, the Playwright baseline LOSES its structural advantage:
it must also write read-react-read code (multiple script invocations, or a script
with branching that still needs fresh reads it cannot get without re-running), so
its token cost rises toward webhands', and webhands' cheap structured reads
(`snapshot`/`query` returning token-cheap a11y/rows) may even make IT cheaper. The
prediction to test:

- on the EXISTING static evals, Playwright stays cheapest (write-once);
- on the new DYNAMIC evals, the gap narrows or FLIPS, because both must loop and
  webhands' reads are token-cheaper than a Playwright agent dumping/serialising DOM
  to decide.

Either outcome is informative: a flip is the clean "webhands delivers on
interactive flows" result; no-flip tells us the read verbs need to be cheaper/
better (feeds the API-friction findings).

## How to build it (fits the existing harness)

- A new `*.eval.ts` (or a few) in `evals/src/catalogue/` with a goal whose
  end-state is fixed and harness-checkable, but whose PATH requires runtime reads
  (use the levers above). Keep the NO-PRIMING rule: the goal names the dynamic
  CONDITION ("the cheapest in-stock item", "until the on-page subtotal exceeds the
  shown threshold"), never the specific selectors/values, so neither toolkit can
  hardcode.
- The end-state assertion stays the harness's own (read via webhands verbs), as
  today; only the GOAL's nature changes. The shared-CDP surface already lets the
  Playwright leg drive the same page, so the comparison stays apples-to-apples.
- Run it under the existing `--compare`/`--agent-kind` machinery and add a
  `## Dynamic (non-scriptable) read` section to `evals/SCOREBOARD.md`. A good
  candidate target: a sandbox with per-run variation (ParaBank balances are
  naturally dynamic; a SauceDemo "cheapest in-stock" variant; or a small
  purpose-built local fixture whose layout/values randomise per run, fully
  deterministic to host, impossible to precompute).

## Risks / open questions

- **Keep the end-state DETERMINISTICALLY checkable** even though the path is
  dynamic: the harness must be able to assert success without re-deriving the
  agent's choices (e.g. assert "the order-complete page shows the cheapest item's
  price" by reading the page, not by re-running the agent's logic).
- **Don't accidentally prime.** A dynamic goal is MORE prone to leaking the method
  ("read the price list, then..."); keep the goal outcome-shaped, run it past the
  no-priming guard, and review for method-leak.
- **A capable script agent can still write a READ-AND-BRANCH script** (Playwright
  can read mid-script). The eval must force ENOUGH re-planning that a single script
  can't capture it, hence the "each step needs the previous step's runtime output"
  and "mid-run termination on a live value" levers, which a single blind script
  genuinely cannot encode. Spike one and confirm the baseline really cannot
  one-shot it before building a suite.
- Start with ONE well-designed dynamic eval, measure the gap vs a static one, and
  only then build a tier of them.

## Provenance

Conversation 2026-06-29, after the four-way scoreboard. The user asked for a
benchmark that "cannot be scripted as info can be assessed in one go, e.g. because
the goal shifts", to measure the verb surface's interactive-loop value rather than
static script-authoring.
