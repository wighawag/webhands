---
title: 'Cloudflare Turnstile (and Google sign-in) refuse any browser with a debugging port; the same Chrome without one passes'
slug: cloudflare-turnstile-refuses-any-browser-with-a-debugging-port
type: finding
status: verified
created: 2026-10-25
source: 'Live sessions on 25 Oct 2026 against luma.com sign-in (Cloudflare Turnstile) and Google account sign-in, on telemaque (NixOS, residential Plusnet IP, Chrome 156 from nixpkgs, X session with no GPU). Four configurations compared by hand on the same machine, IP and Chrome binary; no artifact committed, so the site-side verdicts are not independently checkable. The mechanism half (a debugging port alone makes navigator.webdriver true; a plain spawn leaves it false) IS pinned: `packages/core/test/setup-profile.test.ts` has the real bundled Chromium, started the way setup-profile starts it, report navigator.webdriver === false over plain HTTP, and the same probe with `--remote-debugging-port=0` added reads true (checked by hand at implementation time).'
---

## What was measured

All on the same host, IP and Chrome 156 binary, 25 Oct 2026:

1. **Playwright-launched Chromium (old `setup-profile`, via `launchPersistentContext`)**: Luma's sign-in looped on Turnstile's "Verifying your browser". Google sign-in refused with "This browser or app may not be secure". The human could not log in at all.
2. **`serve --real-chrome`** (system Chrome spawned with `--remote-debugging-port=0`, no Playwright launch args): the page read `navigator.webdriver === true`, and Turnstile blocked again.
3. **The same Chrome binary started directly under `xvfb-run`**, no debugging port, a fresh `--user-data-dir`, clicked with `xdotool`: Turnstile showed its checkbox, one click passed, and Luma moved on to "Enter Code".
4. **A human logged in to Luma and Google in plain Chrome (no port)** on `~/.webhands/profiles/luma`, then closed it. `serve --real-chrome --profile luma` then loaded `luma.com/home` already logged in: the session carries over. But a later action that Turnstile re-checks (Luma's event Register button) was blocked again while attached over CDP.

## What it means

- **The debugging port is the deciding signal here.** Case 3 differs from case 2 only by the port (and the driver of the click), and it holds IP, display, GPU/WebGL and timezone fixed. Chrome sets `navigator.webdriver = true` whenever a remote-debugging port or pipe is enabled, and Turnstile (and Google sign-in) refuse on it.
- **This is a different vendor behaving differently from Akamai.** The Akamai finding (`akamai-blocks-playwright-launched-chromium-attach-to-real-chrome-works.md`) showed attaching to a real Chrome WORKS despite `webdriver === true`: Akamai weighs the whole picture. Turnstile does not let that one bit slide. So "attach to the user's own Chrome" beats Akamai but not Cloudflare Turnstile.
- **Login state transfers across the port boundary; action-level re-checks do not.** Cookies written in a plain browser are honoured once the same profile is attached over CDP, so a one-time login done without a port is usable for automation. A site that re-runs Turnstile on an action sees `webdriver` again and blocks that action.

## Consequences

- `setup-profile` now spawns the browser as a plain child process (no Playwright, no `--remote-debugging-*`, no `--enable-automation`, no Playwright default args), so the human login passes these checks. It starts the same build that will later drive the profile (pinned Chromium, system Chrome for `--real-chrome`).
- The documented flow for a protected site is `setup-profile --real-chrome` (human logs in, quits), then `serve --real-chrome` on the same profile. Its stated limit: action-level re-challenges under `serve` still fail, and a human has to do those steps in a portless browser.
- **ADR-0014 needs an addendum, and has one**: its title claim ("the anti-bot answer") holds for Akamai, not for Turnstile, because of `webdriver`; and its consequence "do not point `--real-chrome` at a profile `setup-profile` created" is superseded by `setup-profile --real-chrome`, which writes the profile with the same Chrome.
- A driver with no CDP at all would be the only way past action-level checks. Built as the extension transport (`docs/adr/0018`); on the same host it registered for a Luma event through the Turnstile re-check that every CDP mode failed (record: `work/tasks/done/extension-transport-thin-slice.md`).
