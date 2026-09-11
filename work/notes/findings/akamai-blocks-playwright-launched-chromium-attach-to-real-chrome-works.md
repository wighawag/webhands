---
title: 'Akamai blocks every Playwright-LAUNCHED browser (stealth included); attaching to the user’s own Chrome works'
slug: akamai-blocks-playwright-launched-chromium-attach-to-real-chrome-works
type: finding
status: verified
created: 2026-09-11
source: 'The blocking/working comparison is ONE live session against eki-net.com (Akamai Bot Manager, authenticated Japanese rail booking), Sept 2026, driven end to end across nine screens; no artifact was committed, so it is not independently checkable. The navigator.webdriver mechanism check is separate: the AFTER-attach value is pinned in `packages/core/test/real-chrome-transport.test.ts` (bundled Chromium 1228, headless), while the BEFORE-attach reading came from an ad-hoc probe, a hand-spawned Chrome whose boot script wrote navigator.webdriver into document.title and read back `wd=true` through the DevTools HTTP endpoint before any client connected. That probe is not committed.'
---

## Scope of the evidence

One site, one vendor, one date, no committed artifact. That is enough to change which
mode we recommend FIRST, and not enough to claim this mode defeats bot management in
general. The docs are hedged accordingly; if a reproducible artifact ever exists, cite
its path here.

## What is true

1. **Every Playwright-LAUNCHED configuration was blocked identically**: default
   launch, `--stealth` (Patchright genuinely installed and resolved),
   `--stealth --use-system-browser chrome`, and a brand-new profile. Stealth did
   not help at all.

2. **Attaching to a human-started Chrome worked flawlessly**:
   `google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/scratch`, then
   `webhands serve --endpoint http://127.0.0.1:9222`. It drove nine screens
   including login, search, seat selection and reaching a payment page, with no
   blocking.

3. **The symptom is deceptive, which is half the finding.** The static,
   edge-cached top page renders fine, so the session LOOKS healthy, and then every
   DYNAMIC endpoint returns a bare Akamai "Access Denied". Concluding "it works"
   from the top page is the trap.

4. **It is NOT about `navigator.webdriver`.** Chrome sets
   `navigator.webdriver === true` whenever `--remote-debugging-port` is enabled.
   Verified with an ad-hoc probe (see `source:`): a page's own boot script in a
   plainly-spawned Chrome read `wd=true` BEFORE any Playwright client attached. So
   the recipe that WORKS is just as detectable on that signal as the one that is
   blocked. The committed test pins only the after-attach value, which is the half
   that can be asserted hermetically.

## What that implies about the mechanism

The difference cannot be the automation bit. What is left: Playwright's launch
adds automation args (`--enable-automation` unless stealth drops it), a fixed
emulated viewport, a battery of `--disable-*` flags, and opens a COLD profile with
no history, no prefs and no prior reputation. A human-started Chrome has none of
those and all of the latter. Bot managers weigh the whole picture, so the
productive move is to BE a real browser rather than to patch tells one at a time.

## Consequence

- `serve --real-chrome` (ADR-0014) makes the working recipe one command: spawn the
  system Chrome with a debugging port on the dedicated profile dir, then attach.
- The README's "realistic recipe is stealth + system browser + headed" guidance was
  WRONG and is corrected with this evidence.
- The honesty section in the docs says plainly that this is not a cloak, with the
  `navigator.webdriver` measurement as the reason. A test pins `webdriver === true`
  in the new mode so nobody later mistakes it for stealth.
- Operational pairing: this finding travels with
  `anti-bot-verdict-lives-in-named-cookies` (pace the flows, and clear the four
  verdict cookies to recover), because a session that starts unblocked can still be
  blocked later.
