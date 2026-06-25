---
'my-browser-controller': patch
---

Add the v1 honesty-and-proof docs.

A root `README.md` documents the scope/humility note (personal use of your OWN authenticated session on your OWN machine and IP; driving sites like Kayak/Skyscanner is generally against their ToS; no login-bypass or CAPTCHA-solving; no fingerprint-spoofing, per ADR-0002) and a security note that the running `serve` endpoint executes caller-supplied expressions (`eval` + raw Playwright locator expressions, ADR-0004) so it must stay LOCAL and never be exposed to untrusted callers. A manual, live, flaky `docs/manual-smoke-kayak.md` documents the end-to-end pipe against Kayak (`setup-profile` -> `serve --headless` -> `goto` a search -> `snapshot` -> `stop`, the landed ADR-0005 shape), explicitly NON-CI: it is not part of `verify`/`pnpm test`, and the automated suite never hits a live third-party site or asserts on its DOM. Docs only; no code change.
