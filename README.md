# webhands

A CLI (built with [`incur`](https://github.com/wevm/incur), so it doubles as an
MCP server) that drives a real, persistent browser via Playwright, letting an
agent or human control any website from a genuinely logged-in browser session on
their own machine and IP.

It launches (or attaches to) a Chromium browser using a dedicated profile,
supports a one-time headed login that is later reused headless, keeps the session
alive across separate CLI invocations behind a long-lived `serve` process, and
exposes page verbs (`goto`, `snapshot`, `click`, `type`, `eval`, `wait`,
`cookies`) with structured output.

## Use it via your AI agent (start here)

The simplest way to use `webhands` is to let your coding agent (Claude Code,
Cursor, etc.) run it through plain `bash` with `npx`. No MCP wiring, no install
step — the agent just runs `npx webhands <verb>` commands. The first run of
`npx webhands` fetches the package automatically.

Give your agent something like: *"Use `webhands` to open Kayak and read me the
live prices for EDI→BOM on 31 Oct."* A capable agent will then:

```sh
# 1. start & HOLD the browser. serve blocks, so the agent backgrounds it:
nohup npx webhands serve --headed > /tmp/webhands.log 2>&1 &
sleep 12 && cat /tmp/webhands.log     # confirm it printed an endpoint + pid

# 2. navigate the live page (separate invocation, same browser):
npx webhands goto 'https://www.kayak.co.uk/flights/EDI-BOM/2026-10-31?sort=price_a'

# 3. let JS results render, then read the page token-cheaply:
npx webhands wait --ms 8000
npx webhands snapshot --token-limit 6000

# 4. always tear down when done:
npx webhands stop
```

Three things a new user should know up front:

- **You log in once, in a window you can see.** Run `npx webhands setup-profile`
  (or start with `serve --headed`) and sign in / clear any cookie or anti-bot
  prompt yourself. That state is saved to a dedicated profile and reused on later
  runs. The tool never bypasses logins or solves CAPTCHAs — you do that part.
- **It acts as the real, logged-in you.** Reading pages is low-risk; let the agent
  do that freely. But anything that spends money, books, posts, or changes account
  state should be YOUR explicit decision — have the agent surface the link and let
  you finish checkout. (See *Scope and honesty* below.)
- **Anti-bot sites may need the visible window.** Headless runs can hit a
  "you look like a bot" page on sites like Kayak. The fix is to run `--headed` and
  clear the challenge yourself once, not to defeat it.

For the full agent playbook (workflow, gotchas, guardrails) install the bundled
skill: `npx webhands skills add` then look for `use-webhands`. Per-verb flag
reference: `npx webhands <verb> --help` or `npx webhands --llms-full`.

## How it works (the pipe)

The browser is owned by ONE long-lived `serve` process; each verb invocation is a
thin client that drives the SAME live page and exits (see
[`docs/adr/0005`](docs/adr/0005-incur-serve-hosts-the-long-lived-session.md)). The
typical end-to-end flow:

1. `webhands setup-profile`: opens the dedicated profile in a
   VISIBLE browser so you log in / clear any anti-bot challenge ONCE. State
   (cookies, login, challenge clearance) persists on disk.
2. `webhands serve --headless`: launches the one browser against
   that saved profile and keeps it alive (runs until `stop` or Ctrl-C).
3. `webhands goto <url>` then `webhands snapshot` (and
   `click` / `type` / `eval` / `wait`): separate invocations that all drive the
   single live page the server holds.
4. `webhands stop`: tears the session down.

A verb run with no live server prints a clear error telling you to run `serve`
first; the tool never silently spawns a browser.

## Scope and honesty (please read)

This is a **personal-use** tool. Its whole premise is that you drive a browser
**you logged into yourself**, on **your own machine and your own IP**, reusing
**your own authenticated session** (see
[`docs/adr/0002`](docs/adr/0002-real-session-over-fingerprint-spoofing.md)). It is
deliberately local and single-session by design.

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
on**, from **your own browser**, the way you could by hand.

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
