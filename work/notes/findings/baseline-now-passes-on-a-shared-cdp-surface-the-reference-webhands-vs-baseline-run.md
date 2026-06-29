# The Playwright-only baseline now PASSes on a shared CDP-driven surface: the reference webhands-vs-baseline run (2026-06-29)

source: a live `run-eval --compare` against https://www.saucedemo.com/ (HTTP 200, NOT down), same agent + model on both legs (`pi --print --mode json --tools bash,read,write`, `etherplay/claude-opus-4-8`, `--parse-usage`), after the `eval-baseline-shared-driving-surface-over-cdp` fix.

## What changed

The false-FAIL the first `--compare` exposed (finding
`baseline-comparison-needs-a-shared-driving-surface-not-two-browsers`: the agent
drove its OWN browser while the harness read a DIFFERENT one) is FIXED by a
SHARED driving surface. The harness's `serve` session now exposes a Chromium CDP
/ remote-debugging endpoint, and the Playwright-only agent
`chromium.connectOverCDP(process.env.WEBHANDS_CDP_ENDPOINT)`-s to it and drives
the harness's EXISTING page (raw Playwright only, no webhands verbs). The harness
reads that same page for its verdict, unchanged. The agent's own script (verified
from the run) used exactly `connectOverCDP`, `browser.contexts()[0]`,
`context.pages()[0]`, and disconnected (not closed) at the end.

## The reference run

```
comparison: saucedemo-core-flow (same goal + assertion, two toolkits)
  shell       PASS   milestones 0/4   tokens: in 576 / out 11.2k / cacheRead 5224.2k / cacheWrite 406.1k / total 5642.0k
  playwright  PASS   milestones 0/4   tokens: in 384 / out  9.6k / cacheRead 1476.7k / cacheWrite 121.0k / total 1607.7k
```

Both legs now score PASS on a genuine completion: the comparison is finally
apples-to-apples on OUTCOME (both PASS) and TOKENS. This is the durable
webhands-vs-baseline REFERENCE: a later verb-surface change is measured against
THESE numbers.

## What the tokens say (read with care)

On this task both toolkits completed the goal, so the headline is OUTCOME-parity,
not "webhands wins/loses". The token totals are dominated by `cacheRead` and
reflect the two interaction SHAPES, not a clean capability gap:
 - webhands (`shell`): ~5.64M total. Many small `webhands <verb>` shell
   round-trips, each re-priming context => large `cacheRead`.
 - Playwright-only: ~1.61M total. The agent wrote ONE script (`purchase.cjs`,
   connectOverCDP + drive) and ran it => far fewer model round-trips.

So on saucedemo-core-flow the chatty-verbs vs write-a-script-once shape makes the
Playwright-only leg cheaper in raw tokens here, while BOTH reach the goal. That is
itself the interesting axis the prd north star wanted measurable; it is now a fair
comparison because the verdict is trustworthy (both PASS the SAME assertion on the
SAME page). Single-task, single-run: treat as the reference point, not a verdict on
webhands across tasks.

## How to reproduce the reference run

The harness invokes `webhands` and the agent's `npx webhands` calls need it on
PATH; the Playwright-only leg needs `playwright` resolvable. The run used a
`webhands` shim pointing at the built `packages/cli/dist/bin.js` (on PATH, passed
as `--webhands webhands`) and `NODE_PATH=<store>/playwright@<v>/node_modules` for
the Playwright leg so its script can `require('playwright')`. Command shape:

```
PATH="<shim-dir>:$PATH" pnpm --filter @webhands/evals run-eval \
  --eval saucedemo-core-flow --compare --webhands webhands \
  --agent-cmd "pi --print --mode json --tools bash,read,write" \
  --playwright-cmd "NODE_PATH=<store>/playwright/node_modules pi --print --mode json --tools bash,read,write" \
  --parse-usage
```

## Carried-over secondary smell (unchanged, still open)

`milestones 0/4` on both legs persists (intermediate-page milestones scored only
against the FINAL page; see the prior finding). It was left out of scope for the
shared-surface fix and remains a separate cleanup: the comparison line's
meaningful axes are OUTCOME + TOKENS, and the milestone column stays near-useless
until milestones are scored progressively or dropped.
