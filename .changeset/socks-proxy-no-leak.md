---
'@webhands/core': minor
'webhands': minor
---

Add an opt-in `--proxy` SOCKS option that routes ALL browser traffic AND DNS
through one SOCKS proxy, with no DNS leak by default. The seam is unchanged:
`OpenTarget` stays Playwright/CDP-free (ADR-0003) and the proxy knob lives ONLY
on the transport-construction policy (`PlaywrightLaunchTransportOptions`).

- `proxy?: string` on `PlaywrightLaunchTransportOptions`: a SOCKS URL the
  transport parses and forwards to Playwright's `proxy` launch option. Accepts
  `socks5h://host:1080`, `socks5://host:1080`, or `socks://host:1080`, with an
  optional `user:pass@` userinfo (URL-decoded). The scheme decides DNS handling:
  `socks5h://` means "resolve DNS at the proxy" (no leak), `socks5://`/`socks://`
  mean "SOCKS5, local DNS allowed".
- DNS no-leak: when no-leak is in effect (the `socks5h` scheme, or an explicit
  override), the transport adds Chromium's
  `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE <proxyHost>` catch-all, the
  flag the Chromium SOCKS design doc prescribes so even side channels (the DNS
  prefetcher) cannot leak a raw local DNS query. The proxy host is EXCLUDEd so
  Chromium can still reach the proxy itself.
- `proxyNoLeak?: boolean` overrides the scheme's implied DNS behaviour: force the
  leak-free catch-all even for a plain `socks5://`, or allow local DNS even for
  `socks5h://`.
- A malformed `--proxy` value throws the typed `InvalidProxyError`
  (`code: 'invalid-proxy'`) instead of silently launching unproxied (which would
  leak the very traffic the user asked to tunnel). The CLI maps it to a fix hint
  showing the expected SOCKS URL shape.
- `parseSocksProxy` and `hostResolverRulesArg` are exported from `@webhands/core`
  so the parsing/flag logic has one tested home.

CLI: `webhands launch`/`serve` gain `--proxy <socks-url>`, threaded through the
existing `LaunchPolicy`/`stealthOptions` pattern into the launch transport.

This is a DELIBERATE deviation from the project's "real machine and IP, no
proxy" default stance (ADR-0002): it is opt-in, default OFF, and documented in
ADR-0009. The honest caveat stands: tunnelling traffic changes your IP/DNS path
but does not by itself defeat bot detection, and a proxy IP can READ worse than a
clean residential one.
