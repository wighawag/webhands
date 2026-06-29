---
name: use-webhands
description: >-
  Drive a real, logged-in browser with the `webhands` CLI to read and act on web
  apps the human already has a session for. Use when a task needs live, rendered,
  or authenticated web content that plain HTTP fetch/search cannot get: prices and
  results behind XHR/JS, pages behind a login, or a multi-step flow on a site the
  user is signed into. This skill is the WORKFLOW + JUDGMENT layer; the
  auto-generated `webhands-*` skills (one per verb) are the per-flag reference.
---

# use-webhands

`webhands` owns ONE long-lived browser (a `serve` process) bound to a dedicated
profile; every other verb (`goto`, `snapshot`, `click`, `type`, `eval`, `script`,
`wait`, `cookies`) is a thin client that drives that SAME live page and exits. You
compose verbs across separate invocations.

This skill exists because the generated per-verb skills tell you each command's
flags but not how to RUN the pipe end to end, where it breaks, and what you must
NOT do. Read this first; reach for `webhands <verb> --help` (or the
`webhands-<verb>` skill) for exact flags.

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
# Inline: the source is JS that evaluates to a function of the live page.
npx webhands script "async (page) => { await page.fill('#user', 'me'); await page.click('#login'); return await page.locator('.inventory_list').count(); }" --format json

# The common case: write a flow file and point the verb at it.
npx webhands script --file ./flow.js --format json   # (or pipe JS on stdin)
```

The script gets the FULL Playwright `page` (real locators + actions +
auto-waiting), NOT a page-world `eval` expression. RETURN a SERIALIZABLE value (a
count, a string, a small object) — never a live locator/handle (it cannot cross
back). A thrown script comes back as a clean structured error. This is the SAME
code-execution surface as `eval` (caller JS on your own session, loopback-only),
not a new privilege and not hand loading. Use it to collapse a known sub-flow into
one turn; keep using the discrete verbs (and the cheap `snapshot`) when you are
still exploring the page.

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

## Quick reference

| Verb | Use for |
|---|---|
| `setup-profile` | one-time HEADED login / challenge-clear; persists state |
| `serve` | start & HOLD the one browser (headless default, `--headed` to show) |
| `goto <url>` | navigate the live page |
| `wait --ms N` / `--navigation` / `--locator` | pace XHR / settle |
| `snapshot` | token-cheap a11y+text view (`--token-limit`, `--full`) |
| `eval '<expr>'` | run JS, return serializable result (`--format json`) |
| `script '<js>'` / `--file <path>` | batch a sub-flow: run a driver-context Playwright function on the live page, return a serializable result |
| `click <locator>` / `type <locator>` | act via a raw Playwright locator |
| `cookies` | export/import the active session |
| `stop` | tear the session down (always do this) |

`attach` is the alternative to `launch`/`serve`-launch: connect to a Chromium the
USER already started with remote debugging, reusing live tabs (Chromium-only).

Per-flag detail: `webhands <verb> --help`, `webhands --llms-full`, or the
generated `webhands-<verb>` skills.

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
