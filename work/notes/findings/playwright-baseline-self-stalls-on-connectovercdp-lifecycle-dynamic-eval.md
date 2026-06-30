# The Playwright baseline reliably self-stalls on the dynamic read-decide-loop eval (a `connectOverCDP` lifecycle tax the served webhands page does not pay)

2026-06-30, measuring the clean script-only-vs-Playwright TOKEN tie on
`cart-threshold-checkout` (the dynamic, non-one-shot-scriptable eval). Trying to
get a run where BOTH legs complete the loop so the only variable is "same
automation against the same shared browser, who is leaner".

## What happened

Over a fresh scratch clone of `origin/main` (`56b892e`, the `webhands-script-only`
kind landed), same agent + model + `--parse-usage` as every scoreboard run
(`pi --print --mode json --tools bash,read,write --model etherplay/claude-opus-4-8`),
`--webhands` pointed at the built `packages/cli/dist/bin.js`:

| Leg | r1 | r2 | r3 | r4 |
| --- | --- | --- | --- | --- |
| `webhands-script-only` | PASS 4/4 1.56M | PASS 4/4 2.31M | - | - |
| `playwright` | FAIL 1/4 0.23M | FAIL 1/4 0.23M | FAIL 1/4 0.19M | FAIL 1/4 (earlier #28 run too) |

The `webhands-script-only` leg PASSed every time (4/4, ~1.6-2.3M). The
`playwright` leg FAILed every time, ALWAYS at 1/4 (reached-store), ALWAYS ~0.19-0.23M
tokens. That is not single-run variance; it is a consistent, reproducible stall.

## The mechanism (root cause)

Every Playwright FAIL is the SAME shape. The Playwright-only agent (it must drive
the harness's served browser over CDP, `WEBHANDS_CDP_ENDPOINT`) writes an
exploration script `explore.js` like:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP(process.env.WEBHANDS_CDP_ENDPOINT);
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  await page.goto('http://127.0.0.1:<fixture>/', { waitUntil: 'networkidle' });
  const text = await page.evaluate(() => document.body.innerText);
  console.log(text);
  await browser.close && null;   // <-- a NO-OP: references the method, never CALLS it
})();
```

then runs `node explore.js`, and that `node` process **hangs to the wall-clock
cap**, killing the run at 1/4. Two compounding bugs in the agent-written script:

1. **The CDP connection is never closed.** `browser.close && null` is a typo-shaped
   no-op (it evaluates the method reference and discards it; it does NOT call
   `browser.close()`). A live `connectOverCDP` connection keeps the Node event
   loop alive, so even after the script's logic finishes, `node` never exits.
2. **`waitUntil: 'networkidle'`** on the local fixture may never settle (or settle
   slowly), compounding the hang.

So the model turn that ran `node explore.js` never returns, the run burns its
wall-clock and reports FAIL. The agent never got past its FIRST exploration script
to actually drive the cart loop.

## Why this matters (the real asymmetry, and the fairness problem)

It cuts two ways and BOTH are worth recording honestly:

- **Against over-claiming for webhands:** the Playwright FAIL is PARTLY a
  harness/agent ARTIFACT, not pure incapability. A correctly-written Playwright
  script (disconnect at the end, avoid `networkidle`) would complete. So
  "Playwright FAILs 4/4 on the dynamic eval" OVERSTATES webhands' capability win
  on this eval; the scoreboard rows that show Playwright FAILing here are
  confounded by this self-inflicted `connectOverCDP`-lifecycle bug. The clean
  TOKEN tie (both legs finish the loop, who is leaner) is therefore currently
  UNMEASURABLE: the Playwright leg does not finish.

- **A genuine structural webhands advantage:** the `webhands-script-only` agent
  gets a SERVED, warm, already-connected page (one `serve`, then every `script`
  drives it). It NEVER writes `connectOverCDP` boilerplate, never manages browser
  lifecycle, never hangs on it. The raw-Playwright agent must hand-roll the
  connection in EVERY script, and that boilerplate is exactly where it keeps
  tripping. On a multi-script read-decide-loop the connection-lifecycle tax is a
  REAL, recurring cost webhands amortizes away. webhands' served page removes a
  failure mode the raw-Playwright agent keeps hitting.

## What to fix (so the baseline can lose FAIRLY)

The baseline is currently losing on a self-inflicted boilerplate bug, which
FLATTERS webhands. To get an honest tie-or-beat number, make the Playwright leg
fair:

1. **Steer the Playwright-leg preamble** away from the hanging pattern: tell the
   agent the served browser is already at `WEBHANDS_CDP_ENDPOINT`, to ALWAYS
   `await browser.close()` (or `browser.disconnect()`) at the end of every script
   so `node` exits, and to avoid `waitUntil: 'networkidle'` on app pages (prefer
   `domcontentloaded` + an explicit locator wait). This is PROTOCOL (how to drive
   the shared browser), not goal priming, so it stays no-priming-clean.
2. **Reap a hung `node` child** in the harness: a per-script/per-turn watchdog that
   kills a `node` child that outlives a bound, so one mismanaged connection cannot
   eat the whole wall-clock and mask the real outcome.

Then RE-RUN the script-only-vs-Playwright tie for a run where BOTH complete, and
record the real leaner-number on the scoreboard.

(Related papercut already filed:
`work/notes/observations/evals-npx-webhands-not-on-path-in-fresh-worktree.md`,
the `npx webhands` PATH issue, and
`work/notes/observations/playwright-eval-leg-leaves-scratch-scripts-in-cwd.md`,
the leftover `explore.js`. This finding is the deeper one: the leftover script is
the same `explore.js` that hangs.)
