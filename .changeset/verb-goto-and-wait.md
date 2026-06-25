---
'@webhands/core': minor
---

Implement and fully test the `goto` (navigate) and `wait` verbs at the `core` Driver seam.

`goto` navigates the active page and settles on the `load` event before returning, so a subsequent read sees the rendered page; it deliberately does NOT wait for `networkidle` (Playwright-discouraged and hangs on long-poll/streaming/beacon pages), leaving XHR/JS-rendered content to the explicit `wait` verb. `wait` supports its three forms transport-neutrally: `timeout` (`waitForTimeout`), `locator` (block until the addressed element appears), and `navigation` (block until the next navigation settles). The selector/timeout/navigation behaviour is shared by both Playwright transports (launch + attach) through one `waitFor` helper so they cannot diverge. New deterministic fixture pages (`delayed.html`, which script-renders content ~150ms after `load`, and `redirecting.html`, which JS-redirects ~150ms after `load`) drive the three wait forms; tests run a real local Chromium against the local fixture pages and assert each verb's effect (goto settles to `readyState === 'complete'`; wait-for-selector blocks until the late element renders; wait-for-navigation lands on the redirect target; wait-for-timeout elapses) at the `core` Driver seam, never on third-party DOM (ADR-0003 / PRD "Testing Decisions").
