---
'@webhands/core': minor
'webhands': minor
---

Harden the Playwright LAUNCH transport with opt-in, safely-defaulted
anti-detection launch options Patchright recommends. The seam is unchanged:
`OpenTarget` stays Playwright/CDP/Patchright-free (ADR-0003) and all of these
knobs live ONLY on the transport-construction policy.

- `noViewport?: boolean` on `PlaywrightLaunchTransportOptions`: maps to
  Playwright's `viewport: null` so the real browser window drives its own size
  instead of Playwright's fixed 1280x720 emulated viewport (a known
  headless/automation tell). When unset it preserves current behaviour, EXCEPT
  that it now defaults to `true` when `stealth` is enabled (Patchright's
  recommended recipe); pass an explicit `false` to keep the fixed viewport even
  under stealth. The stealth-on default is documented and overridable: shipping
  the stealth engine while leaving the tell it is meant to hide in place would be
  self-defeating.
- `extraLaunchArgs?: readonly string[]`: an escape hatch that forwards extra
  hardening flags (e.g. `--disable-blink-features=AutomationControlled`) to the
  launch `args` as a plain `string[]`, with no Playwright type crossing the seam.
- `ignoreDefaultArgs?: boolean | readonly string[]`: passthrough so a caller can
  drop more automation-flavoured Playwright default args than the built-in
  stealth subset. When provided it REPLACES the built-in `['--enable-automation']`
  choice (the caller then owns the full list); unset, the stealth path keeps
  dropping `--enable-automation` as before.

The transport still does NOT set or override `user_agent`, `locale`, `timezone`,
or `headers` by default: Patchright warns a wrong UA is a bigger tell than none.

CLI: `webhands launch`/`serve` gain `--no-viewport` (boolean), threaded through
the existing `LaunchPolicy`/`stealthOptions` pattern into the launch transport.

Honest caveat: these reduce but do NOT eliminate bot detection. A real profile,
residential IP, and session reputation still matter (ADR-0002); this is one more
layer, not a guarantee.
