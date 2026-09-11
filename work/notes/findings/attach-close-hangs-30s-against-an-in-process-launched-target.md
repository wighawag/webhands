---
title: 'Playwright CDP browser.close() intermittently blocks 30s (and always did against an in-process launched target)'
slug: attach-close-hangs-30s-against-an-in-process-launched-target
type: finding
status: verified
created: 2026-09-11
source: 'Measured locally against playwright 1.61.1 + Chromium 1228 while fixing the pre-existing failure in `packages/core/test/playwright-attach-transport.test.ts` (observation `attach-transport-test-detach-case-times-out-on-main`).'
---

## What is true

`browser.close()` on a `chromium.connectOverCDP` connection does NOT reliably
return promptly. Two distinct measurements:

1. **Always ~30s when the attached target was launched by Playwright IN THE SAME
   NODE PROCESS** (`launchPersistentContext` + `connectOverCDP` to its own
   debugging port): 30298ms, and 30201/30208/30198ms across variants (no page
   touched, pages read, after a `goto`). Against a SEPARATE-process Chromium the
   same close took 20ms.

2. **Intermittently ~30s even against a separate process**: with two CDP clients
   attached, a client's close took 30008ms and 30229ms in roughly two of five
   cases, while the rest finished in 2 to 10ms. Exactly 30s each time, i.e. an
   internal timeout being waited out rather than work being done.

## Why it mattered

(1) fully explains the pre-existing RED test on `main`: the attach suite modelled
"the user's running browser" with an in-process `launchPersistentContext`, so every
case paid ~30s and the "detaches WITHOUT killing" case, which closes twice, blew its
60s budget. That file went from 184s-with-a-failure to 8.5s-all-green once the
"user's browser" became a separate process (which is also what a user's browser
actually IS).

(2) is a PRODUCTION defect, not a test artifact: `session.close()` on an attach
session calls `browser.close()`, so `webhands stop` could block 30s for nothing.

## Consequence

- The attach transport's detach is now BOUNDED (2s) and then declared closed. The
  CDP connection carries no state we own (the browser keeps running and owns its own
  profile, ADR-0002), so waiting longer buys nothing; the disconnect continues in
  the background.
- `connectOverCDP` now gets a 10s connect timeout instead of Playwright's 30s
  default: the browser is already running, so a connection that has not landed in
  seconds is a WRONG endpoint, and 30s of silence teaches the user the tool hangs.
- Test helpers that hold their own CDP handle bound their close the same way, with
  the measurement recorded next to the code so it does not read as superstition.
- Not investigated: WHY Playwright waits 30s (likely a graceful-close path waiting
  for a browser process it does not own to exit). If a future Playwright fixes it,
  the bounds become harmless.
