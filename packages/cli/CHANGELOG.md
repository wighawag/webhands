# webhands

## 0.1.7

### Patch Changes

- 344ea20: Add an opt-in, Patchright-backed stealth launch to `PlaywrightLaunchTransport`.

  Standard Playwright drives Chromium over CDP and calls `Runtime.enable` at
  startup, which emits a `Runtime.consoleAPICalled` side-effect that some anti-bot
  WAFs (Imperva/Cloudflare/DataDome) detect to serve an "Access Denied" block page
  before the page even renders. [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright),
  an API-compatible Playwright fork, patches exactly these CDP leaks.

  - New third constructor argument `PlaywrightLaunchTransportOptions`:
    `{stealth?, systemBrowser?}`. Stealth is a transport-construction policy and
    stays OFF by default; vanilla Playwright remains the default. `systemBrowser`
    (e.g. `'chrome'`) drives a browser already installed on the system instead of
    the bundled Chromium (it maps to Playwright's `channel` internally; the public
    name stays domain-level per ADR-0003). The transport seam (`OpenTarget`) is
    unchanged and still carries no Playwright/CDP types.
  - `patchright` is an OPTIONAL dependency imported LAZILY (`await import(...)`)
    only when `stealth: true`, so users who never opt in are not forced to install
    it and the module load never fails when it is absent.
  - When stealth is enabled but `patchright` is not installed, `open` throws the
    new typed `MissingStealthDependencyError` (with the `pnpm add patchright` fix
    in its message). It NEVER silently falls back to vanilla, which would
    re-introduce the exact tell without telling anyone.
  - With `systemBrowser: 'chrome'`, a missing-binary failure is reported as a
    missing SYSTEM Chrome via `MissingBrowserBinaryError`.

  The `webhands` CLI exposes the opt-in via `--stealth` and
  `--use-system-browser <name>` flags on `serve` and `launch` (both default off /
  bundled Chromium). `serve` is where they take effect (it is the one place a
  browser is launched, ADR-0005); the two flags are independent. The CLI also maps
  the new `missing-stealth-dependency` condition to the exact `pnpm add patchright`
  fix command, alongside the existing typed-error mappings.

  Honest caveat: this addresses ONLY the CDP automation tell. IP reputation and
  session/profile reputation still matter; the realistic recipe is stealth +
  `systemBrowser: 'chrome'` + headed + a warmed, logged-in profile + a residential
  IP (ADR-0002). Stealth alone is necessary-but-not-sufficient.

- Updated dependencies [344ea20]
  - @webhands/core@0.3.0

## 0.1.6

### Patch Changes

- Updated dependencies [9de25a8]
  - @webhands/core@0.2.0

## 0.1.5

### Patch Changes

- Updated dependencies [656909e]
- Updated dependencies [6d57871]
- Updated dependencies [fcb1dda]
- Updated dependencies [c3bae5b]
  - @webhands/core@0.2.0

## 0.1.4

### Patch Changes

- 438e63f: Trim the README "Scope and honesty" section to describe what the tool does (and does not) do without prescribing third-party site usage, and remove the manual smoke-test section.

## 0.1.3

### Patch Changes

- fa9b0d5: Include the repository README in the published package by copying it from the monorepo root during `prepublishOnly` (the copied file is gitignored).

## 0.1.2

### Patch Changes

- 42077df: Add a `use-webhands` agent skill and an agent-focused README on-ramp.

  - New `skills/use-webhands/SKILL.md`: the workflow + judgment layer for driving
    `webhands` from an AI agent. Covers the `serve` → `goto` → `wait` → `snapshot`
    → `stop` pipe (per ADR-0005, not `launch`), backgrounding the blocking `serve`
    process, the anti-bot headed fallback, pacing XHR-rendered results, loose
    text-based selectors for `eval`, and the personal-use / read-freely-but-confirm-
    before-transacting guardrails. Complements the auto-generated per-verb
    `webhands-*` skills, which stay the per-flag reference.
  - README: new "Use it via your AI agent (start here)" section showing the plain
    `npx webhands` bash flow (no MCP wiring), the one-time headed login, and the
    three things a new user must know. Existing How-it-works / Scope-and-honesty /
    Security sections are unchanged.

  Docs only; no runtime behaviour change.

## 0.1.1

### Patch Changes

- eca3cc3: Fix `setup-profile`: hold the headed browser window open until the user closes it,
  instead of closing it in the same tick. The command now blocks on a new
  `Session.waitForClose()` seam method (resolves when the user closes the
  window/context or `close()` is called), so the one-time login flow actually works;
  on close it reports success and suggests `launch`.

## 0.1.0

### Minor Changes

- 4ce6b39: Wire the `cli` package as the `incur` CLI around `core` (PRD stories 12-14, 17).

  `createCli()` builds an `incur` `Cli.create('webhands', …)` binding ONE command per verb (`goto`, `snapshot`, `click`, `type`, `eval`, `wait`, `cookies export`/`import`) plus `setup-profile`/`launch`/`attach`, each with a zod `args`/`options`/`output` schema. Every run returns the incur structured (TOON/JSON) envelope with the declared output shape and a `cta` next-verb hint (navigate → snapshot → act), so an agent can chain commands without parsing heuristics or extra prompting. Because it is built on `incur`, the SAME binary is also an MCP server (`--mcp` / `mcp add`, including the `/mcp` HTTP endpoint via `cli.fetch`) and emits a skills / `--llms` manifest with NO bespoke MCP code. Typed `core` error conditions raised by the transports (`MissingBrowserBinaryError` / `MissingProfileError` / `AttachNotChromiumError` / `AttachNoContextError`) are mapped — by their stable `code`, never re-detected — to the user-facing message plus the EXACT command to fix them (`npx playwright install chromium`, `webhands setup-profile --profile <name>`, start Chromium with `--remote-debugging-port`, open a window/tab). A `SessionProvider` seam isolates how a verb obtains its session (the v1 Playwright transports today; the long-lived `incur serve` thin-client in the next task per ADR-0005), so the verb commands stay unchanged when cross-invocation persistence lands. CLI-level tests assert the WIRING only (schemas, the structured envelope, `cta`, the `--llms`/MCP manifest, and the actionable fix-command messages) with an injected stub/throwing provider, never a real browser; verb behaviour stays tested at the `core` Driver seam.

- a70fb1f: Keep a single browser session alive ACROSS separate CLI invocations via a long-lived `serve` process (ADR-0005).

  A new `core` `SessionServer` (`startSessionServer`) opens the ONE live session up front through any seam `Transport` (the browser launches once, never per verb) and serves that already-live page over a small session-RPC (`/session/call`); each `webhands <verb>` becomes a THIN CLIENT (`connectRemoteSession`) that forwards verbs to the running server and drives the SAME live page, so navigation/DOM state persists between separate processes (the on-disk profile alone does not carry it). Discovery is an endpoint file (`session-endpoint.json`) written under the controller home root and read by clients; teardown is explicit. Lifecycle is EXPLICIT (ADR-0005): new `serve` / `stop` CLI commands bring the single session up/down, a verb with NO live server raises the typed `NoLiveServerError` (`no-live-server`) which the CLI maps to "run `serve` first" and exits non-zero (it never auto-spawns), and a second open while one is live is a typed `SessionAlreadyActiveError` (`session-already-active`) mapped to "run `stop`". The default CLI `SessionProvider` is now that thin client (discover the endpoint, return the remote proxy whose `close()` is a NO-OP so a client cannot tear down the shared session); the v1 Playwright launch/attach transports are launched only by `serve`. The session-RPC request/response shape is one shared module (`session-rpc.ts`) imported by both server and client so they cannot drift, and no Playwright/CDP type crosses the seam (ADR-0003). Tests prove persistence at the seam against the LOCAL FIXTURE PAGE — one served process spans two separate client connections and the second observes live state (a navigation + an in-page mutation) set by the first — plus browser-free coverage of endpoint discovery, the served RPC round-trip over the `StubTransport`, the no-op client close, and the single-session refusal; all on-disk state (endpoint file, profile) is isolated to a temp root and the real `~/.webhands` is asserted untouched.

- ad83d03: Scaffold the pnpm monorepo with `core` and `cli` packages and the verb-level `Driver`/`Transport` seam.

  `core` exports a transport-neutral seam (`Transport`/`Driver`, `Session`, `Page`) expressed in verbs (navigate, snapshot, click, type, eval, wait, cookies) with element addressing as a raw Playwright locator string (ADR-0003/0004), a `StubTransport` that round-trips the seam, and a local fixture HTTP server for later deterministic verb tests. `cli` anchors the `incur`-wrapper boundary (wired in a later task).

### Patch Changes

- 54baff9: Wire `--version` (and the help header + MCP server version) to the package's real
  version, read from `package.json` via a JSON import attribute. Previously
  `--version` fell back to help output because no version was passed to
  `Cli.create`.
- 155bc9a: Add the v1 honesty-and-proof docs.

  A root `README.md` documents the scope/humility note (personal use of your OWN authenticated session on your OWN machine and IP; driving sites like Kayak/Skyscanner is generally against their ToS; no login-bypass or CAPTCHA-solving; no fingerprint-spoofing, per ADR-0002) and a security note that the running `serve` endpoint executes caller-supplied expressions (`eval` + raw Playwright locator expressions, ADR-0004) so it must stay LOCAL and never be exposed to untrusted callers. A manual, live, flaky `docs/manual-smoke-kayak.md` documents the end-to-end pipe against Kayak (`setup-profile` -> `serve --headless` -> `goto` a search -> `snapshot` -> `stop`, the landed ADR-0005 shape), explicitly NON-CI: it is not part of `verify`/`pnpm test`, and the automated suite never hits a live third-party site or asserts on its DOM. Docs only; no code change.

- Updated dependencies [a70fb1f]
- Updated dependencies [d2daed4]
- Updated dependencies [4660aa9]
- Updated dependencies [ad83d03]
- Updated dependencies [67dd468]
- Updated dependencies [c2e9c0f]
- Updated dependencies [5be5624]
- Updated dependencies [e69b8cd]
- Updated dependencies [00cdd29]
- Updated dependencies [c04cf73]
  - @webhands/core@0.1.0
