# @webhands/core

## 0.7.0

### Minor Changes

- 8ef332b: Add `distill --test`: validate the just-emitted hand scaffold by running its replay against the LIVE page through the existing `script` verb (ADR-0012), reporting pass/fail loudly. This is the validation half of the `distill-session-into-hand` prd (story 5); it reuses `script` verbatim and adds no new execution surface.

  - **Reuse `script`, no new surface.** `distillTrace(...)` now also returns `replayScript`: the SAME distilled replay rendered as the `script` verb's driver-context shape (an `async (page) => { ... }` function of the live Playwright `page`). It is built from the SAME per-step replay lines as the emitted `Hand` scaffold, so the tested source and the scaffold cannot drift. Exposed as `renderReplayScript` alongside `distillTrace`.
  - **`distill --test`.** When `--test` is passed, the verb runs `replayScript` against the served session via `page.script(...)` (the exact ADR-0012 mechanism) and reports the outcome in a new optional `test` field: `{passed: true, result}` on a clean replay (PASS) or `{passed: false, error}` on a throw (FAIL), reusing `script`'s structured-error path. A throwing scaffold is a clean, typed FAIL surfaced loudly (a `--test` cta line), never a silent pass. Omitting `--test` leaves the emit-only output shape unchanged.
  - **HARD INVARIANT preserved.** `--test` only RUNS the replay in the sandboxed page-context tier: it never writes `hands.json` and never `import()`s the emitted module. Adopting a hand (naming it in `hands.json`) stays the operator's explicit trust act (ADR-0007). Tested: with `--test`, no `hands.json` is written anywhere and only the scaffold + notes land under `--out`.
  - **PASS + FAIL are tested** against a real served browser on the local fixture (mirroring the `script` verb's seam test): a good scaffold replays and reports PASS; a broken step (a `select` on a non-`<select>`) throws fast and reports a typed FAIL. Shared-write isolation holds (temp `--out`, no real home/config write).

- a8c2944: Add the `distill` verb: reduce a just-driven session into a reusable HAND SCAFFOLD plus a human-readable NOTES markdown, from the session's verb trace. This is the authoring half of the `distill-session-into-hand` prd (validation via `script` is a separate follow-on task). It EMITS and NEVER loads.

  - **`distill` core (`@webhands/core`).** `distillTrace(entries, options)` reduces the ordered verb trace into a frozen ADR-0007 `Hand` module scaffold (a default-export factory closing over `ctx.pwPage`) that FAITHFULLY replays the discovered steps in order, plus a notes markdown listing the flow's steps / selectors / decisions. Reads/probes and escape hatches (`eval`/`script`/hand verbs) are left as annotated TODOs rather than auto-invented. A typed `{ENV:NAME}` credential stays the TOKEN in the scaffold and notes (never a resolved secret). Exposed as `distillTrace` / `sliceTrace` / `DEFAULT_HAND_VERB`.
  - **The SLICE selector.** `--from`/`--to` crystallize a caller-named sub-flow (0-based, inclusive index range over the trace) so the hand encodes the flow that mattered, not the earlier failed probes; the default is the whole session. Out-of-range bounds clamp; an inverted range yields an empty slice.
  - **Optional enrichments.** `--summary <text>` (the agent's intent) and `--session-file <path>` (a transcript webhands is HANDED, read as a plain path; it does NOT discover transcript locations) enrich the notes; omitting both still yields a scaffold from the trace alone.
  - **Thin-client trace fetch.** The trace lives in the long-lived `serve` process; the `distill` verb is a thin client, so it reads the SAME session's ordered trace over a new read-only route (`SESSION_TRACE_PATH` / `readSessionTrace`), mirroring how the verb proxy fetches results. Read-only: it never drives the page.
  - **HARD TRUST INVARIANT (tested).** `distill` writes NO `hands.json` and never `import()`s the emitted module: it writes only the scaffold to `--out` and the notes beside it as `<out>.notes.md`. Adopting a hand (naming it in `hands.json`) stays the operator's explicit trust act (ADR-0007). A `--test` flag is RESERVED for the next task (validation via `script`) and is accepted-and-ignored here.

- 92590b0: Add `{ENV:NAME}` placeholder substitution for value-bearing verbs plus `.env` loading via `ldenv`, and advertise the capability to the agent. This is the foundation the `distill` work depends on: it keeps a value the agent types (and a later verb-trace / emitted hand scaffold) free of literal secrets, while the real value still reaches the page.

  - **`{ENV:NAME}` substitution in `type` (webhands' OWN grammar, not ldenv's `@@VAR`).** The value-bearing `type` verb resolves an `{ENV:NAME}` token against `process.env.NAME` at type-time, in the SERVED controller process (where the env is loaded). A value with no `{ENV:...}` is typed VERBATIM (backward compatible). An UNSET or EMPTY variable fails LOUD with a typed `UnresolvedEnvPlaceholderError` (code `unresolved-env-placeholder`), never a silent empty type. Exposed as `substituteEnvPlaceholders` / `hasEnvPlaceholder` from `@webhands/core`.
  - **`.env` loading via ldenv at `serve` startup.** The long-lived `serve` process loads `.env` / `.env.local` / `.env.<mode>` via ldenv's importable `loadEnv()` before the browser opens (the process that launches the browser and reads `process.env` for substitution), so `{ENV:PASSWORD}` resolves against a gitignored `.env.local` and not only the interactive shell. The operator's real shell env WINS over a `.env` file on a conflicting key (ldenv's documented priority). Exposed as `loadWebhandsEnv` from `@webhands/core`; `ldenv` is added as a `@webhands/core` dependency.
  - **Agent-facing advertisement.** The `type` verb's tool / `--help` description now states a value may be `{ENV:NAME}` and that the agent should use it for credentials the operator put in the environment. The bundled `use-webhands` skill gains a "handling sensitive info" rung (prefer `type '#pass' '{ENV:PASSWORD}'` over a literal; the operator supplies the value via env / `.env.local`; you never read it), kept no-priming-clean.

  Honest scope: `{ENV:NAME}` is HYGIENE, not a security boundary. The substituted value still lands in the DOM and is readable back, and a local agent can read the env itself; the point is only to avoid gratuitously writing a literal credential into the tool-call and the on-disk artifacts when a placeholder works identically.

- e2707ef: Record a per-session VERB TRACE in the long-lived `serve` session: an ordered, in-memory record of the verbs that drove the live page. This is the portable, ground-truth backbone the later `distill` work turns into a hand scaffold, so it is faithful to what actually drove the page, not a reconstruction.

  - **Ordered accumulation at the RPC dispatch choke point.** Every verb dispatched against the served session (`applySessionRpc`, the single per-session point every verb passes through) appends one entry: the verb NAME (a hand verb by its contributed name, not the wire envelope), the WHOLE request AS IT ARRIVED (so the locator/args are exactly what the agent passed), and the verb's serializable RESULT (enough result shape to reconstruct the step). A verb that THREW is not recorded (only steps that actually drove the page). Exposed as `createVerbTrace` / `verbNameOf` and the `VerbTrace` / `MutableVerbTrace` / `VerbTraceEntry` types from `@webhands/core`.
  - **No literal secrets, for free.** The request is recorded BEFORE `{ENV:NAME}` substitution (which happens later and in-process, inside the `type` verb body), so a typed credential stays the `{ENV:PASSWORD}` TOKEN in the trace, never the resolved secret. This task adds no redaction pass: non-credential typed values and returned page content are recorded as-is (unavoidable and already agent-readable by definition).
  - **In-memory, per-session, readable in-process.** `startSessionServer` mints one trace per session and exposes a READ-ONLY view on the returned server (`RunningSessionServer.trace`) for the future `distill` verb to read from the same session. `entries()` returns a copy-safe ordered snapshot. Nothing is written to disk; the entry shape is plain serializable JSON so disk persistence can be added later without reshaping it (not built here).

- 5ed4a0e: Make `snapshot`'s `[ref=eN]` directly actionable: an agent can read the page with `snapshot`, see a node tagged `[ref=e7]`, and `click`/`type` it directly with `--by-ref` (passing the bare `e7` or `aria-ref=e7`), so "read the page, then act on what you read" is ONE loop with no detour through `query --with-refs` or `eval`/`querySelectorAll`. This closes the highest-leverage API-surface gap the scoreboard transcripts exposed (the "two-ref collision": the snapshot ref and the durable `query` ref shared the word `ref`, but only the latter was actionable, so the agent kept falling back to `eval` to rediscover selectors).

  - `@webhands/core`: the built-in interaction hand now normalizes a `{byRef: true}` target that is a snapshot ref (a bare `eN` or `aria-ref=eN`) to `page.locator('aria-ref=eN')` (Playwright's native `aria-ref=` snapshot-ref locator engine), then resolves it through the SAME single resolver and the SAME exactly-one fail-loud guard (`assertRefResolvesToOne` / typed `StaleRefError`) the durable `query` ref already uses. A durable `query` ref (already a `p.locator(...)` expression) is passed through UNCHANGED. The normalization helper (`normalizeRefToLocator`) is exported. Nothing Playwright-shaped crosses the seam: the ref arrives and stays an opaque string (ADR-0003), resolved through locator-expression addressing (ADR-0004).
  - `webhands`: `click`/`type --by-ref` now accept a snapshot `[ref=eN]` (the bare `eN` / `aria-ref=eN`) in addition to a durable `query` ref; `--help`/`--llms-full` for `snapshot`, `click`, and `type` (and the post-snapshot CTA hints) say so. The bundled `use-webhands` skill gains a read-then-act note showing the `snapshot` -> `click eN --by-ref` loop.

  HONEST durability distinction (neither ref silently does the other's job): a snapshot `aria-ref=eN` is SNAPSHOT-SCOPED, an "act on what I just saw" handle re-keyed every `ariaSnapshot`, so it correctly goes stale (loud `stale-ref`, never a wrong-element action) after a DOM change or a re-snapshot. The durable `query` ref deliberately SURVIVES list mutation. They share the same `--by-ref` flag and the same fail-loud contract, but they are different durability models. The durable `query --by-ref` path and its safety are unchanged. Recorded in a new ADR (`docs/adr/0013`), which states the relationship to ADR-0004 (this ADDS an actionable snapshot ref ALONGSIDE the locator grammar; ADR-0004's rejection of "snapshot ref-ids ONLY" as the addressing model still stands).

- 10dc6c1: Add a `script` verb that runs a caller-supplied DRIVER-CONTEXT script against the one live served session, handing it the full Playwright `page` so it can locate + act + auto-wait + read a whole sub-flow in ONE call and return the serializable result. This closes the "one process per action" token cost the scoreboard exposed: a webhands agent can now batch a known sub-flow into one turn (like the Playwright baseline does) against the page it ALREADY opened, instead of shelling out one verb per action.

  `script` is a new BUILT-IN `scriptHand` (the `evalHand` shape, closing over the live `HandContext.pwPage`); it does NOT change or supersede `eval`. The source is JS that evaluates to a function of the page (e.g. `async (page) => { ... }`), read from `--file <path>`, an inline argument, or stdin. Its in-process `page` API is plain Node JS (NOT an ADR-3 seam surface), but its RETURN stays seam-clean (serializable, no Playwright/CDP type), and a throwing script rejects as a clean structured error. TRUST: the SAME page-script surface as `eval` (caller JS, loopback-only), NOT the `hands.json` hand-loading / npm-dependency surface. Documented in a new ADR (`docs/adr/0012`) and the README security note.

### Patch Changes

- fc4883e: Let `serve` expose a Chromium CDP / remote-debugging endpoint for its launch session, so a separate Playwright client can `connectOverCDP` and drive the SAME live page the server holds (a shared driving surface). This is opt-in on the launch transport and surfaced through the existing session-endpoint discovery channel; it adds no new verb and changes nothing on the verb seam (the endpoint is a plain loopback URL string, like the attach endpoint).

  - `@webhands/core`: `PlaywrightLaunchTransport` gains an opt-in `exposeCdp` construction option. When set, it launches Chromium with `--remote-debugging-port=0`, resolves the OS-assigned port from the `DevToolsActivePort` file (the same mechanism the attach transport's tests use), and exposes the resulting `http://127.0.0.1:<port>` endpoint via a new `cdpEndpoint()` accessor on the concrete transport (never on the `Transport`/`Session` seam, so ADR-0003 holds). `SessionEndpoint` gains an optional `cdpEndpoint` field, and `startSessionServer` folds a resolver's value into the advertised endpoint (and the on-disk endpoint file) so client/tool discovery can find the shared surface. The CDP port binds to loopback only, like the serve RPC endpoint.
  - `webhands`: the `serve` command always exposes the CDP endpoint for a launch session (an `attach` session has no harness-owned debugging port, so none is advertised there) and surfaces it in the `serve` output as `cdpEndpoint`.

  This makes the eval harness's Playwright-only baseline measurable: the baseline agent connects its Playwright to the harness's served browser over CDP and drives the harness's existing page, so the harness reads the page the agent actually drove and scores a genuine completion as PASS (it previously scored a false FAIL because the agent drove its own separate browser).

## 0.6.0

### Minor Changes

- 87114e3: Add an opt-in durable element `ref` to the `query` verb so an agent can read a list, pick a row, and act on THAT element later even after the page mutates between read and act (fixing the index-drift footgun where a positional `.nth(i)` silently clicks the wrong row). Second deliverable of the "broaden the agent verb surface" prd.

  `query(locator, {refs: true})` adds a `ref` to each returned row, computed by a PREFERENCE LADDER: it REUSES the element's own stable, VERIFIED-UNIQUE attribute when present (priority `id`, then `data-testid`/`data-test`/`data-id`, `name`, a link's `href`, a unique `aria-label`) so the ref IS the element's real locator (durable across framework reconciliation, zero DOM mutation); it MINTS a namespaced `data-webhands-ref` attribute ONLY as the fallback for an anonymous element. A spike against REAL React 18 keyed-list and Svelte 4 `{#each}` re-renders settled the mint mechanism as an ATTRIBUTE (not a page-world `WeakMap`): against real reconciliation the two survive/die on the same cases, and the attribute alone is a locator string the one existing resolver resolves with no parallel addressing path.

  `click`/`type` accept the ref with `{byRef: true}` (CLI `--by-ref`): the ref is resolved through the SAME single resolver but asserted to match EXACTLY ONE element first. A ref that now resolves to ZERO (the element was removed/replaced by a re-render or a navigation) or to MORE THAN ONE (a cloned subtree carrying the minted attribute) fails LOUD with a typed `StaleRefError` — never a silent wrong-element action, which is strictly safer than `.nth()`.

  Refs are OPT-IN: the default `query` (no `refs`) performs NO DOM write and returns no `ref` (a pure read), and minted attributes are namespaced and single-`query`-scoped (a fresh `refs: true` query sweeps the prior query's mints first). The `ref` is an additive optional row field and resolves through the one existing resolver, preserving the prd's reversibility shape. `StaleRefError` is exported from `@webhands/core` and the CLI maps it to a re-query fix hint.

- 55aece4: Add the Tier-1 read verbs to the agent surface: `query` plus the state shorthands `exists` / `count` / `isVisible` / `getAttribute` (first deliverable of the "broaden the agent verb surface" prd). These kill the `eval`-returns-a-JSON-string pattern for reading structured data and probing element state.

  `query(locator, {attrs?, props?, pw?, limit?})` addresses element(s) by a raw Playwright locator expression (already same-origin frame-capable via a `frameLocator(...)` string) and returns ONE ROW PER MATCH carrying EXACTLY the requested fields:

  - `attrs` reads DOM ATTRIBUTES by name (`getAttribute`);
  - `props` reads live JS PROPERTIES by name (`el[name]`, e.g. `innerText`, `value`, `checked`); `text` is just `props: ['innerText']`;
  - `pw` is the only fixed set: `visible` (`locator.isVisible()`, actionability-grade) and `bbox` (`locator.boundingBox()`, viewport CSS-pixels);
  - `limit` bounds the rows returned.

  The `attrs`/`props` split is LOUD and never auto-detected (so `attrs:['checked']` and `props:['checked']` can differ). The state verbs are thin shorthands over the same machinery: `count` = match-set size, `exists` = `count > 0`, `isVisible` = the first match's `pw:['visible']`, `getAttribute` = the first match's `attrs:[name]`.

  The options are an OPTIONS OBJECT so a future `frame?` / `ref` field is non-breaking, and all locator/frame resolution routes through the single existing resolver (no parallel addressing scheme). Values cross the RPC seam by structured clone with no Playwright/CDP type leak, the same contract `eval` holds. Each verb is both a CLI command and an MCP tool from one incur definition; the list flags `--attr` / `--prop` / `--pw` are REPEATABLE, not comma-joined; there is no `--frame` flag (frame scope rides in the locator string).

- fe831f9: Add the Tier-2 rich input verbs to the agent surface: `press` / `hover` / `select` / `scroll` / `drag` (the "broaden the agent verb surface" prd, stories 8-12). These lift page-level Playwright actions a hand already has on the live page up to the agent verb seam, so a seam-only (MCP / Model-B) agent can drive a browser game or a richer form, not just `click`/`type`.

  - `press(key, target?)` sends a keyboard key or chord — a key name (`Enter`, `ArrowLeft`, `a`) or `Modifier+Key` (`Control+A`, `Shift+Tab`), Playwright's `keyboard.press` grammar — at a locator (focuses it first) or, with no locator, the page's focused element.
  - `hover(target)` hovers the pointer over an element to reveal hover menus / on-hover controls `click` cannot surface.
  - `select(target, {value} | {label})` chooses a native `<select>` option by value OR by label (exactly one), reflected in the element's live state.
  - `scroll({to} | {by})` scrolls the page TO an off-viewport element (`scrollIntoViewIfNeeded`) or BY a `{dx, dy}` pixel delta (`mouse.wheel`) — exactly one form.
  - `drag(source, target)` drags one element onto another for drag-reorder UIs and drag-slider challenges (`dragTo`).

  All locator addressing resolves through the single existing resolver `click`/`type` use (so a same-origin `frameLocator(...)` hop in the string Just Works — no parallel addressing scheme), and the seam stays type-clean (ADR-0003): keys are strings, offsets are numbers, locators are strings, so nothing Playwright-shaped crosses. Signatures are options-object / positional in the established style so a future `frame?` qualifier stays additive.

  Each verb is both a CLI command and an MCP tool from one incur definition: `press <key> [--locator]`, `hover <locator>`, `select <locator> --value/--label`, `scroll --to/--by`, `drag <source> <target>`. `select` and `scroll` use the same loud "exactly one of" validation as `wait` for their mutually-exclusive flags (and `scroll --by` rejects a malformed `dx,dy` rather than scrolling by `NaN`). There is no `--frame` flag (frame scope rides in the locator string).

- 4ca6379: Add an optional same-origin `frame` qualifier to the `eval` verb (Tier-3 of the "broaden the agent verb surface" prd, story 13), so an agent can RUN page-world JS inside a NAMED same-origin child frame (e.g. fire a captcha `data-callback`, read a runtime-only JS value) rather than being forced into brittle `contentDocument` walks. This is the ONLY `frame?` qualifier on the surface: `eval` runs page-world JS and cannot carry a `frameLocator(...)` expression the way the locator-taking verbs do, so it gets an explicit frame selector instead.

  `eval(expression, {frame?})` / CLI `eval <expr> [--frame <selector>]`:

  - `frame` omitted == today's top-document `eval`, byte-for-byte (backward compatible).
  - `frame` is a transport-neutral STRING (a CSS selector for the `<iframe>` element, e.g. `#main-iframe`), never a Playwright `Frame` handle (ADR-0003). It resolves through the SAME single resolver `click`/`type` use (a `frameLocator(...)` over the selector), so there is no parallel frame-addressing path.
  - A SAME-ORIGIN frame evaluates the expression in that frame and returns its value by the same structured-clone contract `eval` already has (no Playwright/CDP type leak).
  - A CROSS-ORIGIN frame selector fails LOUD with a typed `CrossOriginFrameError` (code `cross-origin-frame`): page-world JS cannot cross a browser security boundary, so it is unreachable BY DESIGN, never a silent empty result. (Cross-origin reach is the separate Tier-4 frameLocator/coordinate surface.) Playwright will happily evaluate inside a cross-origin OOPIF, so the resolver detects cross-origin by comparing the frame's origin to the page's main-frame origin and refuses.

  Available over both the CLI (`--frame <selector>`) and MCP from one incur definition (R5). The options are a trailing OPTIONS OBJECT so the addition is non-breaking (R1).

- 159ccec: Add the Tier-4 agent surface for the VISION/TILE captcha family and any visual task (the "broaden the agent verb surface" prd, R3, stories 17-19): a coordinate `mouse` verb, a path-returning `screenshot` verb, and a cross-origin frame READ. A new ADR (`docs/adr/0010`) amends ADR-0003 to admit this narrow surface; the seam stays string/number-typed (no image bytes, no Playwright/CDP types cross).

  - `mouse({action: 'click'|'move'|'down'|'up', x, y, button?})` drives Playwright `page.mouse` at VIEWPORT CSS-pixels (NOT OS-level screen input). A pixel an agent saw in a VIEWPORT screenshot maps directly to a `mouse` click at the same coordinate — the look-then-click contract.
  - `screenshot({scope?, locator?, out?}) -> {path, width, height}` MINTS a PNG under a managed dir webhands owns (`<home>/screenshots`, beside `profiles/`, under the same `WEBHANDS_HOME`/`root` override) and returns its PATH — NEVER image bytes. Three scopes: `viewport` (default, coordinate-matched to `mouse`), `full` (whole scrollable page, for reading scrolled-out content, NOT coordinate-matched), and `element` (clipped to a locator; the locator is REQUIRED and validated loud like `wait`). A caller `out` override is validated to stay UNDER the managed dir, else the typed `ScreenshotPathError` (a new `screenshot-path-outside-managed-dir` controller code).
  - The cross-origin frame READ is the read counterpart to the already-working cross-origin `click`: it is NOT a new verb, but the EXISTING locator-resolver path (`query` and the locator-taking verbs) reaching a `frameLocator(...).frameLocator(...)` chain two cross-origin boundaries deep, which Playwright's `frameLocator` CAN cross. This is distinct from the Tier-3 frame-scoped `eval`, which is same-origin only. Read values cross by structured clone, the same contract `eval`/`query` hold.

  Each new verb is both a CLI command and an MCP tool from one incur definition: `mouse --action --x --y --button`, `screenshot --scope viewport|full|element --locator <expr> --out <path>`. The MCP `screenshot` result surfaces the file PATH as the attachment-capable `path` field (a plain string an agent reads/attaches; no bytes). Real-browser fixture tests cover all three capabilities (a multi-origin nested-frame fixture for the cross-origin read + an element-clipped screenshot of a frame widget), the viewport-screenshot<->mouse coordinate contract, and the managed-dir path validation; screenshot output + profile paths are isolated to per-test temp dirs so the real `~/.webhands` (and its screenshots dir) stay untouched.

### Patch Changes

- 8463db8: Fix the `click` verb timing out on a real submit button whose click triggers a slow navigation.

  Playwright's `Locator.click()` clicks AND THEN auto-waits for any navigation the click scheduled to finish, and that post-click wait was charged against the verb's short actionability budget (`NORMAL_CLICK_TIMEOUT_MS`, 1s). So a perfectly normal, visible, actionable submit button whose navigation took longer than 1s had its already-performed click reported as a `TimeoutError` and was wrongly routed to the dispatch escape path, which then re-clicked a page that was already navigating away, surfacing a second timeout. (Observed on the DVSA login "Continue" button in `examples/basic`.)

  The happy-path click now passes `noWaitAfter: true`, so the short budget measures ACTIONABILITY only (can we click it?), not how long the resulting navigation takes. A genuinely non-actionable hidden custom input still cannot be clicked within the budget and still falls through to `dispatchEvent` exactly as before, so the hidden-input escape path is unchanged.

  Covered by a regression test that clicks a submit button whose navigation is held back beyond the budget (a new `?delayMs=` fixture-server delay + `slow-submit.html` fixture); it fails without the fix and passes with it.

- 8d7e3fe: Reject unknown/misshapen `SnapshotOptions` in the `snapshot` verb instead of silently ignoring them.

  Previously the option was read narrowly as `options?.full === true`, so any other shape was silently dropped. Calling `snapshot({ view: 'full' })` (a natural mistake, since the result carries a `view` field) returned the accessibility view with no error, and the caller silently got the wrong content.

  `snapshot` now validates its options at both entry points (the in-process host and, load-bearingly, the RPC server dispatch) through a single source of truth. An unknown key or a non-boolean `full` throws a clear, named error (e.g. `snapshot: unknown option "view" (did you mean { full: true }?)`), and that error propagates faithfully across the RPC seam like other verb errors. This is strictly a safety improvement: behaviour is unchanged for all valid inputs (`undefined`, `{}`, `{ full: true }`, `{ full: false }`).

- 039fc6e: Add a SAME-ORIGIN TOKEN-HARVEST captcha capability proof and its same-origin nested-frame fixture (the "broaden the agent verb surface" prd, stories 6-7). This proves the EXISTING verb surface is rich enough for an agent with its OWN (here test-faked) 2captcha key to get past a same-origin captcha just by poking the page, with NO pre-built solver and NO iamhuman, and the frame-aware `query` read closes the one gap the spike found.

  - A new exported fixture page pair (`token-captcha-parent.html` + `token-captcha-child.html`) presents a token-harvest captcha widget one SAME-ORIGIN frame down (`#main-iframe`), mirroring the reachable Imperva `#main-iframe` structure: a page-readable `div.h-captcha[data-sitekey][data-callback]`, a `textarea#h-captcha-response` response sink, and a `window.onCaptchaFinished(token)` page callback. The callback accepts the token ONLY when it matches what was written into the sink, then flips `#captcha-state` from `pending` to `verified` and reveals the protected content (the page ADVANCES); a token that never reached the sink is `rejected`.
  - A real-browser seam test drives the verbs-only loop end to end: `query` READS the sitekey through a `frameLocator('#main-iframe').locator('.h-captcha')` hop + `attrs:['data-sitekey']` (the one frame-aware read the spike found missing, through the SAME single resolver `click`/`type` use, no `--frame` flag, R1) -> a TEST FAKE provider mints a token (no real network, no real key) -> `type` WRITES it into the same-origin sink through the same hop -> a frame-scoped `eval` FIRES the callback -> the page advances, read back through the hop. A negative test proves the chain is load-bearing (firing the callback with an empty sink is rejected and the page stays pending), and a shape test proves the widget genuinely lives one same-origin frame down (a top-document query is empty).

  No webhands product surface changed beyond the test fixture: the loop uses only verbs that already shipped (`query`/`count`/`exists`/`isVisible`, `type`, frame-scoped `eval`). The vision/tile cross-origin family is explicitly NOT in scope (that is the Tier-4 `vision-tile-captcha-proof`). Profile paths are isolated to per-test temp dirs; the real `~/.webhands` stays untouched.

- 58c981b: Add a VISION/TILE captcha capability proof and its multi-origin tile fixture (the "broaden the agent verb surface" prd, R3, story 17). This proves the Tier-4 surface COMPOSES into the vision/tile captcha family the way the frame-aware `query` proved token-harvest: an agent SEES the cross-origin tile grid (an element-clipped `screenshot` of the widget) and CLICKS it at VIEWPORT coordinates (`mouse`), reading challenge state through the cross-origin frame READ, two cross-origin frames deep, with NO iamhuman and NO solver.

  - A new exported fixture page (`tile-captcha.html`) presents an INTERACTIVE 3x3 tile grid two cross-origin frames deep (a WAF-like frame embedding an hCaptcha-like challenge frame, composed across three distinct fixture-server origins via the same `?child=<url>` mechanism the read-only `nested-frame.html` uses). The deepest level is a real challenge: clicking the marked tiles (deterministic `data-target` markers stand in for a vision model's decision) and submitting flips its `#challenge-state` from `pending` to `solved`; a wrong selection reads `wrong`.
  - A real-browser seam test drives the verbs-only loop end to end: cross-origin READ of the grid/state -> element-clipped + viewport `screenshot` -> VIEWPORT-coordinate `mouse` clicks (each tile's coordinate is its `bbox`, read THROUGH the cross-origin chain, so the coordinate<->screenshot contract holds across both cross-origin boundaries) -> the challenge advances. A negative test proves the coordinate mapping is tight (a click on a non-target tile selects exactly that tile and leaves the challenge unsolved), so a mis-mapped coordinate could not pass by accident.

  No webhands product surface changed beyond the test fixture: the loop uses only verbs that already shipped (`query`/`getAttribute`/`count`/`exists`, `screenshot`, `mouse`). Screenshot output + profile paths are isolated to per-test temp dirs; the real `~/.webhands` (and its screenshots dir) stay untouched.

## 0.5.0

### Minor Changes

- 9721479: Add an opt-in `--proxy` SOCKS option that routes ALL browser traffic AND DNS
  through one SOCKS proxy, with no DNS leak by default. The seam is unchanged:
  `OpenTarget` stays Playwright/CDP-free (ADR-0003) and the proxy knob lives ONLY
  on the transport-construction policy (`PlaywrightLaunchTransportOptions`).

  - `proxy?: string` on `PlaywrightLaunchTransportOptions`: a SOCKS URL the
    transport parses and forwards to Playwright's `proxy` launch option. Accepts
    `socks5h://host:1080`, `socks5://host:1080`, or `socks://host:1080`, with an
    optional `user:pass@` userinfo (URL-decoded). The scheme decides DNS handling:
    `socks5h://` means "resolve DNS at the proxy" (no leak), `socks5://`/`socks://`
    mean "SOCKS5, local DNS allowed".
  - DNS no-leak: when no-leak is in effect (the `socks5h` scheme, or an explicit
    override), the transport adds Chromium's
    `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE <proxyHost>` catch-all, the
    flag the Chromium SOCKS design doc prescribes so even side channels (the DNS
    prefetcher) cannot leak a raw local DNS query. The proxy host is EXCLUDEd so
    Chromium can still reach the proxy itself.
  - `proxyNoLeak?: boolean` overrides the scheme's implied DNS behaviour: force the
    leak-free catch-all even for a plain `socks5://`, or allow local DNS even for
    `socks5h://`.
  - A malformed `--proxy` value throws the typed `InvalidProxyError`
    (`code: 'invalid-proxy'`) instead of silently launching unproxied (which would
    leak the very traffic the user asked to tunnel). The CLI maps it to a fix hint
    showing the expected SOCKS URL shape.
  - `parseSocksProxy` and `hostResolverRulesArg` are exported from `@webhands/core`
    so the parsing/flag logic has one tested home.

  CLI: `webhands launch`/`serve` gain `--proxy <socks-url>`, threaded through the
  existing `LaunchPolicy`/`stealthOptions` pattern into the launch transport.

  This is a DELIBERATE deviation from the project's "real machine and IP, no
  proxy" default stance (ADR-0002): it is opt-in, default OFF, and documented in
  ADR-0009. The honest caveat stands: tunnelling traffic changes your IP/DNS path
  but does not by itself defeat bot detection, and a proxy IP can READ worse than a
  clean residential one.

## 0.4.0

### Minor Changes

- 094a12b: Harden the Playwright LAUNCH transport with opt-in, safely-defaulted
  anti-detection launch options Patchright recommends. The seam is unchanged:
  `OpenTarget` stays Playwright/CDP/Patchright-free (ADR-0003) and all of these
  knobs live ONLY on the transport-construction policy.

  - `noViewport?: boolean` on `PlaywrightLaunchTransportOptions`: maps to
    Playwright's `viewport: null` so the real browser window drives its own size
    instead of Playwright's fixed 1280x720 emulated viewport (a known
    headless/automation tell). When unset it preserves current behaviour, EXCEPT
    that it now defaults to `true` when `stealth` is enabled (Patchright's
    recommended recipe); pass an explicit `false` to keep the fixed viewport even
    under stealth. The stealth-on default is documented and overridable: shipping
    the stealth engine while leaving the tell it is meant to hide in place would be
    self-defeating.
  - `extraLaunchArgs?: readonly string[]`: an escape hatch that forwards extra
    hardening flags (e.g. `--disable-blink-features=AutomationControlled`) to the
    launch `args` as a plain `string[]`, with no Playwright type crossing the seam.
  - `ignoreDefaultArgs?: boolean | readonly string[]`: passthrough so a caller can
    drop more automation-flavoured Playwright default args than the built-in
    stealth subset. When provided it REPLACES the built-in `['--enable-automation']`
    choice (the caller then owns the full list); unset, the stealth path keeps
    dropping `--enable-automation` as before.

  The transport still does NOT set or override `user_agent`, `locale`, `timezone`,
  or `headers` by default: Patchright warns a wrong UA is a bigger tell than none.

  CLI: `webhands launch`/`serve` gain `--no-viewport` (boolean), threaded through
  the existing `LaunchPolicy`/`stealthOptions` pattern into the launch transport.

  Honest caveat: these reduce but do NOT eliminate bot detection. A real profile,
  residential IP, and session reputation still matter (ADR-0002); this is one more
  layer, not a guarantee.

## 0.3.0

### Minor Changes

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

## 0.2.0

### Minor Changes

- 9de25a8: Rename the verb-level transport seam type `Page` to `WebHandsPage`
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
