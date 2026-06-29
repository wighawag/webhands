# The Playwright-only baseline scores a false FAIL: the agent drives its OWN browser, the harness reads a DIFFERENT one (2026-06-29)

## What happened

First real `run-eval --compare` against a live site (`saucedemo-core-flow`,
tier-1), same agent + model on both legs (`pi --print --mode json`,
`etherplay/claude-opus-4-8`, `--parse-usage`), both toolkits handed to the agent
ready-to-use (the webhands leg got the local `webhands` bin; the Playwright-only
leg got a resolvable `playwright` + the cached chromium browsers, the
"easy for a user" setup). Result:

```
comparison: saucedemo-core-flow (same goal + assertion, two toolkits)
  shell       PASS   milestones 0/4   tokens: in 848 / out 16.1k / cacheRead 15233.7k / cacheWrite 517.6k / total 15768.2k
  playwright  FAIL   milestones 0/4   tokens: in 296 / out  7.6k / cacheRead  2757.8k / cacheWrite 198.3k / total  2964.1k
```

The Playwright-only leg's FAIL is a **FALSE NEGATIVE**. The agent's own log proves
it completed the entire purchase end to end:

```
[flow] ORDER COMPLETE CONFIRMATION: Thank you for your order!
[flow] Final URL: https://www.saucedemo.com/checkout-complete.html
```

It logged in, sorted by price, found the cheapest by reading every price (not by
assuming sort order), added it, checked out as Ada Lovelace, reached
`checkout-complete.html`, and deliberately left the browser open. By the eval's
OWN end-state definition (`.checkout_complete_container` present + URL contains
`checkout-complete`) that is a textbook PASS. The harness scored it FAIL anyway.

## Root cause: two browsers, never the same page

`runEval` starts ONE webhands serve session under an isolated `WEBHANDS_HOME` and
its end-state assertion reads THAT session via the webhands `VerbClient`. The
webhands-leg agent drives that same session (its `npx webhands <verb>` calls hit
the harness's home), so the harness reads the page the agent acted on. Good.

But the Playwright-only agent, by the recorded design decision of
`eval-playwright-only-baseline-comparison`, drives its OWN Playwright: it
`chromium.launch()`-es a SEPARATE browser process and never touches webhands. The
harness still asserts against its OWN serve session, which the baseline agent
never navigated. So the harness reads a blank/login page in a browser the agent
ignored, sees no order-complete container, and scores FAIL, no matter how
perfectly the agent did the task in ITS browser.

The task's premise that "the harness keeps its own serve session for its OWN
verdict reads, even in Playwright-only mode" is internally consistent ONLY for an
agent that acts on that SAME session. A truly Playwright-only agent driving its
own browser breaks it: there is no shared driving surface for the harness to read.
This is exactly the SETTLE-FIRST fork the task flagged ("does the agent drive its
OWN Playwright, or does the harness hand it a page?"). The "drives its own
Playwright" option was chosen and shipped, and contact with a live run shows it
does NOT survive: the verdict mechanism assumes a shared page the chosen option
removes.

## The milestones-0/4-even-on-PASS smell (secondary)

Both legs show `milestones 0/4`, yet the webhands leg is a PASS. Milestones
(`reached-login`, `reached-cart`, `reached-checkout`) are intermediate page
states; they are only scored AFTER the agent finishes, against the FINAL page,
where those intermediate pages are no longer current, so they read as unreached
even on a successful run. The end-state check is what actually decides PASS/FAIL.
So the milestone column is currently near-useless as a comparison axis (it is ~0
regardless of outcome); the comparison effectively reduces to PASS/FAIL + tokens.
Worth either scoring milestones progressively during the run or dropping them
from the comparison line. (Separate from the false-FAIL above.)

## So: does webhands deliver? (what THIS run can and cannot say)

It CANNOT yet answer the token question, because the two legs are not measuring
the same thing: the webhands leg's tokens are a real verbs-driven run; the
Playwright-only leg's tokens are real too, but its OUTCOME is mis-scored, so a
"webhands passed, baseline failed" headline is an artifact of the harness, not a
capability gap. On this task BOTH agents in fact reached the goal (the webhands
leg PASSed; the Playwright leg PASSed in its own browser but was scored FAIL).
Raw token totals (webhands ~15.8M total vs playwright ~3.0M, dominated by
cacheRead) are also not yet a clean signal: the webhands agent makes many small
`npx webhands` shell round-trips (each re-priming context => huge cacheRead),
while the Playwright agent wrote ONE script and ran it (far fewer model
round-trips). That is itself an interesting axis ("chatty verb calls vs
write-a-script-once"), but it is not the apples-to-apples token compare the prd
north star wants until the verdict is fair.

## Fix direction (for a follow-up task, NOT done here)

Give the harness a shared driving surface it can read REGARDLESS of the agent's
toolkit. Options to weigh:
 - Have the Playwright-only agent drive the SAME browser the harness serves
   (e.g. webhands `serve` exposes a CDP endpoint; the agent connects its
   Playwright to that endpoint via `chromium.connectOverCDP` instead of launching
   its own). The agent still writes raw Playwright (no webhands verbs), but acts
   on the page the harness reads. This keeps "Playwright-only agent" honest while
   restoring a shared surface. (webhands already has an `attach`/CDP transport in
   `tasks/done/attach-transport-cdp-chromium.md`, so the serve side may be close.)
 - OR let the harness assert against the agent's OWN browser (the agent reports a
   CDP endpoint the harness attaches to read-only). Heavier agent contract.
 - OR accept that the baseline's verdict must come from the agent leaving its
   browser open on a known endpoint the harness can attach to. (This is the
   "leave the session open" rule, but it only helps if the harness can REACH that
   session.)

Recorded from the first live `--compare`; the comparison harness MACHINERY works
(both legs ran, tokens captured, side-by-side printed), but the baseline leg's
VERDICT is not yet trustworthy. Filed as a finding so the next eval task can pick
the shared-surface fix.
