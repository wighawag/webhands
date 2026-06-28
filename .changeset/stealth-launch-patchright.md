---
'@webhands/core': minor
'webhands': patch
---

Add an opt-in, Patchright-backed stealth launch to `PlaywrightLaunchTransport`.

Standard Playwright drives Chromium over CDP and calls `Runtime.enable` at
startup, which emits a `Runtime.consoleAPICalled` side-effect that some anti-bot
WAFs (Imperva/Cloudflare/DataDome) detect to serve an "Access Denied" block page
before the page even renders. [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright),
an API-compatible Playwright fork, patches exactly these CDP leaks.

- New third constructor argument `PlaywrightLaunchTransportOptions`:
  `{stealth?, systemBrowser?}`. Stealth is a transport-construction policy and
  stays OFF by default; vanilla Playwright remains the default. `systemBrowser`
  (e.g. `'chrome'`) drives a browser already installed on the system instead of
  the bundled Chromium (it maps to Playwright's `channel` internally; the public
  name stays domain-level per ADR-0003). The transport seam (`OpenTarget`) is
  unchanged and still carries no Playwright/CDP types.
- `patchright` is an OPTIONAL dependency imported LAZILY (`await import(...)`)
  only when `stealth: true`, so users who never opt in are not forced to install
  it and the module load never fails when it is absent.
- When stealth is enabled but `patchright` is not installed, `open` throws the
  new typed `MissingStealthDependencyError` (with the `pnpm add patchright` fix
  in its message). It NEVER silently falls back to vanilla, which would
  re-introduce the exact tell without telling anyone.
- With `systemBrowser: 'chrome'`, a missing-binary failure is reported as a
  missing SYSTEM Chrome via `MissingBrowserBinaryError`.

The `webhands` CLI exposes the opt-in via `--stealth` and
`--use-system-browser <name>` flags on `serve` and `launch` (both default off /
bundled Chromium). `serve` is where they take effect (it is the one place a
browser is launched, ADR-0005); the two flags are independent. The CLI also maps
the new `missing-stealth-dependency` condition to the exact `pnpm add patchright`
fix command, alongside the existing typed-error mappings.

Honest caveat: this addresses ONLY the CDP automation tell. IP reputation and
session/profile reputation still matter; the realistic recipe is stealth +
`systemBrowser: 'chrome'` + headed + a warmed, logged-in profile + a residential
IP (ADR-0002). Stealth alone is necessary-but-not-sufficient.
