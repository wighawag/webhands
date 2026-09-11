---
'webhands': minor
'@webhands/core': minor
---

**`--proxy` now works with `--real-chrome`**, routing the spawned browser's traffic and DNS through a SOCKS proxy via Chromium's own `--proxy-server` (plus the `--host-resolver-rules` no-leak catch-all for `socks5h`). It reuses the existing `parseSocksProxy`, so `socks5h` vs `socks5` means the same thing in both modes and a malformed value is still the typed `InvalidProxyError` rather than an unproxied browser. This matters more in this mode than on the launch path: `--real-chrome` exists to present a real browser to an anti-bot system, the exit IP is part of what such a system weighs, and a proxy is the only lever on it there. `serve` no longer warns that `--proxy` is inapplicable under `--real-chrome`, because it is not.

Three limits, taken from Chromium's `net/docs/proxy.md` and verified locally rather than assumed:

- **Credentials are REFUSED in this mode**, with a new typed `ProxyAuthUnsupportedError`. Chrome "supports no authentication methods for SOCKSv5" and "will not use any credentials embedded in the proxy settings", so passing a `user:pass@` URL through would fail every request, and stripping it silently would leave the user believing their traffic was authenticated and proxied. The fix command points at terminating auth locally (`ssh -D 1080`) and the message redacts the password. The default Playwright launch path still accepts credentials, since Playwright answers the auth challenge itself.
- **Loopback is never proxied** (Chromium's implicit bypass list), so "all traffic" means all non-loopback traffic. Left as-is, because nobody wants their local dev server proxied, and documented instead.
- **It fails closed**: an unreachable proxy means the navigation does not complete, rather than quietly leaving via the real IP.

Tested end to end against a real local SOCKS5 server that observes the browser's connections, so the claim asserted is "the page traffic went through the proxy", not merely "the flag was forwarded". A new pure `buildRealChromeArgs` makes the flag construction testable without spawning a browser.
