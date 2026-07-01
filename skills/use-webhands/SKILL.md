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

## The anti-bot wall and the headed fallback (learned the hard way)

Anti-bot sites (Kayak being the canonical example) fingerprint headless browsers.
A headless `goto` can land on a bot-block page (e.g. Kayak's "we think you are a
bot" page) instead of results — the snapshot will say so plainly.

When that happens, the fix is NOT a trick — it is to put a human in the loop:

1. `webhands stop`, then restart with `webhands serve --headed` so the window is
   visible.
2. `webhands goto <url>` — the human accepts cookies / clears the challenge in the
   visible window. (Equivalently, do this once via `setup-profile`; clearance then
   persists for later headless runs.)
3. Tell the human what you need cleared, WAIT for their go-ahead, then `snapshot`.

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

- `setup-profile [--profile <name>]` — one-time HEADED login / challenge-clear;
  HOLDS the window open until you close it, then persists the profile state.
- `serve [--headed] [--profile <name>] [--endpoint <url>] [--stealth] [--use-system-browser <ch>] [--proxy <socks-url>] [--no-viewport]`
  — start & HOLD the one browser (headless default). The session it holds is what
  every later verb drives. Blocks; background it (see above).
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
