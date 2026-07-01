# webhands

## 0.5.0

### Minor Changes

- 5777070: The `script` verb now takes its JS source EXACTLY ONE way: a FILE-PATH positional. `npx webhands script ./flow.js` is the only form; the verb reads that path and runs its contents.

  - **Inline source, `--file`, and stdin are REMOVED.** The old three-source design (`script "<js>"` inline OR `script --file ./flow.js` OR `cat flow.js | script`) is gone. There is now ONE source, ONE rule: the positional argument is a PATH to a JS file.
  - **A bare `webhands script` (no path) fails loud** (the positional is required), and a **missing/unreadable path fails loud** with a typed, non-cryptic error that names the path (the `invalid-script` error code shape is preserved).
  - **WHY:** one source, one rule. The file-first workflow is exactly what a raw-Playwright agent already writes (a flow file, then run it), so making it the only workflow removes the redundant `--file` flag and the "three ways to do one thing" surface, and keeps the `script`-vs-Playwright comparison honest.
  - **UNCHANGED:** the driver-context semantics (the full live Playwright `page`, real locators + actions + auto-waiting) and the ADR-0003 seam-clean, serializable RETURN. Only HOW the source is supplied changed. `eval` is untouched.
  - The `readScriptStdin`/`readProcessStdin`/`resolveScriptSource` multi-source machinery was removed (no dead code), replaced by a single `readFile(path, 'utf8')` at the call site. ADR-0012 is amended accordingly.

- 293efde: Cut the per-run CONTEXT overhead an agent pays around the useful work: suppress the per-result CTA "Suggested command" hints BY DEFAULT and make the bundled `use-webhands` skill a COMPLETE per-verb reference, so a skilled agent drives the surface without re-dumping `--help`/`--llms-full` at runtime (the two biggest overhead payloads the scoreboard transcripts found).

  - **CTA default-off + opt-in flag.** Every verb result used to append a `cta: {commands:[...]}` next-verb block; an agent or program never reads it, so it was pure token overhead. It is now suppressed by default (lean output). A human exploring interactively re-enables it with `--cta` (alias `--hints`) on any verb. NOT an opt-out `--no-cta`: lean is the default, the breadcrumb is opt-in. The flag and the `WEBHANDS_CTA` env appear in `--help`/`--llms-full`.
  - **`WEBHANDS_CTA` env override.** Setting `WEBHANDS_CTA=1` forces the CTA hints back ON without a per-call flag (a user can pin their preferred default once). Precedence: `--cta`/`--hints` flag > `WEBHANDS_CTA` env > built-in default (off). Exported as `CTA_ENV_VAR` from the package.
  - **The skill is now the full verb reference.** `skills/use-webhands/SKILL.md` (and the inlined eval skilled/script-forward preambles) describe WHAT EACH VERB DOES + its must-know argument forms, including the `page.`-prefixed locator grammar, name the canonical `npx webhands <verb>` invocation up front, and state plainly that the agent need NOT run `--help`/`--llms-full` at runtime. The inlined preambles stay no-priming-clean (`assertSkilledReferenceUnprimed`: no selector-shaped fragment, no site URL), so the per-verb examples are generic, not site selectors.
  - **A `webhands-cold-cta` eval agent kind** (eval harness, non-gating) reproduces the pre-flip cold baseline: the SAME cold preamble plus `WEBHANDS_CTA=1` pinned in the agent env, so the original four-way scoreboard numbers stay live and reproducible and `cold-cta - cold` isolates the CTA cost.

  No new verb is added.

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

- d451fc7: Docs: make the README friendlier to newcomers and lead the capability scoreboard with the latest results.

  - **README intro rewritten for newcomers.** A one-line hook ("let your AI agent drive a real, logged-in browser on your own machine"), a plain-language "log in once, then your agent acts" framing, and a "New here? Jump to" nav pointing at the quickstart, the scoreboard, and the scope/honesty section.
  - **README scoreboard section reframed around how webhands COMPETES with Playwright.** It now leads with a three-row "kind of flow" table (messy DOM: webhands wins; dynamic goal: tie; trivial scriptable flow: Playwright cheaper) and links to the scoreboard's new latest-first summary, instead of only saying "raw Playwright is currently cheaper".
  - **`evals/SCOREBOARD.md` now shows the latest, most representative results FIRST.** A new "Latest results first (the short answer)" section at the top surfaces the two most recent fair head-to-heads (tier-3 messy DOM and the dynamic read-decide loop) where webhands matches or beats raw Playwright on both outcome and tokens. The detailed chronological lab notebook is unchanged below, with a pointer from the older simple-flow "how to read it" section back to the summary.

  No package behavior changes.

- fd189af: Docs: tell a sharper hands story across the README and the capability scoreboard.

  A **hand** is now framed as sitting ABOVE the verbs-vs-Playwright comparison and winning on two distinct axes, not just "the simpler path":

  - **New capability raw Playwright cannot reach at all** (e.g. a captcha-solving hand plugs in solving logic + a provider key webhands does not ship, so the comparison becomes "reaches the goal vs does not").
  - **Token collapse on flows Playwright CAN do** (a known sub-flow authored into a hand ONCE becomes a single cheap verb call instead of an N-turn explore loop the agent re-pays every run).

  Adds a "Where hands change the game" subsection under the README scoreboard section, rewrites the Scope "hands" bullet around the ceiling+accelerator framing, and adds a matching note to `evals/SCOREBOARD.md`. Points at the incubating `distill-session-into-hand` idea as the cheap hand-authoring path.

  No package behavior changes.

- Updated dependencies [8ef332b]
- Updated dependencies [a8c2944]
- Updated dependencies [92590b0]
- Updated dependencies [fc4883e]
- Updated dependencies [e2707ef]
- Updated dependencies [5ed4a0e]
- Updated dependencies [10dc6c1]
  - @webhands/core@0.7.0

## 0.4.0

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

- 0cd09e7: Update the scope/positioning prose to be honest about the broadened verb surface: "capable, not a solver" (the "broaden the agent verb surface" prd, stories 15-16). webhands still ships NO captcha solver and NO provider key and still relies on the human one-time login/challenge-clear in `setup-profile`, but the verb surface is now rich enough that it no longer STANDS IN THE WAY of a capable agent that brings its OWN key.

  - README.md's _Scope and honesty_ bullet now reads "No login-bypass, no built-in CAPTCHA solver" and states the precise line: we do not solve it, we no longer stand in the way. It names both proven families (token-harvest via frame-aware `query` + `type` + callback; vision/tile via the Tier-4 `mouse`/`screenshot`/cross-origin read) and adds a bullet reaffirming the **hand** tier (`iamhuman` today) as the SIMPLER one-call path that coexists with the unaided verbs-only path.
  - CONTEXT.md gains a _Scope and honesty (capable, not a solver)_ section carrying the same line in the domain vocabulary, and its verb-list framing is refreshed to the verbs that actually shipped (Tier-1 reads + Tier-2/4 input/coordinate verbs).
  - The bundled `use-webhands` skill's "does not solve CAPTCHAs" line is updated consistently: the human-in-the-loop path stays the default for an ordinary wall, but a capable agent with its own key can self-solve with verbs (the exact `query`/`screenshot`/`mouse` commands), and a hand makes it one call.

  Docs/skill only: no product code changed, no overclaim (webhands ships no solver/key). The personal-use / own-session / own-IP framing and the `serve`-endpoint security note are preserved.

- Updated dependencies [8463db8]
- Updated dependencies [87114e3]
- Updated dependencies [8d7e3fe]
- Updated dependencies [55aece4]
- Updated dependencies [fe831f9]
- Updated dependencies [4ca6379]
- Updated dependencies [159ccec]
- Updated dependencies [039fc6e]
- Updated dependencies [58c981b]
  - @webhands/core@0.6.0

## 0.3.0

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

### Patch Changes

- Updated dependencies [9721479]
  - @webhands/core@0.5.0

## 0.2.0

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

### Patch Changes

- Updated dependencies [094a12b]
  - @webhands/core@0.4.0

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
