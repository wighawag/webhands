---
title: A driver with no CDP at all (a browser extension bridged to webhands), so navigator.webdriver stays false
slug: cdp-free-driver-via-browser-extension
type: idea
status: incubating
created: 2026-10-25
---

## The opportunity

Every way webhands drives a page today goes through the Chrome DevTools Protocol: a Playwright launch (`--remote-debugging-pipe`), `--expose-cdp`, `serve --real-chrome` and `serve --endpoint` (`--remote-debugging-port`). Chrome sets `navigator.webdriver = true` whenever either is enabled, and Cloudflare Turnstile refuses on that bit (finding `cloudflare-turnstile-refuses-any-browser-with-a-debugging-port`). `setup-profile` now gets the human LOGIN past it by starting a portless browser, but a site that re-challenges on an ACTION (Luma's event Register button) still blocks automation, and today the only answer is "a human does that step".

A driver that never enables CDP would leave `webdriver` false for the whole session. The natural shape: a browser extension installed into the dedicated profile, which performs the verbs (navigate, query, click, type, eval, snapshot) through extension APIs and content scripts, and talks to webhands over a native-messaging host or a localhost bridge (WebSocket or HTTP on loopback, or the existing unix socket). The browser would then be started exactly as `setup-profile` starts it now, with the extension loaded.

## Why it fits

- ADR-0003 already anticipates this: the seam is deliberately not CDP-coupled, and a "stronger-stealth extension transport" is named there as the future path. It would be one more `Transport`, with the verb surface unchanged.
- It stays inside ADR-0002: still the user's own browser, profile and IP, no fingerprint spoofing, no captcha solving. It removes a flag that is only there because of how we attach.

## Open questions (not answered, do not assume)

- How much of the verb surface survives without CDP. Playwright locator semantics (ADR-0004) are a CDP-side engine; content scripts would need their own locator implementation or a subset. Trusted input is another gap: content-script events are `isTrusted === false`, and `chrome.debugger` would bring CDP (and the flag) back, so real clicks may need OS-level input (xdotool-style), which is what passed Turnstile in the measured run.
- Whether `--load-extension` (or an unpacked extension in the profile) is itself a signal to these vendors, and whether current Chrome still honours `--load-extension` on branded builds.
- Native messaging needs a host manifest installed per browser and per OS; a loopback bridge avoids that but is a local network surface to secure like `serve` (code execution on the logged-in page).
- Cross-origin frames (Tier 4) and screenshots via `chrome.tabs.captureVisibleTab` behave differently from the CDP paths.

## Not now

Captured as a direction only. Do not implement without a spec: it is a new transport with a large surface, and the measurement it rests on is one site on one day.
