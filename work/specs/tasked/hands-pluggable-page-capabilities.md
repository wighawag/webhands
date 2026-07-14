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

> Tasked — detail moved out. The six resolved open questions (the hand contract
> & isolation, Phase-1 internal scope, the serialization split, terminology, and
> the security/loading model) and the deferred captcha spike now live in the
> task files under `work/tasks/` (slugs `hand-host-primitive-and-builtin-hands`,
> `phase1-internal-structure-adr`, `third-party-hand-loading-and-public-api`,
> `agent-exposed-hand-verb-over-rpc`, `iamhuman-captcha-hand-first-thirdparty`).
> The durable WHY is recorded in `docs/adr/` (the Phase-1 internal-structure ADR
> and the Phase-2 public-contract ADR those tasks write). This prd is now its
> durable framing only.

## Out of Scope

- **A broad "browser-app platform / portable standard."** The hands model ENABLES a future where third-party capabilities are a first-class ecosystem, but this PRD builds the in-process hand-host + first third-party hand, NOT a distribution model, a cross-runtime portability spec, an inter-hand permission system, or a manifest format. Named as a future direction the hands model enables, not built here.
- **A specific captcha implementation.** iamhuman captcha-solving is the first EXAMPLE hand and the Phase-2 proof; the captcha logic lives in iamhuman, not here.
- **Re-introducing CDP-only coupling.** Hands stay Playwright-`Page`-based (cross-browser); CDP-`attach` remains Chromium-only exactly as today.
- **A browser-extension transport.** A content-script transport cannot perform page-level pixel/coordinate/nested-cross-origin-frame operations (same-origin policy walls it from cross-origin child frames), so it cannot host page-level hands. The earlier `extension-transport` idea note was deleted for this reason.

## Further Notes

- The name fits the metaphor and does real work: webhands drives the browser with **hands**, and hands are now pluggable — built-in (`click`, `snapshot`) and third-party (a captcha-solving hand). A good abstraction names itself.
- This is the consistent completion of ADR-0004's bet (agents/code are Playwright-fluent): 0004 exposed locator semantics for that reason; hands let in-process capability code reach the rest of the Page surface that the locator fence left out.
- "Proven by self-application" is the core validation: refactoring webhands' own verbs onto the hand-host is what makes the primitive trustworthy before any third-party hand loads.
