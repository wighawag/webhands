---
'@webhands/core': patch
'webhands': patch
---

Extension transport hardening after review. The bridge handshake is now a mutual HMAC challenge: the token never crosses the wire, and the extension obeys nothing until the controller proves it holds the token. `serve` leaves an inert `config.json` on teardown, the config is written atomically at 0600, and a malformed frame can no longer crash `serve`. `type` passes text to xdotool on stdin (never in the process list, where `{ENV:...}` secrets would show) with a timeout that grows with the text. `wait` for a locator is now a pure read (strict, attached and visible), like Playwright's `waitFor()`. `WEBHANDS_CHROME_ARGS` may not add a debugging, automation or headless flag to the extension transport's browser. Requests in flight on a replaced connection fail fast. The `luma-register-turnstile` eval now asserts no automation flag anywhere under `serve` and `navigator.webdriver === false`, and a PASS with either signal is reported as FAIL.
