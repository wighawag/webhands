---
title: Extension transport, thin vertical slice (serve --transport extension)
slug: extension-transport-thin-slice
spec: extension-transport
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
---

## What was built

The first slice of ADR-0018, behind `serve --transport extension` (Playwright stays the default):

- `core`: the locator compiler (expression to Playwright selector, parity-tested against Playwright), the injected-source extractor (Playwright's `InjectedScript` read from the pinned `playwright-core`), the extension files (manifest with a pinned public key, content-hashed scripts, private `config.json`), the bridge (loopback WebSocket server, origin pin plus per-session token, keep-alive, an inert start page that wakes the worker), the OS input backend (xdotool on X11, a private Xvfb with `-dpi 96 -terminate`), and `ExtensionTransport` with its `WebHandsPage` (goto, wait, snapshot, click, type, press, mouse, cookies get/set/clear, query and its shorthands, viewport screenshot; everything else `unsupported-by-transport`). New error codes: `unsupported-by-transport`, `extension-not-connected`, `os-input-unavailable`.
- `cli`: `serve --transport playwright|extension` (refuses `--expose-cdp` and `--endpoint` with it, warns on moot launch flags and on `--headed`), `setup-profile --transport extension` (writes the extension directory and prints the one-time Load unpacked steps for branded Chrome), fix commands for the new codes. `serve` now ignores a repeated signal during teardown instead of dying mid-teardown.
- `evals`: the `luma-register-turnstile` anti-bot case (env-configured, seeded from a copy of a logged-in profile, INCONCLUSIVE when the account is already registered), `EvalEntry.serve` / `seedProfileDir`, and no `--expose-cdp` default on the extension transport.
- Docs: ADR-0018 (with notes on 0001, 0003, 0010), the spec, the finding `branded-chrome-extension-install-paths`, CONTEXT.md, README, and the use-webhands skill.

## Acceptance (evidence)

- `packages/core/test/extension-transport.test.ts` (Chrome for Testing 151, Xvfb, xdotool) passes repeatedly: the page reads `navigator.webdriver === false`, no process in the browser tree has a `--remote-debugging-*` or `--enable-automation` flag, clicks and keystrokes are `isTrusted`, a click lands inside a cross-origin iframe, refs from `snapshot` act via `--by-ref`, cookies round-trip, and no process remains after close. It skips with a stated reason when Xvfb or xdotool is missing.
- `packages/core/test/locator-compiler.test.ts`: 30 expressions compile to exactly the selector a real Playwright `Locator` builds.
- Live, telemaque, 25 Oct 2026, Google Chrome 156 on a copy (`luma-ext`) of the human-logged-in `luma` profile, extension loaded unpacked once: `serve --transport extension --real-chrome --profile luma-ext`, then `goto https://luma.com/qzlsn6lt` (Privacy Hub, Devcon 8; free, no approval), `click` Register, `click` the dialog's Register. Turnstile showed its checkbox; `screenshot` then `mouse --x 816 --y 358` passed it with one trusted click, and the page showed "You're In". During the run the serve process tree (18 processes: node, Xvfb, Chrome and its children) carried no `--remote-debugging-*`, `--enable-automation` or `--headless` flag, and a page served on loopback read `navigator.webdriver` as `false`.
- The eval harness brought the extension transport up on a seeded copy of that profile and reported INCONCLUSIVE ("already registered") for the same event, as designed.
- That live run was driven by hand, verb by verb, by the implementing agent. The eval case now also asserts the no-automation signals itself (`requireNoAutomationSignals`): no debugging or automation flag on any process under `serve`, before and after the agent, and `navigator.webdriver === false`.
- Agent run, same day, after review: `run-eval --eval luma-register-turnstile --agent-kind webhands-skilled --max-attempts 1` with `pi --print` (model `etherplay/claude-opus-5-5`), on a seeded copy of `luma-ext`, event `https://luma.com/spsnos9t` (Ethereum Cypherpunk Congress #3, free, one-click RSVP). The agent clicked One-Click RSVP, met Turnstile's "Verify you are human" checkbox, took a screenshot, clicked it with `mouse`, and reported "You're In". Harness verdict: `PASS (milestones 2/2: on-event-page, registered) [no-automation OK: 15/18 processes, webdriver=false]`.
