---
title: Extension transport (no CDP, trusted OS-level input)
slug: extension-transport
---

> Launch snapshot: records intent at creation and is NOT maintained. Current truth is `docs/adr/0018` plus the code. The thin vertical slice described under "Slice" was built together with this spec; everything else here is designed, not built.

## Problem Statement

Every way webhands drives a page goes through the Chrome DevTools Protocol, and Chrome sets `navigator.webdriver = true` whenever a debugging port or pipe is enabled. Cloudflare Turnstile refuses on that bit (finding `cloudflare-turnstile-refuses-any-browser-with-a-debugging-port`). It refused every CDP-based mode on Luma, including `serve --real-chrome` on a profile a human had already logged into, at the moment of an ACTION (the event "Register" button). The same Chrome with no debugging port, under Xvfb and clicked with xdotool, passed with one click. Today the only answer for such a site is "a human does that step", which defeats the point of an agent.

## Solution

A new transport, `serve --transport extension`, that never enables CDP. The browser is started as a plain process (exactly as `setup-profile` starts it) with a small MV3 extension loaded. The extension runs Playwright's own selector engine in its content scripts and talks to the long-lived `serve` over an authenticated loopback WebSocket. Pointer and keyboard actions are performed as trusted OS-level input from the controller, on a display the transport owns (Xvfb). The verb surface is unchanged. Verbs that cannot be honoured yet fail loudly with `unsupported-by-transport`. The Playwright transport stays the default. The design decisions and rejected alternatives are in ADR-0018; this spec carries the user-facing shape and the plan.

## User Stories

1. As an agent driving a Turnstile-protected site, I want a session in which `navigator.webdriver` is false and no `--remote-debugging-*` flag exists anywhere in the browser's process tree, so that a check reading those signals sees an ordinary user's browser.
2. As an agent, I want `click` to produce a TRUSTED click (OS-level input) that reaches cross-origin iframes such as Turnstile's widget, so that an action-level challenge passes the way it does for a human.
3. As an agent, I want the same locator strings I use with the Playwright transport (`page.getByRole('button', { name: 'Register' })`, `frameLocator(...)` chains, `.filter(...)`, `.nth(...)`) to work unchanged, so that switching transport does not mean learning a new addressing dialect.
4. As an agent, I want `snapshot` to return the same accessibility YAML with `[ref=eN]` refs, and `click --by-ref eN` to act on them, so that read-then-act works the same way.
5. As an agent, I want `type` to type real keystrokes into the focused field, so that masked inputs and keydown-driven widgets behave as for a human.
6. As an agent, I want `goto`, `wait` (timeout/locator/navigation), `cookies export/import/clear`, `query` and its shorthands, `press`, `mouse` and a viewport `screenshot` to work, so that a whole flow can be driven on this transport.
7. As an agent, I want a verb this transport does not support to fail with a typed `unsupported-by-transport` error that names the verb and the alternative, so that I never mistake a silent no-op for success.
8. As an operator, I want `serve --transport extension` to start its own invisible X display by default, so that OS input never moves my real pointer and the session works on a headless box.
9. As an operator on a desktop, I want `--headed` to use my display, with a warning that the pointer will move, so that I can watch or take over.
10. As an operator, I want the default browser to be Playwright's pinned Chrome for Testing build (which honours `--load-extension`), so that the mode works with no manual install step.
11. As an operator using my own branded Google Chrome (`--real-chrome`), I want a clear one-time instruction to "Load unpacked" the webhands extension directory into the profile, and a typed `extension-not-connected` error naming that step when it is missing, so that I am not left guessing why nothing connects.
12. As an operator, I want `setup-profile --transport extension` to write the extension directory and print its path and the steps, so that the human login and the one-time install happen in the same plain browser session.
13. As a security-conscious user, I want the bridge to listen on loopback only, require a per-session token, pin the extension's origin, and keep its config file private (0600), so that no web page or other local account can drive my logged-in browser.
14. As a security-conscious user, I want the extension to request only `cookies`, `alarms` and `<all_urls>` host access, with no `web_accessible_resources`, so that its surface is minimal and pages cannot probe for it.
15. As an operator, I want `--expose-cdp` combined with this transport to be refused, so that I cannot accidentally reintroduce the signal this mode removes.
16. As an operator, I want `stop` to close the browser and the Xvfb it started, leaving no stray processes behind.
17. As a maintainer, I want the extension's service worker to be a stateless executor that reconnects after it is killed, with in-flight commands rejecting rather than replaying, so that ADR-0001's "the controller owns the loop" stays true.
18. As a maintainer, I want the locator compiler unit-tested against the selectors Playwright itself produces, so that parity is a test, not a claim.
19. As a maintainer, I want an eval-harness case (register for a free Luma event behind Turnstile) runnable on demand, so that the anti-bot claim is re-measurable and not folklore.
20. As a skill reader (agent), I want the use-webhands skill to say when to choose this transport, what it cannot do, and how to set it up, so that I pick it for action-level anti-bot checks and not by default.

## Implementation Decisions

The durable rationale is ADR-0018. These are the remaining specifics.

- **Modules (core):** a locator compiler (locator expression to Playwright selector, no browser); an injected-source extractor (reads Playwright's `InjectedScript` source from the pinned `playwright-core` bundle and fails loudly when the pin moves and the marker is missing); an extension writer (manifest with the pinned public `key`, worker, content script, injected script, `config.json`); a minimal RFC 6455 WebSocket server (text frames, ping, close; no new dependency); the bridge (auth, request/response by id, reconnect wait, keepalive); a display helper (Xvfb via `-displayfd`); an `InputBackend` with an X11 `xdotool` implementation; the transport plus its `WebHandsPage`.
- **CLI:** `serve --transport <playwright|extension>` (default `playwright`). It composes with `--profile`, `--headed` and `--real-chrome`, warns that the Playwright launch-hardening flags (`--stealth`, `--use-system-browser`, `--viewport`) and `--proxy` do not apply, and refuses `--expose-cdp`. `setup-profile --transport extension` writes the extension directory and reports the path and the one-time steps. New error codes: `unsupported-by-transport`, `extension-not-connected`, `os-input-unavailable`.
- **Executables:** Xvfb and xdotool are found on `PATH` or through `WEBHANDS_XVFB` / `WEBHANDS_XDOTOOL`. NixOS: `xvfb` and `xdotool` from nixpkgs (for example in `environment.systemPackages`). Debian/Ubuntu: `apt install xvfb xdotool`. macOS and Windows: the transport refuses at open with `os-input-unavailable` (the input backend is required up front, so a session never starts without trusted input) until a CGEvent / SendInput backend exists.
- **Geometry:** the viewport origin comes from `screenX/Y` and outer minus inner size, and is then verified and corrected from a trusted `mousemove` (see ADR-0018). The device scale is `devicePixelRatio`. Page zoom is unsupported (it would make that product wrong), so the browser is never zoomed by us.
- **Readiness:** `goto` is `chrome.tabs.update` plus a wait for the tab's `status: 'complete'`, plus a `ready` ping from the top frame's content script. `wait navigation` waits for the next `complete`. `wait locator` polls the content script for attached and visible (Playwright's default `waitFor` state).
- **Cookies:** `chrome.cookies.getAll({})` maps to the seam `Cookie`. `setCookies` uses `chrome.cookies.set` with a URL built from domain, path and secure. `clearCookies` keeps the seam's empty-filter refusal (`validateCookieFilter`).
- **Screenshot:** `chrome.tabs.captureVisibleTab`, PNG, viewport scope only, written under the managed screenshots dir by the existing path rules. At `devicePixelRatio` 1 (our Xvfb runs at `-dpi 96`) its pixels map 1:1 to `mouse` coordinates.

## Testing Decisions

- The locator compiler is tested in isolation against Playwright's own selector output for the same expressions (taken from Playwright's `Locator` in a real page, so the oracle is Playwright).
- The transport is tested end-to-end against the local fixture server, under the suite's display wrapper, with Playwright's pinned Chrome for Testing: navigation, snapshot refs, a trusted click (the fixture records `event.isTrusted`), a click inside a CROSS-ORIGIN iframe, typing, cookies, and `navigator.webdriver === false`. The test also asserts that no process in the browser's tree carries `--remote-debugging-*`. It is skipped with a stated reason when Xvfb or xdotool is not installed (as the stealth tests skip without Patchright).
- The live acceptance check (Luma plus Turnstile) is an eval-harness case plus a documented manual run. It is NEVER in the gate (ADR-0011).

## Slice (built with this spec)

`serve --transport extension` with goto, wait, snapshot, click, type, cookies, plus press, mouse, query shorthands and a viewport screenshot (cheap once the engine and input existed); `setup-profile --transport extension`; the eval case; the skill section; this spec and ADR-0018.

## Out of Scope

- Wayland, macOS and Windows input backends (designed behind `InputBackend`, not built).
- `eval` on this transport. The main-world options both have a catch: `chrome.scripting.executeScript` with an indirect eval is subject to the page's CSP, and `chrome.userScripts.execute` needs the user to flip "Allow User Scripts". Deferred until a use case picks one.
- `hover`, `drag`, `select`, `scroll`, element and full-page screenshots, and `query --with-refs`. They are straightforward follow-ups on the same engine and input.
- Inlining child frames into `snapshot`.
- A reduced hand context.
- Firefox (WebExtensions would mostly carry over; `runtime.getFrameId` exists there; not attempted).
- Automating the branded-Chrome extension install (policy or otherwise).

## Further Notes

- The measurement this rests on is one site (Luma), one vendor (Cloudflare), one host (telemaque), October 2026. The eval case exists so it can be re-measured, not assumed.
- Branded-Chrome install findings (`--load-extension` ignored, CDP `Extensions.loadUnpacked` not persisted, `External Extensions` not honoured, a UI "Load unpacked" persisted) are recorded in `work/notes/findings/branded-chrome-extension-install-paths.md`.
