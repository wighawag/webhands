---
'webhands': minor
'@webhands/core': minor
---

**An explicit `--dom` escape for controls hidden behind styled labels, `--timeout` on the acting verbs, and `click` now reports HOW it clicked.**

Real sites hide radios and checkboxes behind styled labels constantly. Playwright is right to refuse to act on what a human could not reach, so the verb waits out its timeout even though the control is functional. `click` already had a fallback; the problem was everything around it.

- `--dom` on `click`, `type`, `press`, `hover` and `select` skips the actionability check and fires the event directly. Each verb documents exactly what it fires and how faithful that is: `click` dispatches a real click event (which still toggles a radio), `select` sets the value and fires `change`, `type` sets the value and fires `input`/`change` (no keystrokes, so masked inputs may differ), `press` fires `keydown`/`keypress`/`keyup` (handlers run, no text inserted), `hover` fires the pointer-enter events (no pointer position, so CSS `:hover` does not react). `drag` deliberately has NO `--dom`: a synthetic drag needs a `DataTransfer` that real drop targets often ignore, so it would fail quietly more often than it worked.
- It stays OPT-IN and the sibling defaults are unchanged (real auto-wait, fail-loud), because an invisible control a human cannot reach is sometimes a honeypot, and because the siblings' synthetic forms are approximations of a different action rather than "the same action without the check".
- `--timeout <ms>` on the acting verbs bounds the actionability wait. It changes how long you WAIT, never what is performed. Measured motivation: on a hidden element, `type`, `select` and `hover` each burned Playwright's full 30s default with no escape and no way to shorten it.
- `click` returns (and the CLI reports) `via: "click" | "dispatch"`, so the fallback is no longer silent: an agent can tell a real actionability-checked click from an event dispatched at something a user could not have clicked.

**Also fixes a latent bug in the existing fallback.** It called `dispatchEvent('click', {timeout})`, but Playwright's signature is `dispatchEvent(type, eventInit?, options?)`, so the bound was passed as an event FIELD and the 30s default silently applied. A locator matching nothing hung for 30.4s in the dispatch while the code comment above it promised fast failure. The bound now goes in the options argument, with a test pinning the failure under 10s so the 30s regression cannot return.

Note the resulting asymmetry, which is documented in the `--timeout` help and the skill: `click`'s default actionability budget is about 1s (short, so its fallback is reachable), while the other verbs keep Playwright's 30s. Pass `--timeout` when clicking something that becomes ready after a request.

`ActionOptions` gains `dom` and `timeoutMs`, carried over the session RPC in both directions. `WebHandsPage.click` returns `ClickResult` instead of `void`: **additive for callers** (an ignored return value), but **breaking for anyone IMPLEMENTING** `WebHandsPage`/`Transport` outside this repo, and for a `Hand` that wraps `click`, since the method must now return a result. New exports: `ClickResult`, `ClickVia`. The decision and its reasoning are recorded in `docs/adr/0015`.
