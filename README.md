<div align="center">
<a href="https://github.com/wighawag/webhands#readme"><img alt="webhands" src="https://raw.githubusercontent.com/wighawag/webhands/main/media/preview.png" width="640" /></a>
<hr/>

<a href="https://npmjs.com/package/webhands"><img alt="Version" src="https://img.shields.io/npm/v/webhands" /></a>
<a href="https://github.com/wighawag/webhands/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/wighawag/webhands" /></a>
</div>

# webhands

**Let your AI agent drive a real, logged-in browser on your own machine.**

webhands is a small CLI (it also doubles as an
[MCP](https://modelcontextprotocol.io) server, thanks to
[`incur`](https://github.com/wevm/incur)) that gives an agent (or you) hands on a
real Chromium browser. It reuses a browser YOU logged into yourself, on YOUR
machine and YOUR IP, so the agent can read and act on the web apps you already
use, the way you would by hand.

The idea in one line: **you log in once in a window you can see; after that your
agent can open pages, read them, click, type, and run whole sub-flows** against
that same live, authenticated session.

Under the hood it launches (or attaches to) Chromium with a dedicated profile,
keeps one browser alive behind a long-lived `serve` process, and exposes page
verbs (`goto`, `snapshot`, `click`, `type`, `eval`, `script`, `wait`, `cookies`)
that print clean, structured output an agent can read cheaply. The composable
verbs are the floor; `script` is the power-user ramp that runs a driver-context
Playwright function against the live page so an agent can batch a whole sub-flow
into ONE call (see the Security note and
[`docs/adr/0012`](docs/adr/0012-script-verb-driver-context-page.md)).

**New here? Jump to:** [Use it via your AI agent](#use-it-via-your-ai-agent-start-here)
(the 30-second start) · [Does it deliver?](#does-it-deliver-the-capability-scoreboard)
(measured vs Playwright) · [Scope and honesty](#scope-and-honesty-please-read)
(what it will and will not do).

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
for `use-webhands`. It is shipped INSIDE the package, so that works from a bare
`npx` with no clone of this repo (the command also installs a generated
`webhands` command reference; those two are the whole set). A skilled agent
drives the whole surface from that skill and
does NOT need to re-dump `--help`/`--llms-full` at runtime; those discovery dumps
(`npx webhands <verb> --help`, `npx webhands --llms-full`) stay available for
human exploration or an obscure flag.

### Linking the skill instead of syncing it

`use-webhands` is a real FILE in the package — `<pkg>/skills/use-webhands/SKILL.md`
— so on a declarative setup (Nix, or any read-only install) you can point your
agent straight at it and never run the CLI:

```sh
ln -s "$(dirname "$(readlink -f "$(which webhands)")")/../skills/use-webhands" \
      ~/.agents/skills/use-webhands
```

That gives you a skill PINNED to the version of the binary you actually have, and
read-only by construction. The syncing path (`skills add`) instead COPIES into
`~/.agents/skills/`, which is mutable and drifts from the installed tool.

**Pick one path per machine; they do not compose.** `skills add` clears its
destination before writing, so running it after linking will delete your symlink
and leave a mutable copy in its place, silently. Note also that the generated
`webhands` command reference has no file to link: it is rendered from the command
map at sync time into a temp dir, so materializing it REQUIRES running
`skills add`. If you link, you get `use-webhands` only — which is the complete
reference anyway.

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
   (cookies, login, challenge clearance) persists on disk. It takes the SAME
   browser-selection flags as `serve` (`--use-system-browser`, `--stealth`,
   `--proxy`, `--no-viewport`): a profile dir is written by a specific browser
   build, so set it up with the browser you will later drive it with.
2. `webhands serve --headless`: launches the one browser against
   that saved profile and keeps it alive (runs until `stop` or Ctrl-C).
3. `webhands goto <url>` then `webhands snapshot` (and
   `click` / `type` / `eval` / `wait`): separate invocations that all drive the
   single live page the server holds.
4. `webhands stop`: tears the session down.

A verb run with no live server prints a clear error telling you to run `serve`
first; the tool never silently spawns a browser.

## Does it deliver? (the capability scoreboard)

Yes, and there is a measured answer, not just a claim. The eval harness runs the
SAME real-site goal with two toolkits, a webhands agent and a raw-Playwright-only
baseline, and compares them on **outcome** (did it finish the job?) and **token
cost**. Full numbers, every raw run line, and the honest caveats live in
[`evals/SCOREBOARD.md`](evals/SCOREBOARD.md).

The short version, latest runs first:

| Kind of flow | webhands (best) | raw Playwright | Who wins |
| --- | --- | --- | --- |
| **Messy / unfamiliar DOM** the agent must explore to act | **PASS, ~0.7M tokens** | PASS, ~1.3M | **webhands** (both pass; ~1.9x cheaper) |
| **Dynamic goal** that only resolves from live page state | **PASS, ~1.7 to 2.5M** | PASS, ~1.6M | **tie** (both pass) |
| Trivial, one-shot-scriptable sandbox flow | PASS | PASS, cheaper | Playwright (a blind script needs no exploring) |

So the honest reading is: **on the flows webhands is built for (messy, changing,
explore-then-act, dynamic, anti-bot pages) webhands matches or beats raw
Playwright on BOTH outcome and tokens.** On a trivial page a human could script
in one blind pass, raw Playwright is cheaper, exactly as you'd expect: webhands
drives a composable verb surface, so it shines precisely where "write one script
and run it blind" breaks down. See the
[Latest results first](evals/SCOREBOARD.md#latest-results-first-the-short-answer)
summary for the corrected reading (earlier tables show a bigger gap from a cold,
unskilled agent and an unfair baseline, both since fixed).

The harness is non-gating and never part of `pnpm test`.

### Where hands change the game (above the verbs-vs-Playwright line)

The scoreboard above compares the raw verb surface against raw Playwright. A
**hand** (a pluggable capability module, see *Scope and honesty* below) sits ABOVE
that comparison and beats it on two separate axes:

- **New capability raw Playwright cannot reach at all.** A captcha-solving hand
  (`iamhuman`) is not "cheaper Playwright": it is a capability webhands
  deliberately does not ship (a provider key + solving logic) plugged in as one
  verb. Raw Playwright gives an agent a page to poke; it does not give it a
  captcha solver. So on a captcha-gated flow the honest comparison is not
  "webhands vs Playwright on tokens," it is "reaches the goal vs does not."
- **Token collapse on flows Playwright CAN do.** Everything the scoreboard shows
  about narrowing the gap is about an agent driving a flow it must RE-EXPLORE each
  run. A hand encodes that flow ONCE, so a known sub-flow (log in, run a search,
  complete a checkout) becomes a single cheap verb call instead of an N-turn
  explore-decide-act loop the agent re-pays every time. The scoreboard's messy-DOM
  win already hints at this (the webhands agent wins partly by not re-deriving
  boilerplate each run); a hand takes it to the limit by authoring the flow into
  one call.

So: **verbs are the floor (makes the flow POSSIBLE), and a hand is both the
ceiling (a NEW capability) and the accelerator (a known flow becomes one cheap
call).** Authoring that hand cheaply, straight from a flow the agent just drove
successfully, is an incubating idea (a `distill` verb,
`work/notes/ideas/distill-session-into-hand.md`).

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
- **Hands are the ceiling AND the accelerator.** A *hand* is a capability
  module (`iamhuman` today, a future buy-on-amazon hand) that closes over the live
  page and makes the hard thing ONE call. It earns its keep two ways (see *Where
  hands change the game* under the scoreboard). First, a NEW capability raw
  Playwright cannot reach at all: a captcha-solving hand plugs in solving logic +
  a provider key webhands itself does not ship. Second, TOKEN COLLAPSE on flows an
  agent could otherwise drive: a known sub-flow (log in, search, checkout) is
  authored into the hand ONCE, so it becomes a single cheap call instead of an
  N-turn explore loop the agent re-pays every run. The verb surface is the floor
  that makes the unaided path POSSIBLE; a hand is the ramp that makes it EASY and
  CHEAP. (A hand is a trusted in-process peer, loaded only when you name it in
  `hands.json`; see
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

## Anti-bot: drive your own real Chrome (`--real-chrome`)

If a site blocks you, reach for this before `--stealth`. The cheapest fix is still
headed plus a human clearing the challenge once; this is the next rung, and the one
that worked when nothing else did. Measured
against Akamai Bot Manager on an authenticated booking site: a Playwright-launched
browser was blocked identically in every configuration (default, `--stealth`,
`--stealth --use-system-browser chrome`, fresh profile), while attaching to a
Chrome the human started drove a nine-screen authenticated flow with no blocking.

```sh
# Start YOUR Chrome with a debugging port on a dedicated profile dir, then attach,
# in one command. Opens a VISIBLE window so you can log in and take over:
npx webhands serve --real-chrome

# Keep your tabs alive after `stop` (the next --real-chrome serve re-attaches):
npx webhands serve --real-chrome --keep-browser

# Chrome somewhere unusual? Name it:
WEBHANDS_CHROME=/opt/google/chrome/chrome npx webhands serve --real-chrome
```

**It needs a working Chrome sandbox**, which a desktop has and a container or CI
runner generally does not: there, a plainly-started Chrome aborts at startup
(usually SIGABRT, and webhands quotes Chrome's own stderr back at you so you can
see why). If you must run it in such an environment, `WEBHANDS_CHROME_ARGS`
appends extra browser flags:

```sh
WEBHANDS_CHROME_ARGS='--no-sandbox --disable-dev-shm-usage' npx webhands serve --real-chrome
```

Understand what that buys and costs: it DISABLES the browser's sandbox, so only do
it where that is acceptable. webhands never adds it for you, because this mode
exists to be your real browser and a real desktop Chrome is sandboxed. (Playwright
passes `--no-sandbox` by default for its own launches, which is why the bundled-
Chromium paths work in CI while this one does not.)

The equivalent by hand, which still works and is what `--real-chrome` automates:

```sh
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/scratch
npx webhands serve --endpoint http://127.0.0.1:9222
```

**Read the symptom correctly.** A bot block is deceptive: the static, edge-cached
top page renders fine, so it looks like it is working, and then every DYNAMIC
endpoint returns a bare "Access Denied". Check a dynamic endpoint before
concluding anything. If you get blocked part way through a session, see the
cookie-clearing recovery below.

**Honesty: this is not a cloak.** Chrome sets `navigator.webdriver = true` whenever
a remote-debugging port is enabled, before any client attaches, so this mode is
just as visible on that signal as a Playwright launch. What differs is everything
else: no launch-hardening flags, a real warm profile with history and prefs, a real
window, your own IP and your own behaviour. Details and the measurements are in
[`docs/adr/0014`](docs/adr/0014-attach-to-the-users-own-chrome-is-the-anti-bot-answer.md).

**Lifetime.** webhands spawned that browser, so `stop` terminates it, unlike plain
`--endpoint` attach where the browser is yours and is left alone. `--keep-browser`
inverts it. The Playwright LAUNCH flags (`--stealth`, `--use-system-browser`,
`--no-viewport`) do not apply in this mode, and `serve` warns if you pass them.

**`--proxy` DOES apply**, and it is the only lever on the exit IP here (a real
browser on a datacentre IP is still on a datacentre IP, and that is part of what a
bot manager weighs):

```sh
# Chromium's own --proxy-server, plus the no-DNS-leak resolver catch-all:
npx webhands serve --real-chrome --proxy socks5h://127.0.0.1:1080
```

Three caveats, all verified rather than assumed:

- **No credentials.** Chromium documents that it supports no SOCKSv5
  authentication and "will not use any credentials embedded in the proxy settings",
  so a `user:pass@` URL is REFUSED here rather than silently sent unauthenticated.
  Terminate the auth locally (`ssh -D 1080`, or any local relay that adds the
  upstream credentials) and point `--proxy` at that. The default Playwright launch
  path can carry credentials, because Playwright answers the auth challenge itself.
- **Loopback is never proxied.** Chromium's implicit bypass list exempts
  `localhost`/`127.0.0.1`, so "all traffic" means all non-loopback traffic. That is
  almost always what you want (your local dev server stays direct).
- **It fails closed, not open.** If the proxy is unreachable, navigation fails
  rather than quietly leaving via your real IP. There is a test asserting exactly
  that, because the opposite is one `direct://` away in Chromium's flag syntax.

WebRTC can still reveal a local or real address over UDP, which a SOCKS proxy cannot
carry (Chromium: "SOCKSv5 is only used to proxy TCP-based URL requests"). webhands
exposes no lever for this today: if it matters, start Chrome yourself with
`--force-webrtc-ip-handling-policy=disable_non_proxied_udp` and attach with
`serve --endpoint` instead of using `--real-chrome`.

## Recovering from a mid-session bot block

A WAF can flip from serving you to blocking you part way through a session (one
observed trip: ~15 rapid automated flows in 40 minutes). The verdict lives in a few
NAMED COOKIES, so it survives reloads until they are gone. In the one session this
was measured on (Akamai in front of an ASP.NET app) the LOGIN lived in entirely
different cookies and survived the clear. That is the common shape rather than a
guarantee: some sites bind the session to the WAF cookie, in which case this signs
you out. Export first if that would be expensive.

```sh
# Akamai keeps its verdict in these four; other WAFs use their own names.
npx webhands cookies clear --name _abck --name bm_sz --name bm_sv --name ak_bmsc
```

It reports how many cookies were actually removed, so `cleared: 0` means nothing
matched (check the names) rather than silently doing nothing. Then slow down: pace
flows with `wait`.

Clear ONCE. This is not evading a protection: you are clearing cookies in your own
browser, exactly as you could from Chrome's own UI, so the WAF re-evaluates the real
logged-in user. It stops being that if you loop it, which is why there is no
`--bot-block` preset flag and why the four names live here rather than in the tool
([`docs/adr/0016`](docs/adr/0016-cookies-clear-takes-no-vendor-preset-and-refuses-an-empty-filter.md)).

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

2. Bring the session up with `--stealth`, ideally also driving your installed
   system browser (`--use-system-browser chrome`), headed, against a **warmed,
   logged-in profile**:

   ```sh
   # serve consumes these (it is where the browser is launched, ADR-0005):
   npx webhands serve --headed --stealth --use-system-browser chrome
   ```

   Do NOT add `--expose-cdp` here: a remote-debugging port re-opens an automation
   surface on the very browser `--stealth` is hardening. `serve` warns in its
   output envelope if you ask for both.

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

**Honest caveat, and it is a big one.** Stealth addresses ONLY the CDP
`Runtime.enable` automation tell, and the launch-hardening knobs (`--no-viewport`,
`extraLaunchArgs`, `ignoreDefaultArgs`) reduce but do **not** eliminate detection.
They are **necessary-but-not-sufficient**: IP reputation and session/profile
reputation still matter (see
[`docs/adr/0002`](docs/adr/0002-real-session-over-fingerprint-spoofing.md)).

Against a serious commercial bot manager, measured rather than assumed, stealth
was **not enough at all**. On an Akamai-protected site, a Playwright-LAUNCHED
browser was blocked identically in every configuration tried: default launch,
`--stealth`, `--stealth --use-system-browser chrome`, and a brand-new profile. The
symptom is deceptive, so read it carefully: the static, edge-cached top page
renders fine, which looks like success, and then every dynamic endpoint returns a
bare "Access Denied". What worked flawlessly through a nine-screen authenticated
flow was **attaching to a Chrome the human started themselves**:

```sh
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/scratch
npx webhands serve --endpoint http://127.0.0.1:9222
```

So treat `--stealth` as one tell removed, not as the anti-bot answer. The answer
is to drive a real browser you started and logged into yourself.

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
