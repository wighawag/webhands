---
name: use-webhands
description: >-
  Drive a real, logged-in browser with the `webhands` CLI to read and act on web
  apps the human already has a session for. Use when a task needs live, rendered,
  or authenticated web content that plain HTTP fetch/search cannot get: prices and
  results behind XHR/JS, pages behind a login, or a multi-step flow on a site the
  user is signed into. This skill is the COMPLETE reference: the workflow +
  judgment layer AND a per-verb reference (what each verb does + its must-know
  arg forms), so a skilled agent drives directly without running
  `webhands --help`/`--llms-full` at runtime.
---

# use-webhands

Invoke every command as `npx webhands <verb>` (the first run fetches the package).
`webhands` owns ONE long-lived browser (a `serve` process) bound to a dedicated
profile; every other verb is a thin client that drives that SAME live page and
exits. You compose verbs across separate invocations.

This skill is the COMPLETE reference: it tells you how to RUN the pipe end to end,
WHAT EACH VERB DOES + its must-know argument forms (the [Verb reference](#verb-reference)
below), where it breaks, and what you must NOT do. **You do NOT need to run
`webhands <verb> --help` or `webhands --llms-full` at runtime** to drive the
surface; this skill covers it. (Those discovery dumps re-pull ~4KB into context
every run; reach for them only for an obscure flag this skill omits.)

## When to use vs not

USE it when:
- the data is rendered client-side (XHR/JS) so `web_fetch`/curl returns an empty
  shell (flight results, dashboards, app state),
- the page is behind a login the human holds, or behind an anti-bot wall a human
  cleared once, or
- you need to perform an action on a web app the way the user could by hand.

PREFER plain `web_search` / `web_fetch` when the content is static HTML or you
just need public facts. They are cheaper, need no browser, and carry no ToS risk.

Do NOT use it to scrape third parties at scale or to evade their protections (see
Guardrails).

## The core flow (proven, ADR-0005)

The session that persists across invocations is held by **`serve`**, NOT by
`launch`. A bare `launch` opens and closes within one invocation and does not keep
a session alive for later verbs — do not build the pipe on `launch`.

1. One-time, per profile: `webhands setup-profile` (headed) — human logs in /
   clears any challenge once. State persists on disk.
2. Bring the session up and KEEP it alive: `webhands serve` (headless default; add
   `--headed` to show the window).
3. Drive it (separate invocations against the same page):
   `webhands goto <url>` → `webhands wait --ms <n>` → `webhands snapshot`
   (then `click` / `type` / `eval` as needed).
4. Tear down: `webhands stop`.

### Running `serve` from an agent (IMPORTANT)

`serve` runs until stopped, so it BLOCKS its shell. From an agent/automation,
start it backgrounded and poll its log for the endpoint, e.g.:

```sh
nohup npx webhands serve > /tmp/webhands-serve.log 2>&1 &   # add --headed if needed
sleep 12
cat /tmp/webhands-serve.log   # expect: ok: true, an endpoint URL, and a pid
```

Then run `goto` / `snapshot` / etc. as their own commands. Always finish with
`webhands stop` so you do not leave an orphan browser (a code-execution surface)
running.

If `goto`/`snapshot` print "run `serve` first", the server is not up (or was
stopped): start `serve` and retry. The tool NEVER silently spawns a browser.

### First run on a new machine: `missing-browser-binary`

`webhands` ships the CLI, NOT a browser. On a machine where no matching browser was ever downloaded, the first `setup-profile`/`serve` fails with `code: missing-browser-binary`. **Run the command the error message gives you and retry.** It is version-pinned on purpose, e.g. `npx playwright@1.61.1 install chromium`, and the download is around 150MB.

DO NOT substitute a bare `npx playwright install chromium`: Playwright resolves browsers by REVISION and each Playwright version pins its own, so the unpinned form can install a revision webhands cannot use, succeed, and leave you on the identical error. For the same reason, "chromium is already installed" is not a reason to skip the fix: the error message names the exact build it wanted and lists the near-miss revisions sitting beside it, and several chromium trees satisfying none of them is the normal state of a machine that runs more than one Playwright project.

This is NOT a headed/display problem, so do not go looking for one. The lookup is identical headless, and the same error appears under `serve` with no window involved. It is also not a reason to escalate to the human: it is a one-command fix that you can run yourself.

### `missing-display`: headed, on a machine with no X server

The OTHER first-run failure, and a different condition entirely: the browser exists, but a HEADED launch (`setup-profile` always, `serve --headed`) has nothing to draw on. Every server, container and CI runner is in this state. The error names the fix; the three ways out, in the order you should consider them:

- **`xvfb-run -a <the same command>`** when nothing needs to be SEEN (a test run, an automated flow). It supplies a throwaway virtual display.
- **A headless `serve`** when you only wanted the page, not the window.
- **A real display the HUMAN can see**, over `ssh -X` or a VNC session, which is the only option that works when the point is a human logging in or clearing a challenge. A virtual display satisfies the browser and shows the human nothing, so do NOT reach for `xvfb-run` to "fix" a `setup-profile` that a person is supposed to be watching: ask them where they want the window instead.

## Reading pages cheaply

- `snapshot` returns a token-cheap accessibility-tree + text view — your default
  for "what's on the page". Use `--token-limit <n>` to cap output, `--full` only
  when you truly need raw DOM.
- **Read then act in ONE loop.** `snapshot` tags every node `[ref=eN]`. To act on
  what you just read, pass that bare `eN` straight to `click`/`type --by-ref` —
  NO `query --with-refs` and NO `eval`/`querySelectorAll` detour to rediscover a
  selector:

  ```sh
  npx webhands snapshot                       # ... button "Search" [ref=e7] ...
  npx webhands click e7 --by-ref              # acts on exactly that element
  npx webhands type  e4 'flights to BOM' --by-ref
  ```

  A snapshot ref is SNAPSHOT-SCOPED: it is an "act on what I just saw" handle,
  re-keyed every `snapshot`, so it goes stale after a DOM change or a fresh
  snapshot (you get a loud `stale-ref` error, never a wrong-element click — just
  re-`snapshot` for fresh refs). For a ref that SURVIVES list mutation between
  read and act, use `query --with-refs` instead (below). Both use the same
  `--by-ref` flag and the same fail-loud safety; they differ only in durability.
- Pipe a snapshot through `grep`/filters to pull just the lines you care about
  (prices, airlines, headings) instead of dumping the whole tree into context.
- For structured extraction, `eval` a small JS expression and return a plain
  array/object (use `--format json`). Keep selectors LOOSE — site DOM/class names
  change constantly; match on text patterns (regex on `textContent`) rather than
  brittle CSS classes. Expect to iterate the selector once or twice.

## Batch a sub-flow with one `script` (when you already know the flow)

Composing one verb per invocation is the safe default, but each invocation is a
fresh model turn. When you ALREADY know a multi-step sub-flow (e.g. fill a form,
submit, read the result), `script` runs it in ONE call against the SAME served
page, the way a Playwright user writes a script by hand:

```sh
# Write the flow to a JS file: the source is JS that evaluates to a function of
# the live page, e.g. flow.js:
#   async (page) => { await page.fill('#user', 'me'); await page.click('#login'); return await page.locator('.inventory_list').count(); }
# then point the verb at that FILE PATH (the one and only source):
npx webhands script ./flow.js --format json
```

The file must END with an EXPRESSION that IS the function. Top-level statements
BEFORE it are fine, so the natural module-style layout works:

```js
const SEAT = 'window';

async (page) => {
  await page.click(`input[value="${SEAT}"]`);
  return await page.title();
};
```

A trailing semicolon is fine, and so is a leading `export default`. What does NOT
work is a real ESM `import` (hoist the value into a top-level `const` instead) or
`module.exports = ...`: the file is loaded as a source that evaluates to a
function, not as a module. If it cannot, the error states that constraint and
shows a correct example.

The source is a FILE PATH: `script` takes a path to a JS file, reads it, and runs
it (there is no inline-string, no `--file` flag, and no stdin form). The script
gets the FULL Playwright `page` (real locators + actions +
auto-waiting), NOT a page-world `eval` expression. RETURN a SERIALIZABLE value (a
count, a string, a small object) — never a live locator/handle (it cannot cross
back). A thrown script comes back as a clean structured error. This is the SAME
code-execution surface as `eval` (caller JS on your own session, loopback-only),
not a new privilege and not hand loading. Use it to collapse a known sub-flow into
one turn; keep using the discrete verbs (and the cheap `snapshot`) when you are
still exploring the page.

## Handling sensitive info (passwords, tokens)

When a value you must `type` is a CREDENTIAL the operator supplied via the
environment (a password, an API token), do NOT type the literal. Type an
`{ENV:NAME}` placeholder and webhands substitutes the real value from its own
process environment at type-time:

```sh
npx webhands type '#pass' '{ENV:PASSWORD}'
```

Here `PASSWORD` is an environment variable the operator set (exported in the
shell, or put in a gitignored `.env.local` that webhands loads at `serve`
startup). You never need to READ the secret: type the placeholder and the real
value reaches the page while the literal stays out of your tool-call. An
unset/empty variable fails LOUD (never a silent empty type), so a missing value
is obvious rather than a quietly-empty field. Prefer the placeholder over a
literal for any credential; ordinary (non-secret) values are typed as-is.

This is HYGIENE, not a security wall: the value still lands in the page and is
readable back, and you already run on the operator's machine. The point is
simply not to write a literal credential into your tool-call when a placeholder
works identically.

## Pacing XHR-rendered results

Results often arrive after navigation via background requests. If a snapshot is
empty or sparse, the page is still loading — `webhands wait --ms 6000-9000` (or
`wait --navigation`) before snapshotting. This is normal, not a failure.

## The anti-bot wall: what actually works (measured)

Anti-bot sites fingerprint automated browsers. A headless `goto` can land on a
bot-block page instead of results, and the snapshot usually says so plainly.

**Read the symptom carefully, because it lies.** Against a serious bot manager the
static, edge-cached top page renders FINE while every DYNAMIC endpoint returns a
bare "Access Denied". So "the page loaded" is not evidence you are through; check
an endpoint that does real work.

The escalation ladder, cheapest first:

1. **Headed plus a human in the loop.** `webhands stop`, restart with
   `webhands serve --headed`, `goto`, and let the human accept cookies / clear the
   challenge in the visible window. Tell them what you need, WAIT for their
   go-ahead, then `snapshot`. (Equivalently do it once via `setup-profile`, so the
   clearance persists.)
2. **Drive their real Chrome: `webhands serve --real-chrome`.** This is the one that
   beat Akamai on an authenticated booking site, where a Playwright-launched browser
   was blocked in EVERY configuration, `--stealth` and
   `--stealth --use-system-browser chrome` included. It starts the user's own Chrome
   with a debugging port on the dedicated profile and attaches, in one command,
   visible so the human can log in and take over. Equivalent by hand:
   `google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/scratch` then
   `webhands serve --endpoint http://127.0.0.1:9222`.
3. **If you get blocked MID-session, clear the verdict cookies** (see the recovery
   section below) rather than restarting everything.

Do NOT reach for `--stealth` as the anti-bot answer: it removes ONE tell (the CDP
`Runtime.enable` leak) and was not sufficient against a real bot manager. And do not
read `--real-chrome` as a cloak: Chrome reports `navigator.webdriver = true` whenever
a debugging port is on, in that mode too. It wins on everything else about being a
real browser (no launch-hardening flags, a warm profile, a real window, the human's
own IP).

webhands ships NO captcha solver and NO provider key, and it does not bypass
logins. For an ordinary anti-bot wall the simplest path is the human-in-the-loop
above: the human clears it once, you drive afterwards. But the verb surface no
longer STANDS IN THE WAY if YOU bring your own captcha-provider key: a capable
agent can get past a captcha with verbs alone, either family. Token-harvest: read
the sitekey with a frame-aware `query`
(`query "frameLocator('#main-iframe').locator('.h-captcha')" --attr data-sitekey`),
get a token from your provider, `type` it into the response sink through the same
frame hop, then fire the callback with `eval`. Vision/tile: `screenshot --scope
element --locator <widget>` to see the grid, then `mouse --action click --x <n>
--y <n>` at VIEWPORT coordinates (the viewport screenshot pixel maps directly to
the `mouse` coordinate). webhands is capable, not a solver: you supply the key and
the logic. For the EASY path, a third-party hand (`iamhuman`) makes it one call
instead of several verb turns.

## Guardrails (READ — this is a personal-use tool)

- **It acts as the real, logged-in user.** Treat every action as the human doing
  it themselves with their identity, session, and IP.
- **Read freely; never transact without explicit, confirmed intent.** Navigating
  and snapshotting is low-risk. Anything that spends money, books, posts, sends,
  deletes, or changes account state must be the human's clearly-confirmed
  decision. For purchases/bookings, surface the option and the deep link and let
  the HUMAN complete checkout — do not click "Pay"/"Book" on their behalf.
- **Third-party ToS.** Driving sites like Kayak/Skyscanner is generally against
  their Terms of Service even from a real session. Only do so against the user's
  OWN session on their OWN machine/IP, for personal use, and respect the site's
  ToS. These sites are smoke TARGETS that prove the pipe, not endorsed scrape
  sources.
- **`serve` is a code-execution surface.** `eval`, `script` (a driver-context
  function handed the live page), and the raw Playwright locator in `click`/`type`
  run caller-supplied code in the logged-in page. Keep the endpoint on localhost
  (the default); never expose it or hand its URL to untrusted code; always `stop`
  when done.
- **`cookies` moves a live session.** Export/import only to back up or relocate
  the user's own session; never exfiltrate it.

## Verb reference

This is the FULL verb surface; drive directly from it. You do NOT need
`--help`/`--llms-full` at runtime. Every verb takes the connection flags
(`--profile <name>`, or `--endpoint <url>` for an attached browser) and emits a
structured envelope; add `--format json` for machine output. The default output
is LEAN (no "Suggested command" hints); a human exploring can re-enable the
next-step breadcrumbs with `--cta` (alias `--hints`), or pin them with
`WEBHANDS_CTA=1`.

**Locator grammar (read this once).** Verbs that take a LOCATOR want a raw
Playwright locator EXPRESSION as a string, and it MUST be prefixed with `page.`
(e.g. a `page.`-prefixed `locator(...)` / role / test-id / text query). A BARE
locator throws ("not defined", or a bare `#id` parses as a JS private field), so
always write the `page.`-prefixed form. Frame scope rides INSIDE the locator
string (a `page.`-prefixed frame-locator hop), except `eval` which takes a
separate `--frame <css>` flag.

Lifecycle + mode:

- `setup-profile [--profile <name>] [--stealth] [--use-system-browser <ch>] [--proxy <socks-url>] [--no-viewport]`
  — one-time HEADED login / challenge-clear; HOLDS the window open until you close
  it, then persists the profile state. It takes the SAME browser-selection flags as
  `serve`, and you should pass the same ones: the profile dir is written by that
  specific browser build, so setting it up with bundled Chromium and then driving
  it with `--use-system-browser chrome` is a mismatch.
- `serve [--headed] [--profile <name>] [--endpoint <url>] [--real-chrome] [--keep-browser] [--stealth] [--use-system-browser <ch>] [--proxy <socks-url>] [--no-viewport] [--expose-cdp]`
  — start & HOLD the one browser (headless default). The session it holds is what
  every later verb drives. Blocks; background it (see above).
  - `--real-chrome` spawns the USER'S own Chrome with a debugging port on the
    dedicated profile and attaches to it (visible window). Reach for this when a
    site blocks you; it is what worked against Akamai. `--keep-browser` leaves that
    browser running after `stop` (the next `--real-chrome` serve re-attaches).
    `--proxy <socks-url>` DOES work in this mode (it is the only way to change the
    exit IP there), but WITHOUT credentials: Chrome supports no SOCKS5 auth, so a
    `user:pass@` URL is refused rather than silently sent unauthenticated. Use a
    credential-free local relay (`ssh -D 1080`) and point `--proxy` at that. It also
    needs a working Chrome sandbox, so in a container or CI it aborts at startup
    unless the operator sets `WEBHANDS_CHROME_ARGS=--no-sandbox`; the error says so
    and quotes Chrome's own stderr.
  - `--expose-cdp` opens a remote-debugging port on a LAUNCHED browser so a separate
    Playwright client can drive the SAME page; OFF by default and you almost never
    want it (it is an automation tell, and counter-productive with `--stealth`).
- `attach --endpoint <url>` — alternative to a `serve`-launch: connect to a
  Chromium the USER already started with remote debugging, reusing live tabs
  (Chromium-only).
- `stop` — tear the session down (always do this when finished, unless told to
  leave it open).

Navigate + pace + read:

- `goto <url>` — navigate the live page to a URL and let it settle.
- `wait (--ms <n> | --locator <loc> | --navigation)` — pace XHR / settle (exactly
  one form).
- `snapshot [--full] [--token-limit <n>]` — token-cheap accessibility-tree + text
  view (your default for "what is on the page"); `--full` for raw DOM.
- `eval <expr> [--frame <css>]` — run a page-world JS EXPRESSION, return its
  serializable result. `--frame` evaluates inside a same-origin child frame.
- `script <path>` — run a DRIVER-CONTEXT function of the FULL live Playwright
  `page` to batch a whole locate/act/wait/read sub-flow in ONE call; return a
  serializable value. The source is a PATH to a JS file (read and run); e.g.
  `npx webhands script ./flow.js`.

Act:

- `click <locator> [--by-ref]` — click the element a `page.`-prefixed locator
  addresses. With `--by-ref` the argument is a REF instead: a `snapshot` `[ref=eN]`
  (pass the bare `eN` / `aria-ref=eN`, a snapshot-scoped "act on what I just saw"
  handle) OR a durable `ref` from `query --with-refs` (survives list mutation).
  Either way a ref that no longer matches exactly one element fails LOUD
  (`stale-ref`), never a silent wrong-element click.
- `type <locator> <text> [--by-ref]` — type text into the addressed input; same
  `--by-ref` ref forms as `click` (snapshot `[ref=eN]` or durable `query` ref).
- `press <key> [--locator <loc>]` — press a key/chord (e.g. Enter, Control+A) at a
  locator or, with none, the focused element.
- `hover <locator>` — hover to reveal on-hover menus/controls.
- `select <locator> (--value <v> | --label <l>)` — choose an option in a native
  `<select>` (exactly one of value/label).
- `scroll (--to <locator> | --by <dx,dy>)` — scroll a locator into view or by a
  pixel delta (exactly one).
- `drag <source> <target>` — drag one locator's element onto another's.
- `mouse --x <n> --y <n> [--action click|move|down|up] [--button left|right|middle]`
  — coordinate mouse input at VIEWPORT CSS-pixels (a viewport-screenshot pixel
  maps directly to these coordinates).

The five element-acting verbs (`click`, `type`, `press`, `hover`, `select`) plus
`drag` take `--timeout <ms>`, which changes only how long you WAIT, never what is
performed. All of those except `drag` also take `--dom`. `goto`, `scroll` and
`mouse` take neither.

**`--dom`: the hidden-control escape.** Real sites hide radios and checkboxes
behind styled labels. Playwright correctly refuses to act on what a human could not
reach, so the verb waits out its timeout even though the control works. `--dom`
skips the actionability check and fires the event directly:

```sh
# A radio hidden behind its label (opacity:0, or display:none):
npx webhands click "page.locator('#seat-window')" --dom
```

For `click` you usually do not even need it: `click` already falls back to a
dispatched event automatically, and REPORTS which path it took as `via` in its
output (`"click"` = a real actionability-checked click, `"dispatch"` = the element
did not become actionable and an event was fired at it instead). Passing `--dom`
explicitly just skips the wait when you already know.

**`click` waits only about 1 second** for actionability before dispatching (the
other verbs keep Playwright's 30s). So if you are clicking something that becomes
ready after a request (a late-hydrated row, a button enabled by an XHR), `wait`
first or pass `--timeout 10000`; otherwise you get `via: "dispatch"` at a
not-yet-ready element and an `ok: true` that did nothing useful.

**Read the `via` field, and read it correctly.** `"dispatch"` means the element was
not actionable within the budget. That covers a genuinely hidden control AND one
that was merely slow or briefly covered, so it is not proof of a honeypot: it is a
prompt to VERIFY the effect (snapshot, or read the control's state) rather than
trusting `ok: true`. It does mean a real user could not have clicked it at that
moment, and invisible controls are sometimes anti-bot honeypots, so never treat a
`dispatch` on a form field as routine.

The escape is per-verb faithful to different degrees, so know what you are firing:
`click` dispatches a real click event (and still toggles a radio/checkbox); `select`
sets the value and fires `change`; `type` sets the value and fires `input`/`change`,
so there are NO keystrokes (a masked input or a keydown-driven autocomplete may
behave differently); `press` fires `keydown`/`keypress`/`keyup` (handlers run, but no
text is inserted); `hover` fires the pointer/mouse enter events (no pointer
POSITION, so CSS `:hover` does not react). `drag` has NO `--dom` on purpose: a
synthetic drag needs a `DataTransfer` that real drop targets often ignore, so it
would fail quietly more often than it worked.

Keep it opt-in. If a verb fails on a visible element, the answer is `wait` or a
better locator, not `--dom`.

Read structured data:

- `query <locator> [--attr <a>]… [--prop <p>]… [--pw visible|bbox]… [--limit <n>] [--with-refs]`
  — one row per match carrying the requested DOM attributes / live JS properties /
  Playwright extras. `--with-refs` also mints a durable `ref` per row for
  `click`/`type --by-ref`. The list flags are REPEATABLE (not comma-joined).
- `count <locator>` — how many elements match.
- `exists <locator>` — whether any element matches.
- `is-visible <locator>` — whether the first match is actionability-grade visible.
- `get-attribute <locator> --name <attr>` — read one DOM attribute off the first
  match (null if absent).

Capture + session:

- `screenshot [--scope viewport|full|element] [--locator <loc>] [--out <path>]` —
  capture a PNG to a FILE and return its PATH (never bytes); `--scope element`
  needs `--locator`.
- `cookies export <file>` / `cookies import <file>` — move/back up/seed the active
  session cookies.
- `cookies clear [--name <n>]… [--domain <d>] [--path <p>] [--all]` — remove a
  NAMED SUBSET of the session cookies and report how many went. `--name` is
  REPEATABLE; every given field must match. A bare `cookies clear` is REFUSED (it
  is never read as "all"); `--all` clears everything and logs the session out.

## Recovering from a mid-session bot block

A WAF can flip from serving you to blocking you PART WAY THROUGH a session, after
enough fast automated navigation (one observed trip: ~15 rapid flows in 40
minutes). The tell is specific and easy to misread: the static, edge-cached top
page still renders fine, while every DYNAMIC endpoint returns a bare "Access
Denied" page, including ones that worked seconds earlier. So "the site loaded"
is NOT evidence you are unblocked; check an endpoint that actually does work.

The verdict is stored in COOKIES, so it survives a reload and keeps 403-ing until
those cookies are gone. Clearing just them restored access immediately in the one
session this was measured on (Akamai in front of an ASP.NET app), where the login
lived in entirely different cookies and survived. Treat that as the common shape,
NOT a guarantee: some sites bind the session to the WAF cookie, and then this logs
the human out. If losing the login would be expensive, `cookies export` to a path
the human names first, so you can `cookies import` it back.

```sh
# Akamai keeps its verdict in these four; other WAFs use their own names.
npx webhands cookies clear --name _abck --name bm_sz --name bm_sv --name ak_bmsc
```

`cleared: 0` means nothing matched, so check the names. `cookies export` would show
them, but it writes the human's FULL session including auth cookies to disk in
plaintext: do not dump that into a shared temp dir as a casual diagnostic. If you
need it, write it to a path the human names and delete it immediately after.

Then SLOW DOWN: pace with `wait` between flows rather than firing verbs
back-to-back. Do NOT clear everything (`--all`) as a reflex: that logs the human out
for no reason.

**Clear ONCE.** This is not evading a protection: you are clearing cookies in the
human's own browser, exactly as they could from Chrome's own UI, so the WAF
re-evaluates the real logged-in user. It STOPS being that if you loop it. If the
block returns after a clear, stop, tell the human what happened, and let them
decide. Repeatedly wiping the verdict to keep automating is the evasion this tool
does not do (`docs/adr/0002`, `docs/adr/0016`).

## Minimal worked example (headed, reading live prices)

```sh
# 1. hold the session (headed so a human can clear any wall)
nohup npx webhands serve --headed > /tmp/webhands-serve.log 2>&1 &
sleep 12 && cat /tmp/webhands-serve.log        # confirm endpoint + pid

# 2. navigate; human clears cookies/challenge in the visible window
npx webhands goto 'https://www.kayak.co.uk/flights/EDI-BOM/2026-10-31?sort=price_a&fs=stops=~1'

# 3. let XHR results render, then read just the price/airline lines
npx webhands wait --ms 8000
npx webhands snapshot --token-limit 6000 | grep -iE 'url:|£[0-9]|stop|[0-9]+h [0-9]+m|Lufthansa|KLM|SWISS|Qatar|Emirates|British'

# 4. (optional) structured extract with loose, text-based selectors
npx webhands eval '[...document.querySelectorAll("div")].filter(d=>/\d\d:\d\d/.test(d.textContent)&&/£\d/.test(d.textContent)&&d.textContent.length<400).slice(0,12).map(d=>d.textContent.replace(/\s+/g," ").trim())' --format json

# 5. always tear down
npx webhands stop
```
