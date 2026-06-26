---
title: Hands — pluggable page capabilities over a capability-host primitive
slug: hands-pluggable-page-capabilities
needsAnswers: false
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

A user installs webhands so their agent can drive a browser. Then they need a capability webhands does not itself implement — e.g. solving a captcha (which needs page screenshots, coordinate clicks, and traversal into nested cross-origin frames — none expressible as a locator verb, and a real example, not the only one). Today there is **no way to plug that capability in.**

The deeper reason: webhands' own verbs (`navigate`, `snapshot`, `click`, `type`, `eval`, `wait`, `cookies`) are each, in the code, a function closing over the Node-side Playwright `page` — but that pattern is hardcoded as one monolithic object inside the transport, not exposed as something a third party can extend. And the public seam deliberately hands out only verbs + locator strings (ADR-0004), never the Node-side `page`, so an external capability that needs page-level operations has nowhere to attach. webhands' own `eval` runs INSIDE the page (`page.evaluate`) and clones results out by value — it is the in-page JS world, NOT the Node-side `page` object a page-level capability library needs. So even the existing escape hatch cannot host such a capability.

The result: webhands is fluent at agent-driven control but **closed to composition.** A user cannot bring a capability to it.

## Solution

Introduce **hands**: pluggable page-capability modules. A **hand** is in-process code that closes over the Page and contributes behavior (verbs and/or library logic) — exactly the shape webhands' own verbs already have, made explicit and pluggable.

- webhands' **built-in verbs become built-in hands** over a small **hand-host primitive** (the host hands a hand its Page access and composes the contributed verbs). This is the metaphor completed: webhands drives the browser with hands; now the hands are pluggable.
- A **third-party hand** (e.g. iamhuman captcha-solving) plugs into the SAME host the built-in hands use. The primitive is therefore **proven by self-application**: if it can express webhands' own `click`/`snapshot`, it can host anything.

**Two composition models, layered:**

- **Model A (foundation) — in-process page access.** The hand-host hands a hand the Node-side Playwright `page`. A hand like iamhuman's `PlaywrightDriver(page)` plugs straight in. The `page` NEVER crosses the public seam or a serialization boundary — it stays in-process, used by the hand. This is the primitive the rest builds on.
- **Model B (the user-facing pattern) — capability surfaced as an agent verb.** A hand's capability is exposed to the agent as a verb/MCP tool; webhands runs the hand against its own `page` internally and returns a serializable result. The agent never holds a `page`; it just gains a new tool. This is how the "user installed webhands, needs iamhuman" scenario actually resolves: they add iamhuman as a hand, and their agent gains its verb.

**Phased, to de-risk:**

- **Phase 1 — refactor webhands' own verbs into built-in hands over the host primitive.** Internal, behavior-preserving (existing verb tests stay green). Proves the primitive with zero new public surface. (Gated — open question #2.)
- **Phase 2 — open the host to third-party hands**, and load iamhuman captcha-solving as the first one, surfaced to the agent as a verb (Model B).

This **refines ADR-0003/0004, does not discard them:** the no-CDP/Chromium-only-leak rule STANDS (the Page API is cross-browser; only CDP-`attach` stays Chromium-bound). ADR-0004 said "speak Playwright locator semantics"; hands complete that by letting in-process capability code reach Page-level operations the locator verbs never exposed. A hand is offered by the Playwright transport; a transport that cannot perform page-level operations simply offers no hands (honest about its limits).

## User Stories

1. As a developer, I want to write a capability as a **hand** — a module that receives the Page and contributes verbs/behavior — so that I can extend webhands without forking it.
2. As a webhands maintainer, I want webhands' OWN verbs (`navigate`, `snapshot`, `click`, ...) implemented as **built-in hands** over a hand-host primitive, so that the primitive is proven by self-application and third-party hands use the exact same mechanism as the built-ins.
3. As a user who installed webhands for my agent, I want to add a third-party hand (e.g. iamhuman captcha-solving) and have my agent gain its verb, so that I can compose a capability webhands does not implement itself WITHOUT hand-wiring Playwright myself.
4. As a hand author who needs page-level operations (screenshot, coordinate mouse, nested `frameLocator`), I want my hand to receive the Node-side Playwright `page` in-process (Model A), so that I can perform operations the locator-only verb seam cannot express.
5. As an agent, I want a hand's capability exposed as a normal verb/tool that returns a serializable result (Model B), so that I can invoke it like any other verb without holding a live page handle.
6. As an integrator building a library, I want to compose a hand (e.g. iamhuman) in-process and pass it rich objects, so that capabilities webhands deliberately does not implement can be layered as ordinary Node modules.
7. As a maintainer, I want hands offered only by the Playwright transport (not promised by a neutral seam a non-page transport cannot honor), so that a transport which cannot do page-level operations honestly offers no hands rather than faking a capability floor.
8. As a maintainer, I want hands to stay cross-browser (work on Firefox-launched Playwright; only CDP-`attach` stays Chromium-only), so that ADR-0003's anti-CDP-coupling guarantee is preserved.
9. As a security-conscious operator, I want loading a third-party hand to be explicit and the page-access surface to stay on a local/trusted channel, so that composition does not widen remote attack surface.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** omitted. A human reviews and tasks this; no special human-only judgement beyond that.
- **`needsAnswers`: now false (resolved).** The hand contract & isolation (#1), the Phase-1 scope (#2), the serialization split (#3), and the terminology/security confirmations (#4, #5) were settled in interview and are folded into ## Implementation Decisions below. The Imperva/Playwright spike (#6) stays deferred and does not block (see the Deferred note below).

## Implementation Decisions

(Seed for tasking; trimmed by `to-task`. The six bullets below are the settled
resolutions of the prd's original open questions.)

- **What a hand receives + the isolation/trust model (resolved Q1).** A hand
  receives a scoped-but-LIVE hand-context shaped like `{pwPage, context,
  ensureOpen}`: the real Playwright `Page` and `BrowserContext` (Model A needs
  the live objects, e.g. iamhuman's `PlaywrightDriver(page)`), plus the
  lifecycle guard `ensureOpen()`. The `context` is carried for ALL hands (the
  built-in `cookies`/`setCookies` verbs prove some hands need it). A hand
  CONTRIBUTES named verbs + an optional `dispose`, and NOTHING more (no
  lifecycle hooks, no event handlers, no MCP-definition objects — that would be
  the platform the Out of Scope rejects). The trust model is STATED, not
  accidental: **zero isolation** between hands — all hands operate on one live
  page in one process and are trusted, local, in-process peers of the built-ins;
  a hand can break the session, which is accepted because loading a hand is
  explicit and local (see Q5). **Inter-hand reuse is supported as ordinary Node
  composition** (a hand `import`s and calls another module/hand directly),
  NOT via a host-provided sibling-hand registry in the context — the
  hand-context carries live page access only. Shared page-operation helpers
  (`clickLocator`, `resolveLocator`, `waitFor`, already exported by
  `playwright-launch-transport.ts`) stay importable building blocks so reuse
  lives in module-land. A `ctx.hands` registry is additive and non-breaking if a
  real need ever appears; not built now.
- **Phase 1 is a purely INTERNAL, behavior-preserving refactor (resolved Q2).**
  No change to `seam.ts` (the public `Page`/`Transport` contract is untouched);
  no behavior change, proven by the existing `test/` verb suite
  (`click-type-verbs`, `snapshot-verb`, `eval-verb`, `goto-wait-verbs`,
  `cookies-export-import`, `cross-invocation-session-persistence`, `seam`)
  staying green WITHOUT modification. The hand-host primitive and the
  `Hand`/`HandContext` types are **package-internal in Phase 1** (used to build
  the built-ins, not exported as a third-party extension point); they become
  public only in Phase 2. Built-in hands compose **eagerly at `makeSession`**,
  exactly as the page object is built today (no lazy registration, so no
  ordering effects). Therefore Phase 1 needs only a **lightweight
  internal-structure ADR** (or a note in the Phase-2 ADR), NOT a public-contract
  ADR; the public-contract ADR lands in Phase 2 when `Hand`/`HandContext` go
  public.
- **Serialization split: live handles stay in-process; agent verbs are
  serializable-only (resolved Q3).** A live Playwright object (`Page`,
  `Locator`, `ElementHandle`, `BrowserContext`) may flow ONLY within a single
  in-process call chain (Model A). The moment a value is returned to an
  AGENT-EXPOSED verb (anything that becomes an MCP tool / crosses RPC), it must
  be serializable under the **same structured-clone contract `Page.eval`
  already documents** in `seam.ts` (richer than JSON: preserves
  `NaN`/`BigInt`/circular-as-`[Circular]`; DOM nodes come back as opaque
  preview strings, never live handles). This is NOT a new constraint — it is the
  existing seam law (ADR-0003 no-leak; `eval`-style clone) extended verbatim to
  hand-contributed verbs; every built-in verb already obeys it. A hand may be
  both (in-process rich logic + a serializable verb facade); the hand owns the
  reduction at the boundary. Enforced by **convention + types** (not a blanket
  runtime clone — that would corrupt legitimate in-process Model A returns); a
  host-side runtime clone of agent-verb results is noted as available HARDENING
  if untrusted hands ever land. The rule is binding now; the MCP/RPC plumbing
  (Model B exposure) is **Phase 2** work above `core`, not Phase 1.
- **Terminology: `transport` / `verb` / `hand` are three orthogonal axes
  (resolved Q4).** `transport` (a.k.a. `driver`) = HOW we reach the browser
  (`Transport.open` → `Session`; one active per session; ADR-0003). `verb` = one
  agent-facing action on the page (a method on `Page`; built-in or
  hand-contributed, indistinguishable at the surface; ADR-0004). `hand` = a
  pluggable capability MODULE that closes over the Page (`{pwPage, context,
  ensureOpen}`) and contributes verbs and/or in-process behavior (many compose
  per session). Explicit coherence guards: **a hand is NOT a verb** (it can
  contribute several + in-process logic) and **a hand is NOT a transport** (it
  does not `open` sessions, does not reach the browser independently, gets the
  live Playwright page directly rather than a transport-neutral abstraction —
  which is why ADR-0003 is REFINED, not violated: the page stays in-process,
  never crosses the seam). Hands are offered ONLY by a transport that can hand
  over live page access (the Playwright transport; User Story 7). The glossary
  wording is pinned into `CONTEXT.md` ONLY when this prd is tasked (the term is
  `proposed` until then).
- **Security: local-only trust reaffirmed; third-party hand loading is explicit
  + declarative (resolved Q5).** A hand is **arbitrary Node code in the webhands
  process** — a strictly larger surface than `eval` (which is sandboxed to the
  page's JS world): a hand has whatever the process has (filesystem, network,
  env, `context.close()`, cookie rewrite, navigation hijack). The right mental
  model is npm supply-chain trust: **loading a hand == trusting an in-process
  npm dependency.** The trust boundary stays **local-only, no remote callers**
  (hands widen the IN-PROCESS trust surface, NOT the remote attack surface —
  they expose no new network listener). Loading a third-party hand is
  **explicit and declarative, modeled on pi's `packages[]`**: a config-named
  list of hand sources (`npm:<pkg>` / `git:<url>`) with **pinned entry points**,
  NEVER auto-discovery / `node_modules` scanning / convention-inferred entry
  files. **Install is separate from load/trust** (mirroring pi's separate
  `trust.json`): naming a hand in config IS the trust act; `npm install` alone
  never auto-loads. webhands does NOT build a managed installer (pi's `npm/`
  workspace equivalent) in this prd — operators install the dependency
  themselves; a managed install/update mechanism is deferred (same bucket as the
  distribution model in Out of Scope). No sandbox / no permission system
  (consistent with Q1's zero-isolation); gating = explicitness +
  documentation. Docs must state the trust level plainly (the truthful,
  scaled-up version of the README's `eval` warning).
- **Refines ADR-0003/0004** (new ADR at tasking); keeps no-CDP-leak;
  cross-browser via Playwright `Page`.

### Deferred (does NOT block this prd) — the Playwright/captcha spike (Q6)

Whether Playwright can reach + operate nested cross-origin frames (a WAF iframe
containing a captcha iframe) via `frameLocator(...).frameLocator(...)` +
coordinate clicks + screenshot is **left deferred and unresolved here.** The
hands design is decision-complete without it: the primitive is proven by
self-application (Phase 1), which does not depend on the captcha case. The spike
is a **throwaway, iamhuman-specific validation to run at Phase-2 entry** (if
Playwright cannot reach nested cross-origin frames, iamhuman's APPROACH needs
rethinking — an iamhuman risk, not a webhands risk). A spike failure would
falsify the **captcha EXAMPLE**, not the **hands abstraction**: webhands still
benefits (built-in hands, in-process composition, any non-captcha third-party
hand).

## Out of Scope

- **A broad "browser-app platform / portable standard."** The hands model ENABLES a future where third-party capabilities are a first-class ecosystem, but this PRD builds the in-process hand-host + first third-party hand, NOT a distribution model, a cross-runtime portability spec, an inter-hand permission system, or a manifest format. Named as a future direction the hands model enables, not built here.
- **A specific captcha implementation.** iamhuman captcha-solving is the first EXAMPLE hand and the Phase-2 proof; the captcha logic lives in iamhuman, not here.
- **Re-introducing CDP-only coupling.** Hands stay Playwright-`Page`-based (cross-browser); CDP-`attach` remains Chromium-only exactly as today.
- **A browser-extension transport.** A content-script transport cannot perform page-level pixel/coordinate/nested-cross-origin-frame operations (same-origin policy walls it from cross-origin child frames), so it cannot host page-level hands. The earlier `extension-transport` idea note was deleted for this reason.

## Further Notes

- The name fits the metaphor and does real work: webhands drives the browser with **hands**, and hands are now pluggable — built-in (`click`, `snapshot`) and third-party (a captcha-solving hand). A good abstraction names itself.
- This is the consistent completion of ADR-0004's bet (agents/code are Playwright-fluent): 0004 exposed locator semantics for that reason; hands let in-process capability code reach the rest of the Page surface that the locator fence left out.
- "Proven by self-application" is the core validation: refactoring webhands' own verbs onto the hand-host is what makes the primitive trustworthy before any third-party hand loads.
