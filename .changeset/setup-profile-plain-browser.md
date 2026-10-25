---
'webhands': minor
'@webhands/core': minor
---

**`setup-profile` opens a PLAIN browser, not one under automation, so the human login passes Cloudflare Turnstile and Google sign-in.**

It used to open its window through Playwright's `launchPersistentContext`, which adds Playwright's automation args and a remote-debugging pipe, so the page saw `navigator.webdriver === true`. Measured on 25 Oct 2026: Luma's sign-in looped on Turnstile's "Verifying your browser" and Google said "This browser or app may not be secure", so the human could not log in at all, in the one step whose only job is letting them log in. The same Chrome binary started with no debugging port passed Turnstile with one click.

- `setup-profile` now spawns the browser as an ordinary child process with only `--user-data-dir`, `--no-first-run`, `--no-default-browser-check` and the start URL (plus `--proxy-server` when `--proxy` is given, and the operator's `WEBHANDS_CHROME_ARGS`). No `--remote-debugging-port`/`--remote-debugging-pipe`, no `--enable-automation`, none of Playwright's defaults. It waits for the process to exit (the human quit the browser), then reports the profile saved. A crashing browser is an error, not a "saved".
- New `--url <url>` opens the window on the sign-in page (default `about:blank`).
- It starts the same build that will later drive the profile: the pinned Playwright Chromium by default (launched directly from its executable path), the system Chrome with the new `--real-chrome` or `--use-system-browser chrome` (resolved like `serve --real-chrome`: `WEBHANDS_CHROME`, then the PATH names), Patchright's Chromium with `--stealth`. Another `--use-system-browser` value needs `WEBHANDS_CHROME` pointing at it.
- `missing-display` and `missing-browser-binary` are unchanged. `--proxy` now refuses credentials (Chrome supports no SOCKS5 auth), as on `serve --real-chrome`. `--no-viewport`/`--viewport` are gone from `setup-profile`, since a plain window has no emulated viewport.
- Library API: `setupProfile()` returns `{browser, location}`, where `browser.waitForExit()` resolves when the human quits; it no longer returns a Playwright-backed `Session`.

The recommended flow for a protected site is now `setup-profile --real-chrome` (human logs in, quits), then `serve --real-chrome` on the same profile. Its limit is documented: a site that re-challenges on an action still sees `navigator.webdriver` under `serve`, and a human has to do that step.
