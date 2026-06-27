# @webhands/core

## 0.1.0

### Minor Changes

- e458727: First release: a CLI (and MCP server) that drives a real, persistent browser via Playwright, letting an agent or human control any website from a genuinely logged-in browser session.

## 1.0.0

### Major Changes

- 9de25a8: BREAKING: rename the verb-level transport seam type `Page` to `WebHandsPage`
  (ADR-0008). The exported `Page` type is gone; import `WebHandsPage` instead.
  This is a NAME-ONLY change: the eight verbs
  (`navigate`/`snapshot`/`click`/`type`/`eval`/`wait`/`cookies`/`setCookies`), the
  branded-locator-string addressing, the session RPC wire shape, the hand contract
  semantics, and the trust model are all byte-for-byte unchanged.

  The seam type's old name collided with Playwright's own `Page`, which forced
  three modules (the hand host and both Playwright transports) to import
  Playwright's page as `type Page as PwPage` purely to dodge the clash, and made
  `HandContribution.verbs: Partial<Page>` read as a partial of Playwright's huge
  `Page` rather than a subset of webhands' eight seam verbs. With the seam type
  renamed, those `PwPage` aliases are dropped (Playwright's `Page` is imported
  directly) and the seam meaning is unambiguous.

### Minor Changes

- 656909e: Surface a hand-contributed verb to the AGENT over the long-lived session RPC
  (Phase 2, Model B of the "hands" prd; ADR-0007). A dynamically-loaded hand's
  verb is now invokable over the wire, so the agent gains a new tool WITHOUT ever
  holding a live page handle: the served process runs the hand against its own
  live page and returns a serializable result.

  The eight built-in verbs stay a CLOSED `SessionRpcRequest` union (now named
  `SessionRpcBuiltInRequest`), the single 1:1 source of truth for the built-in
  surface. A hand verb \u2014 whose name `core` does not know at compile time \u2014 crosses
  as one generic `SessionRpcHandRequest` variant (`{verb: 'hand', name, args}`)
  that names the contributed verb at runtime, the exact wire parallel of how a
  hand verb composes into the page object. `applySessionRpc` dispatches it to the
  named verb on the composed page; `callHandVerb` is the client mirror, and
  `connectRemoteSession(url, handVerbs)` attaches the loaded hand verbs to the
  remote page as dynamic methods.

  The serializable-only boundary (prd's resolved Q3) is enforced by convention +
  types, NOT a blanket runtime clone (which would corrupt legitimate in-process
  Model A returns); a host-side runtime clone of agent-verb results is noted as
  available future hardening for untrusted hands. A page/in-hand throw rejects
  faithfully on the client, exactly as the `eval` RPC path does. The in-process
  Model A path is unaffected.

- c3bae5b: Open the hand-host to THIRD-PARTY hands (Phase 2). The `Hand`, `HandContext`,
  and `HandContribution` types are now PUBLIC (exported from the package entry
  point) as the stable third-party authoring contract: a hand receives
  `{pwPage, context, ensureOpen}` and contributes named verbs plus an optional
  `dispose`. A new explicit, declarative loading mechanism (modeled on pi's
  `packages[]`) loads a third-party hand ONLY when it is NAMED in
  `<home>/hands.json` with a PINNED entry point (`readHandsConfig` / `loadHands` /
  `HandsConfig` / `HandEntry` / `HandLoadError`); there is no auto-discovery, no
  `node_modules` scan, and no convention-inferred entry, and install is separate
  from load (naming a hand is the trust act, an installed-but-not-named hand never
  loads). Both Playwright transports now accept the loaded hands and compose them
  into the session `Page` through the same host the built-ins use, so a
  third-party hand's verbs compose alongside the built-in verbs. Adds ADR-0007
  recording the public-contract decision, the explicit-declarative loading model,
  and the "loading a hand == trusting an in-process npm dependency" trust framing.

### Patch Changes

- 6d57871: Internal: introduce a package-private hand-host primitive and refactor the eight
  built-in verbs (`navigate`, `snapshot`, `click`, `type`, `eval`, `wait`,
  `cookies`, `setCookies`) into built-in hands composed over it. Both the launch
  and attach transports now share this single verb composition instead of each
  carrying a near-identical page-object literal; each transport keeps its own
  session lifecycle (launch kills the spawned browser, attach detaches without
  killing the user's browser). No public API change and no behavior change (the
  existing verb test suite passes unmodified); the `Hand`/`HandContext` types stay
  package-internal until Phase 2.
- fcb1dda: Docs: add ADR-0006 recording the Phase-1 decision to refactor webhands' verbs
  onto an INTERNAL hand-host primitive (behavior-preserving, no public-seam
  change; `Hand`/`HandContext` package-internal until Phase 2; hands are trusted,
  local, in-process peers with zero isolation), which refines ADR-0003/0004
  rather than contradicting them (the live Playwright page stays in-process and
  never crosses the seam). The public hand contract is called out as a separate
  Phase-2 decision. Also pins `hand` in `CONTEXT.md` as a third axis orthogonal
  to `transport` and `verb`, with the "not a verb / not a transport" guards.

## 0.1.0

### Minor Changes

- a70fb1f: Keep a single browser session alive ACROSS separate CLI invocations via a long-lived `serve` process (ADR-0005).

  A new `core` `SessionServer` (`startSessionServer`) opens the ONE live session up front through any seam `Transport` (the browser launches once, never per verb) and serves that already-live page over a small session-RPC (`/session/call`); each `webhands <verb>` becomes a THIN CLIENT (`connectRemoteSession`) that forwards verbs to the running server and drives the SAME live page, so navigation/DOM state persists between separate processes (the on-disk profile alone does not carry it). Discovery is an endpoint file (`session-endpoint.json`) written under the controller home root and read by clients; teardown is explicit. Lifecycle is EXPLICIT (ADR-0005): new `serve` / `stop` CLI commands bring the single session up/down, a verb with NO live server raises the typed `NoLiveServerError` (`no-live-server`) which the CLI maps to "run `serve` first" and exits non-zero (it never auto-spawns), and a second open while one is live is a typed `SessionAlreadyActiveError` (`session-already-active`) mapped to "run `stop`". The default CLI `SessionProvider` is now that thin client (discover the endpoint, return the remote proxy whose `close()` is a NO-OP so a client cannot tear down the shared session); the v1 Playwright launch/attach transports are launched only by `serve`. The session-RPC request/response shape is one shared module (`session-rpc.ts`) imported by both server and client so they cannot drift, and no Playwright/CDP type crosses the seam (ADR-0003). Tests prove persistence at the seam against the LOCAL FIXTURE PAGE — one served process spans two separate client connections and the second observes live state (a navigation + an in-page mutation) set by the first — plus browser-free coverage of endpoint discovery, the served RPC round-trip over the `StubTransport`, the no-op client close, and the single-session refusal; all on-disk state (endpoint file, profile) is isolated to a temp root and the real `~/.webhands` is asserted untouched.

- d2daed4: Add the `attach` transport (`PlaywrightAttachTransport`): connect to a browser the user already started with remote debugging, reusing their live authenticated context.

  `PlaywrightAttachTransport` implements the `core` `Driver`/`Transport` seam via `chromium.connectOverCDP(endpoint)`, reusing the existing authenticated context (`browser.contexts()[0]`) — never `newContext()` — so the controller drives the user's live, logged-in tabs on their real fingerprint and IP (ADR-0002). It is Chromium-only and surfaces that constraint as a typed `core` error (`AttachNotChromiumError`, code `attach-not-chromium`) without leaking any CDP/Chromium-only type across the seam (ADR-0003); a browser exposing no context to reuse surfaces as `AttachNoContextError`. There is no browser-relaunch helper — the user supplies the running endpoint (settled PRD decision). Closing the attached session detaches without killing the user's browser. Tests start a real local Chromium with a remote-debugging port, attach, and assert the existing context is reused (a cookie seeded before attach is visible through the seam) and that verbs drive the local fixture page.

- 4660aa9: Add the v1 Playwright launch transport with a dedicated persistent profile.

  `PlaywrightLaunchTransport` implements the `core` `Driver`/`Transport` seam using Playwright `launchPersistentContext` against a dedicated profile dir the controller owns under a config location (`~/.webhands/profiles/<name>`, overridable via the `WEBHANDS_HOME` env var or a constructor `root`). It never targets the OS default Chrome profile (ADR-0002) and leaks no Playwright/CDP types across the seam (ADR-0003). Both headed and headless launch are selectable; profile state (cookies, storage) persists across relaunches. A missing browser binary and a not-yet-set-up profile surface as typed, identifiable `core` errors (`MissingBrowserBinaryError` / `MissingProfileError`, branded via `isControllerError` and a stable `code`) so the CLI can render the exact fix command. Tests drive a real local Chromium against the local fixture page with the profile root isolated to a temp dir.

- ad83d03: Scaffold the pnpm monorepo with `core` and `cli` packages and the verb-level `Driver`/`Transport` seam.

  `core` exports a transport-neutral seam (`Transport`/`Driver`, `Session`, `Page`) expressed in verbs (navigate, snapshot, click, type, eval, wait, cookies) with element addressing as a raw Playwright locator string (ADR-0003/0004), a `StubTransport` that round-trips the seam, and a local fixture HTTP server for later deterministic verb tests. `cli` anchors the `incur`-wrapper boundary (wired in a later task).

- 67dd468: Add the headed one-time-login `setup-profile` flow (`setupProfile`).

  `setupProfile` opens a dedicated profile in a VISIBLE (headed) browser so a human logs in / clears any anti-bot challenge ONCE, then the saved cookies/state persist in the profile dir for a later `launch --headless` against the same profile to reuse without re-login (PRD User Story 1; ADR-0002). It is orchestration over the existing `PlaywrightLaunchTransport`, not a second transport: it CREATES the dedicated profile dir (the one place a profile dir is created — the launch transport deliberately refuses a missing one with `MissingProfileError` so `setup-profile` owns creation), opens it headed through the launch transport, and emits a clear, actionable prompt naming the profile + its dir and telling the user to log in / clear the challenge and then close the window. The verb only OPENS the window; it never types or stores a credential (the human does the one-time login, we never bypass it or solve CAPTCHAs). The caller holds the returned live `Session` open for the interactive login and closes it when done, flushing state to the profile dir. The prompt sink and transport are injectable (prompt defaults to STDERR, transport to a launch transport bound to the resolved location) so the mechanics are testable. Tests drive a real local headed Chromium against the local fixture page with the profile root isolated to a temp dir: they assert the dir is created and opened headed, the prompt content, that state written during the headed session is visible to a SUBSEQUENT HEADLESS launch against the same profile, idempotent re-runs, and that the real `~/.webhands` is left untouched — never a third-party login.

- c2e9c0f: Implement and fully test the `click` and `type` verbs at the `core` Driver seam.

  `click` and `type` address elements by a RAW Playwright locator string (e.g. `getByRole('button', { name: 'Search' })`) resolved by the active transport (ADR-0004), not a reduced selector subset and not a structured JSON locator; the seam's public types stay CDP/Chromium-free (ADR-0003). `click` first tries a normal, actionability-checked `Locator.click()` (the right behaviour for a real button) and, on a Playwright `TimeoutError`, falls back to `dispatchEvent('click')` — the documented escape for a HIDDEN custom input where a normal click would never become actionable and would otherwise time out (PRD story 8). The normal click uses a short bound (1s) so the hidden path does not burn Playwright's 30s default, and the dispatch fallback is bounded by the same value so a locator that resolves NO element fails fast instead of hanging. A hidden custom input is addressable only via a locator that does not depend on the accessibility tree (a CSS/id locator), since a `display:none` element is excluded from the a11y tree that `getByRole`/`getByLabel` query. The locator resolution and the click verb are shared by both Playwright transports (launch + attach) through one `resolveLocator`/`clickLocator` path (mirroring `waitFor`), so there is no parallel addressing scheme. A new deterministic `click-type.html` fixture (a visible button, a text input, and a `display:none` custom control that records when its handler fires) drives the tests; tests run a real local Chromium against the local fixture page and assert each verb's effect at the `core` Driver seam — the visible button's handler runs, the hidden control toggles only via the dispatch path, and `type` fills (and re-fills) the addressed input — never on third-party DOM (PRD "Testing Decisions").

- 5be5624: Implement and test the `cookies export` / `cookies import` verb at the `core` Driver seam (PRD story 11).

  The export/import verb is built ON TOP of the seam's existing transport-neutral cookie primitives — `Page.cookies()` (export source) and `Page.setCookies()` (import sink) — rather than a parallel cookie path: `export` reads the active context's cookies in structured form, `import` loads cookies into the active context, and no CDP/Chromium-only type crosses the seam (ADR-0003). What this task adds is the verb's FILE FORMAT: `serializeCookies`/`deserializeCookies` (a self-describing, versioned JSON envelope `{version, cookies}` of the seam's own `Cookie` type), shared by the CLI verb and the round-trip test as one source of truth so a backed-up session and what import reads back cannot drift; a wrong-version or non-envelope file surfaces as a clear import error rather than silently importing nothing. Import MERGES into the active context (it maps to the seam's `setCookies`, i.e. Playwright `addCookies`), matching the "seed a profile" use case. A new deterministic `cookies.html` fixture sets cookies via `document.cookie` on load; the test drives a real local Chromium against the local fixture page and asserts the full round-trip at the `core` Driver seam — export the cookies the page set, write the export file to the test's OWN temp dir, then import it into a FRESH separate profile/context and observe both cookies restored — never on third-party DOM and never touching a shared/global location (PRD "Testing Decisions").

- e69b8cd: Refine and fully test the `eval` verb (the escape hatch) at the `core` Driver seam.

  `eval` runs a raw JS EXPRESSION in the active page's context and returns its serializable result, for cases no other verb covers (PRD story 9). It sits beside the raw-locator addressing (ADR-0004): both are page-context expressions the transport resolves, and neither leaks a Playwright/CDP type across the seam (ADR-0003). The seam now documents the load-bearing SERIALIZATION CONTRACT the transport owns and callers rely on: the result crosses by VALUE, so serializable values (primitives, plain objects, arrays) return faithfully; a returned Promise is awaited; non-finite numbers (`NaN`, `Infinity`) come back as `null`; functions/symbols come back as `undefined` and live host objects (a DOM node, `window`) as an opaque preview string (the live object cannot cross the process boundary); and a result that genuinely CANNOT be serialized (a circular structure, a `BigInt`) or an expression that THROWS in the page REJECTS with a transport-neutral `Error` rather than returning a lossy stand-in, so the escape hatch surfaces "this did not serialize" as a failure instead of silently lying. The implementation is a thin passthrough to the transport's serialize-and-return (no re-encoding, no envelope, no swallowed rejection). A new deterministic `eval.html` fixture carries controlled state (`#marker`, `window.__fixture`, `window.__fixtureAsync`, `window.__fixtureCircular`); tests run a real local Chromium against the local fixture page and assert each behaviour at the `core` Driver seam (expression result, object/array by value, awaited Promise, `undefined`/`null`/primitive round-trip, non-finite-as-`null`, function/symbol-as-`undefined`, circular-rejects, page-throw-rejects), never on third-party DOM (PRD "Testing Decisions").

- 00cdd29: Implement and fully test the `goto` (navigate) and `wait` verbs at the `core` Driver seam.

  `goto` navigates the active page and settles on the `load` event before returning, so a subsequent read sees the rendered page; it deliberately does NOT wait for `networkidle` (Playwright-discouraged and hangs on long-poll/streaming/beacon pages), leaving XHR/JS-rendered content to the explicit `wait` verb. `wait` supports its three forms transport-neutrally: `timeout` (`waitForTimeout`), `locator` (block until the addressed element appears), and `navigation` (block until the next navigation settles). The selector/timeout/navigation behaviour is shared by both Playwright transports (launch + attach) through one `waitFor` helper so they cannot diverge. New deterministic fixture pages (`delayed.html`, which script-renders content ~150ms after `load`, and `redirecting.html`, which JS-redirects ~150ms after `load`) drive the three wait forms; tests run a real local Chromium against the local fixture pages and assert each verb's effect (goto settles to `readyState === 'complete'`; wait-for-selector blocks until the late element renders; wait-for-navigation lands on the redirect target; wait-for-timeout elapses) at the `core` Driver seam, never on third-party DOM (ADR-0003 / PRD "Testing Decisions").

- c04cf73: Implement the `snapshot` verb: a token-cheap structured page view with stable refs.

  `snapshot` now returns the accessibility tree (roles + accessible names) plus visible text with stable `[ref=...]` element refs by default, so an agent can read the page and decide what to act on without parsing raw HTML; the refs are stable for an unchanged page (re-snapshotting yields the same refs). A `--full` option (`snapshot({full: true})`) returns the raw DOM instead (settled PRD decision, story 7). The seam `Snapshot` type is widened from the previous `{url, content}` stub to `{url, view, content}` with a `SnapshotView` (`'accessibility' | 'full'`) and a `SnapshotOptions` arg, all transport-neutral (no CDP/Playwright types cross the seam, ADR-0003). The Playwright launch and attach transports implement it via `page.ariaSnapshot({mode: 'ai'})` (default) and serialized `documentElement.outerHTML` (`--full`); snapshot refs and raw Playwright-locator addressing (ADR-0004) are complementary ways to address elements. Tests drive a real local Chromium against the local fixture page and assert the snapshot shape (roles/names/text present, ref stability across re-snapshots, raw DOM under `--full`) at the `core` Driver seam.
