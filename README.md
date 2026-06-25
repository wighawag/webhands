# my-browser-controller

A CLI (built with [`incur`](https://github.com/wevm/incur), so it doubles as an
MCP server) that drives a real, persistent browser via Playwright, letting an
agent or human control any website from a genuinely logged-in browser session on
their own machine and IP.

It launches (or attaches to) a Chromium browser using a dedicated profile,
supports a one-time headed login that is later reused headless, keeps the session
alive across separate CLI invocations behind a long-lived `serve` process, and
exposes page verbs (`goto`, `snapshot`, `click`, `type`, `eval`, `wait`,
`cookies`) with structured output.

## How it works (the pipe)

The browser is owned by ONE long-lived `serve` process; each verb invocation is a
thin client that drives the SAME live page and exits (see
[`docs/adr/0005`](docs/adr/0005-incur-serve-hosts-the-long-lived-session.md)). The
typical end-to-end flow:

1. `my-browser-controller setup-profile`: opens the dedicated profile in a
   VISIBLE browser so you log in / clear any anti-bot challenge ONCE. State
   (cookies, login, challenge clearance) persists on disk.
2. `my-browser-controller serve --headless`: launches the one browser against
   that saved profile and keeps it alive (runs until `stop` or Ctrl-C).
3. `my-browser-controller goto <url>` then `my-browser-controller snapshot` (and
   `click` / `type` / `eval` / `wait`): separate invocations that all drive the
   single live page the server holds.
4. `my-browser-controller stop`: tears the session down.

A verb run with no live server prints a clear error telling you to run `serve`
first; the tool never silently spawns a browser.

## Scope and honesty (please read)

This is a **personal-use** tool. Its whole premise is that you drive a browser
**you logged into yourself**, on **your own machine and your own IP**, reusing
**your own authenticated session** (see
[`docs/adr/0002`](docs/adr/0002-real-session-over-fingerprint-spoofing.md)). It is
deliberately local and single-session by design.

- **Driving sites like Kayak or Skyscanner is generally against their Terms of
  Service.** Automating access to such sites, even from a real session, can
  violate those terms. Using this tool against a third-party site is your
  responsibility; check that site's ToS and respect it. Kayak is only the
  smoke-test TARGET that proves the pipe end to end, not a feature this tool
  endorses scraping.
- **No login-bypass, no CAPTCHA-solving.** The human does the one-time login and
  clears any anti-bot challenge in the headed `setup-profile` step. This tool
  does NOT bypass authentication or solve CAPTCHAs programmatically, and it is not
  intended to.
- **No fingerprint-spoofing / anti-detect tricks.** It leans on being a *real*
  browser/profile/IP rather than spoofing. There is no proxy rotation or
  anti-detect build here.
- **Your own session only.** A replayed/stolen cookie does not work anyway
  (clearance is bound to the browser fingerprint and IP, not just the cookie);
  the design assumes the session is genuinely yours.

In short: this is for reading and acting on web apps **you already have an account
on**, from **your own browser**, the way you could by hand, not for scraping
third parties at scale or evading their protections.

## Security note (the `serve` endpoint runs arbitrary code)

The page verbs execute caller-supplied expressions: `eval` runs a JS expression
in the page, and a `click`/`type` locator is a raw Playwright locator EXPRESSION
the controller evaluates (see
[`docs/adr/0004`](docs/adr/0004-verb-surface-exposes-playwright-locator-semantics.md)).
That is by design for a LOCAL tool driven by its own agent against your own
session, but it means the running `serve` endpoint is a code-execution surface.

- **Do NOT expose the `serve` endpoint to untrusted callers.** Keep it bound to
  localhost (the default); never bind it to a public interface or hand its URL to
  code you do not trust. Anyone who can call it can run arbitrary JavaScript in
  your logged-in session.

## Manual smoke test

A live, flaky, **non-CI** end-to-end smoke against Kayak is documented at
[`docs/manual-smoke-kayak.md`](docs/manual-smoke-kayak.md). It is a manual proof
of the pipe, NOT part of the `verify` gate, and the automated test suite never
hits a live third-party site.
