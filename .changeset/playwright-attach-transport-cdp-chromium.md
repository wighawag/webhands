---
'@webhands/core': minor
---

Add the `attach` transport (`PlaywrightAttachTransport`): connect to a browser the user already started with remote debugging, reusing their live authenticated context.

`PlaywrightAttachTransport` implements the `core` `Driver`/`Transport` seam via `chromium.connectOverCDP(endpoint)`, reusing the existing authenticated context (`browser.contexts()[0]`) — never `newContext()` — so the controller drives the user's live, logged-in tabs on their real fingerprint and IP (ADR-0002). It is Chromium-only and surfaces that constraint as a typed `core` error (`AttachNotChromiumError`, code `attach-not-chromium`) without leaking any CDP/Chromium-only type across the seam (ADR-0003); a browser exposing no context to reuse surfaces as `AttachNoContextError`. There is no browser-relaunch helper — the user supplies the running endpoint (settled PRD decision). Closing the attached session detaches without killing the user's browser. Tests start a real local Chromium with a remote-debugging port, attach, and assert the existing context is reused (a cookie seeded before attach is visible through the seam) and that verbs drive the local fixture page.
