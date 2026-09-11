---
title: 'Chrome CLI proxying: no SOCKS5 auth at all, and loopback is never proxied'
slug: chrome-cli-proxy-limits-no-socks-auth-and-loopback-bypass
type: finding
status: verified
created: 2026-09-11
source: 'Chromium `net/docs/proxy.md` (https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md), fetched Sept 2026, for the auth/DNS/UDP statements. Loopback and the Playwright-launch difference verified locally against Chromium 1228 + playwright-core 1.61.1: the proxy behaviour in `packages/core/test/real-chrome-proxy.test.ts` (a real local SOCKS5 server observing the browser connections, including a socks5h case asserting the proxy receives a HOSTNAME), and `shouldProxyLoopback` read out of the installed playwright-core bundle.'
---

## What is true

Configuring a proxy via Chrome's own `--proxy-server` flag (the only option for a
SPAWNED real Chrome, since there is no Playwright launch to configure) has three
properties worth writing down:

1. **No SOCKSv5 authentication, at all.** Chromium's docs: "No authentication
   methods are supported for SOCKSv5 in Chrome (although some do exist for the
   protocol)", and separately "Chrome does not implement this, and will not use any
   credentials embedded in the proxy settings." So a `user:pass@` SOCKS URL cannot
   work: the credentials are ignored, and requests then fail
   (`ERR_PROXY_CONNECTION_FAILED`). Playwright's launch path is unaffected because
   Playwright answers the auth challenge itself rather than handing credentials to
   Chrome.

2. **Loopback is NEVER proxied by default, via the CLI flag.** Verified the hard
   way: the first end-to-end proxy test failed with the local SOCKS server having
   logged Chrome's own background requests (`clients2.google.com:80`, ...) while the
   FIXTURE request to `127.0.0.1` never appeared. Chromium's implicit bypass list
   exempts `localhost`/`127.0.0.1`; `--proxy-bypass-list=<-loopback>` removes the
   exemption. So for a SPAWNED Chrome, "routes ALL traffic through the proxy" is
   really "all non-loopback traffic".

   **Playwright's launch path differs**, which matters because webhands shares one
   `--proxy` flag across both: `shouldProxyLoopback(bypass)` in playwright-core
   1.61.1 returns true when no bypass is configured, and Playwright then appends
   `--proxy-bypass-list=<-loopback>` itself, so loopback IS proxied there (unless
   `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK` is set). Do not infer one
   path's behaviour from the other.

3. **DNS for URL loads is always remote under SOCKSv5.** "In Chrome when a proxy's
   scheme is set to SOCKSv5, name resolution is always done proxy side." The
   `--host-resolver-rules` catch-all webhands adds for `socks5h` is therefore about
   the SIDE CHANNELS (DNS prefetcher and friends), not the URL loads themselves.

Also noted, not fixed: **SOCKSv5 carries TCP only** ("It cannot be used to relay UDP
traffic"), so WebRTC can still reveal a local/real address regardless of the proxy.

## Consequence

- `--real-chrome --proxy` is supported and reuses the EXISTING `parseSocksProxy`, so
  `socks5h` vs `socks5` means the same thing in both modes, and a malformed value is
  still the typed `InvalidProxyError` rather than an unproxied browser.
- A credentialled URL in that mode raises the new typed `ProxyAuthUnsupportedError`
  rather than being silently stripped. That wording matters: the failure mode we are
  avoiding is a user believing their traffic was authenticated and proxied when it
  was not. The fix command points at terminating auth locally (`ssh -D 1080`).
- The loopback exemption is left in place (a user does not want their local dev
  server proxied) and is DOCUMENTED instead, in the README and beside the parser.
  Only the tests pass `<-loopback>`, because a local fixture is the only target they
  may use.
- A test asserts the proxy FAILS CLOSED: with an unreachable proxy the navigation
  does not complete and the page never reaches the target, rather than quietly
  falling back to the real IP.
