---
'@webhands/core': minor
---

Add the v1 Playwright launch transport with a dedicated persistent profile.

`PlaywrightLaunchTransport` implements the `core` `Driver`/`Transport` seam using Playwright `launchPersistentContext` against a dedicated profile dir the controller owns under a config location (`~/.webhands/profiles/<name>`, overridable via the `WEBHANDS_HOME` env var or a constructor `root`). It never targets the OS default Chrome profile (ADR-0002) and leaks no Playwright/CDP types across the seam (ADR-0003). Both headed and headless launch are selectable; profile state (cookies, storage) persists across relaunches. A missing browser binary and a not-yet-set-up profile surface as typed, identifiable `core` errors (`MissingBrowserBinaryError` / `MissingProfileError`, branded via `isControllerError` and a stable `code`) so the CLI can render the exact fix command. Tests drive a real local Chromium against the local fixture page with the profile root isolated to a temp dir.
