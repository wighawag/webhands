# webhands

A CLI (built with [`incur`](https://github.com/wevm/incur), so it doubles as an
MCP server) that drives a real, persistent browser via Playwright, letting an
agent or human control any website from a genuinely logged-in browser session on
their own machine and IP.

It launches (or attaches to) a Chromium browser using a dedicated profile,
supports a one-time headed login that is later reused headless, keeps the session
alive across separate CLI invocations behind a long-lived `serve` process, and
exposes page verbs (`goto`, `snapshot`, `click`, `type`, `eval`, `script`,
`wait`, `cookies`) with structured output. The composable verbs are the floor;
`script` is the power-user ramp that runs a driver-context Playwright function
against the live page so an agent can batch a whole sub-flow into ONE call (see
the Security note and [`docs/adr/0012`](docs/adr/0012-script-verb-driver-context-page.md)).

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

For the full agent playbook (workflow, gotchas, guardrails) AND a complete
per-verb reference, install the bundled skill: `npx webhands skills add` then look
for `use-webhands`. A skilled agent drives the whole surface from that skill and
does NOT need to re-dump `--help`/`--llms-full` at runtime; those discovery dumps
(`npx webhands <verb> --help`, `npx webhands --llms-full`) stay available for
human exploration or an obscure flag.

**Output is lean by default.** Every verb prints just its structured result; the
old per-result "Suggested command" next-step breadcrumbs are suppressed (an agent
never reads them, so they were pure token overhead). Exploring by hand and want
the breadcrumbs back? Add `--cta` (alias `--hints`) to any verb, or set
`WEBHANDS_CTA=1` to pin them on for your shell.

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

## Does it deliver? (the capability scoreboard)

There is a measured answer, not just a claim. The eval harness runs the SAME
real-site goal with two toolkits, a webhands agent and a raw-Playwright-only
baseline, and compares them on outcome + token cost. The current reference
numbers (and an honest reading of what they do and do not show) live in
[`evals/SCOREBOARD.md`](evals/SCOREBOARD.md). Short version: on simple, scriptable
sandbox flows both toolkits reach the goal and raw Playwright is currently cheaper
(webhands' verb-at-a-time loop costs more tokens); the verb surface is expected to
earn its keep on the messy / unfamiliar / anti-bot / captcha cases the harder eval
tiers exist to measure. The harness is non-gating and never part of `pnpm test`.

## Scope and honesty (please read)

This is a **personal-use** tool. Its whole premise is that you drive a browser
**you logged into yourself**, on **your own machine and your own IP**, reusing
**your own authenticated session** (see
[`docs/adr/0002`](docs/adr/0002-real-session-over-fingerprint-spoofing.md)). It is
deliberately local and single-session by design.

- **No login-bypass, no built-in CAPTCHA solver.** The human does the one-time
  login and clears any anti-bot challenge in the headed `setup-profile` step.
  webhands ships NO captcha solver and NO provider key, and does not bypass
  authentication itself. What changed: the verb surface is now rich enough that it
  no longer STANDS IN THE WAY of a capable agent that brings its OWN key. Such an
  agent can get past a captcha by poking the page with verbs, both families: the
  token-harvest family by reading the sitekey with a frame-aware `query`, `type`ing
  a provider token into the response sink, and firing the callback; the vision/tile
  family with the coordinate `mouse`, the element-clipped `screenshot`, and the
  cross-origin frame read. We do not solve it; we no longer stand in the way. The
  agent supplies its own key and its own logic (or uses a hand, below). webhands
  is capable, not a solver.
- **Hands are the simpler path (still).** A *hand* is a third-party capability
  module (`iamhuman` today, a future buy-on-amazon hand) that closes over the live
  page and makes the hard thing ONE call. A dumb agent plus a hand still gets there
  in a single call, even though a capable agent can now do the same over several
  verb turns. The two paths coexist: the verb surface is the floor that makes the
  unaided path POSSIBLE; a hand is the ramp that makes it EASY. (A hand is a
  trusted in-process peer, loaded only when you name it in `hands.json`; see
  [`docs/adr/0007`](docs/adr/0007-public-hand-contract-and-explicit-declarative-loading.md).)
- **No fingerprint-spoofing / anti-detect tricks.** It leans on being a *real*
  browser/profile/IP rather than spoofing. There is no proxy *rotation* or
  anti-detect build here. (A single, user-chosen SOCKS proxy for traffic/DNS
  control is available opt-in via `--proxy`; see *Optional: route traffic and
  DNS through a SOCKS proxy* below.)
- **Your own session only.** A replayed/stolen cookie does not work anyway
  (clearance is bound to the browser fingerprint and IP, not just the cookie);
  the design assumes the session is genuinely yours.

In short: this is for reading and acting on web apps **you already have an account
on**, from **your own browser**, the way you could by hand.

## Optional: stealth launch (opt-in, default OFF)

Standard Playwright drives Chromium over CDP and calls `Runtime.enable` at
startup. That emits a side-effect a few lines of page JS can detect, and some
anti-bot WAFs (Imperva/Cloudflare/DataDome) use it to serve an "Access Denied"
block page *before the page even renders* — even on a real residential IP, even
headed. `@webhands/core` can optionally launch via
[Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) (an
API-compatible Playwright fork that patches exactly these CDP leaks) to remove
that one tell.

This is **off by default** — vanilla Playwright stays the default. To enable it:

1. Install the optional dependency (it is NOT pulled in unless you ask for it):

   ```sh
   pnpm add patchright
   # if you do NOT pass --use-system-browser chrome, also fetch its browser:
   #   pnpm exec patchright install chromium
   ```

2. Bring the session up with `--stealth`. The realistic recipe also drives your
   installed system browser (`--use-system-browser chrome`), headed, against a
   **warmed, logged-in profile**:

   ```sh
   # serve consumes these (it is where the browser is launched, ADR-0005):
   npx webhands serve --headed --stealth --use-system-browser chrome
   ```

   `--use-system-browser` is independent of `--stealth`: you can drive real
   Chrome with or without the Patchright path, and stealth with or without a
   system browser. Other channel names work too (e.g. `msedge`).

3. Optional extra hardening. `--no-viewport` lets the real browser window drive
   its own size instead of Playwright's fixed 1280x720 emulated viewport (a
   known headless tell). It is **defaulted ON under `--stealth`** (Patchright's
   recommended recipe) and is overridable; pass `--viewport` to keep the fixed
   viewport even under stealth. webhands deliberately does **not** override
   `user-agent`, `locale`, `timezone`, or `headers`: a wrong UA is a bigger tell
   than none.

Programmatic equivalent (the `--stealth` / `--use-system-browser` /
`--no-viewport` flags map onto these transport options; the constructor also
takes `extraLaunchArgs` and `ignoreDefaultArgs` escape hatches for additional
hardening flags, none of which touch the `OpenTarget` seam):

```ts
import {PlaywrightLaunchTransport} from '@webhands/core';

const transport = new PlaywrightLaunchTransport(
  {}, // profile location (omit for ~/.webhands)
  [], // extra hands
  {stealth: true, systemBrowser: 'chrome'}, // noViewport defaults to true here
);
// Stealth + headed + a real logged-in profile is the strongest recipe:
const session = await transport.open({
  mode: 'launch',
  profile: 'default',
  headed: true,
});
```

If stealth is enabled but `patchright` is not installed, the open throws a typed
`MissingStealthDependencyError` (the CLI prints `pnpm add patchright` as the fix).
It **never silently falls back** to vanilla Playwright, because that would put
the tell back without telling you.

**Honest caveat.** Stealth addresses ONLY the CDP `Runtime.enable` automation
tell, and the launch-hardening knobs (`--no-viewport`, `extraLaunchArgs`,
`ignoreDefaultArgs`) reduce but do **not** eliminate detection. They are
**necessary-but-not-sufficient**: IP reputation and session/profile
reputation still matter. The realistic recipe is stealth +
`systemBrowser: 'chrome'` + headed + a warmed, logged-in profile + a residential
IP (see
[`docs/adr/0002`](docs/adr/0002-real-session-over-fingerprint-spoofing.md)).

## Optional: route traffic and DNS through a SOCKS proxy (opt-in, default OFF)

By default webhands connects directly on your own machine and IP. If you want
the browser to egress through a chosen SOCKS proxy (a VPN exit, an SSH/Tor SOCKS
endpoint, a residential proxy), pass `--proxy <socks-url>` to `serve` (or
`launch`). It routes **all** browser traffic AND DNS through that one proxy:

```sh
# socks5h:// tunnels DNS through the proxy too (no DNS leak):
npx webhands serve --headed --proxy socks5h://127.0.0.1:1080

# with credentials:
npx webhands serve --proxy socks5h://user:pass@host:1080
```

- **`socks5h://` means no DNS leak.** webhands adds Chromium's
  `--host-resolver-rules` catch-all so even side channels (the DNS prefetcher)
  cannot leak a raw local DNS query; only the proxy's own host is resolved
  locally. This is the recommended form.
- **`socks5://` (or `socks://`) allows local DNS.** Use it when you deliberately
  want split DNS. URL loads still resolve at the proxy, but Chromium may issue
  some local DNS. Override either way with the programmatic `proxyNoLeak`
  option.
- **A malformed `--proxy` value fails loudly** with a typed `InvalidProxyError`
  (it never silently launches unproxied, which would leak the traffic you asked
  to tunnel).

Programmatic equivalent:

```ts
import {PlaywrightLaunchTransport} from '@webhands/core';

const transport = new PlaywrightLaunchTransport(
  {}, // profile location
  [], // extra hands
  {proxy: 'socks5h://127.0.0.1:1080'}, // all traffic + DNS via the proxy, no leak
);
```

**Honest caveat.** A proxy changes your IP and DNS path; it does **not** by
itself defeat bot detection, and a proxy/VPN/datacenter IP often reads WORSE
than a clean residential one. This is a deliberate, scoped opt-in deviation from
the "own IP" default (see
[`docs/adr/0009`](docs/adr/0009-opt-in-socks-proxy-all-traffic-and-dns.md)).

## Security note (the `serve` endpoint runs arbitrary code)

The page verbs execute caller-supplied expressions: `eval` runs a JS expression
in the page, `script` runs a driver-context JS function handed the full live
Playwright `page` (so one call can batch a locate/act/wait/read sub-flow), and a
`click`/`type` locator is a raw Playwright locator EXPRESSION the controller
evaluates (see
[`docs/adr/0004`](docs/adr/0004-verb-surface-exposes-playwright-locator-semantics.md)
and
[`docs/adr/0012`](docs/adr/0012-script-verb-driver-context-page.md)).
That is by design for a LOCAL tool driven by its own agent against your own
session, but it means the running `serve` endpoint is a code-execution surface.

`script` is the SAME page-script surface as `eval` (caller JS against your own
session), widened from one page-world expression to a driver-context body + the
`page` object — NOT a new privilege, and NOT the larger `hands.json` hand-loading
(npm-dependency) surface: it reads and runs a JS source FILE (a path you pass,
`npx webhands script ./flow.js`), it loads no
module (see [`docs/adr/0012`](docs/adr/0012-script-verb-driver-context-page.md)).
The same loopback-only rule below covers it.

- **Do NOT expose the `serve` endpoint to untrusted callers.** Keep it bound to
  localhost (the default); never bind it to a public interface or hand its URL to
  code you do not trust. Anyone who can call it can run arbitrary JavaScript in
  your logged-in session (`eval`, `script`, and the raw Playwright locators).
