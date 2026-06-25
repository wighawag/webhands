---
title: Browser Controller CLI (control any website from a real browser session)
slug: browser-controller-cli
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks.

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
  While the spec has unresolved questions blocking autonomous tasking:
    1. Set `needsAnswers: true` in the frontmatter above.
    2. List the questions under the `## Open questions` heading below.
    3. Clear the flag (and let apply strip this block) once they are answered.
  Delete the whole fenced block — markers and all — if the prd launches fully resolved.
-->

## Open questions

1. **Browser-binary install policy.** Should `prepare` (or a first-run check) run `pnpm exec playwright install chromium`, or is browser-binary installation a separate manual step the user runs once? (Default assumption: separate; `setup-profile`/`launch` print a clear error with the install command if the binary is missing.)
2. **Firefox in v1 or deferred?** The transport seam must not assume CDP (CDP-attach is Chromium-only). But do we ship a working Firefox `launch`/`setup-profile` path in v1, or only design the seam and ship Chromium first? `attach` over CDP is Chromium-only regardless; Firefox attach would need a different mechanism (Playwright Juggler / `launchPersistentContext`). (Default assumption: Chromium-complete in v1, Firefox seam-ready but not shipped.)
3. **`snapshot` output shape.** Playwright accessibility-tree snapshot, a trimmed DOM/text extract, or both behind a flag? What is the token-cheap default an agent reads? (Default assumption: accessibility-tree + visible-text, with a `--full` for raw DOM.)
4. **Element addressing for `click`/`type`.** CSS selector only, or also Playwright-style role/text locators and/or the stable ref-ids emitted by `snapshot` (so the agent clicks `e5` from the snapshot)? (Default assumption: accept CSS selector AND snapshot ref-ids.)
5. **`attach` connection UX.** Do we require the user to start Chrome with `--remote-debugging-port` themselves, or does the CLI offer a helper to relaunch their Chrome with debugging enabled? (Chrome refuses to automate the default profile, so attach realistically targets a user who opted in.)

<!-- /open-questions -->

## Problem Statement

Sites like Kayak and Skyscanner (and most logged-in web apps without an API) cannot be read by a plain HTTP fetch: they render client-side, sit behind anti-bot systems, and gate content behind a session. An agent in a CLI/terminal has no way to act on such a page. The user wants a reusable tool that lets an agent (or themselves) drive *any* website from a **real, already-trusted browser session** on their own machine and IP, getting structured page content back and issuing actions (navigate, click, type, read).

The naive approaches fail: copying a cookie into a fetch breaks because clearance is bound to a TLS/browser fingerprint, not just an IP; a plain Playwright launch presents as automation and is challenged. The robust answer is to operate a *real* browser the user has logged into once, with the long-lived control loop owned by a CLI process (not by an MV3 extension service worker, which the browser kills every 30s/5min).

## Solution

A pnpm-monorepo TypeScript project producing a CLI, `my-browser-controller`, built with `incur` so the same binary is also an MCP server and agent-discoverable skill set. It drives a real browser via Playwright in two modes:

- **launch** — the CLI spawns a browser (headed or headless) against a **dedicated profile directory** it owns (never the user's daily Chrome profile, which Chrome policy refuses to automate). State persists across runs.
- **attach** — the CLI connects (`connectOverCDP`, Chromium-only) to a browser the user already started with remote debugging enabled, reusing their live logged-in tabs.

A **`setup-profile`** verb opens the dedicated profile headed so the user logs in / clears any challenge ONCE; subsequent `launch --headless` runs reuse that saved cookies/state. On top of either mode, the controller exposes page verbs: `goto`, `snapshot`, `click`, `type`, `eval`, `wait`, `cookies`.

The code is split: **`packages/core`** holds the browser-control logic behind a **transport/driver seam** (Playwright transport in v1; a future browser-extension content-script transport designed-for but not built); **`packages/cli`** wraps `core` with `incur`. Kayak is the smoke-test target, not a hardcoded feature.

## User Stories

1. As a user, I want to run `my-browser-controller setup-profile` and have a visible browser open on a dedicated profile, so I can log into a site (and pass any anti-bot challenge) once.
2. As a user, I want that profile's cookies/state to persist on disk, so later headless runs reuse my logged-in session without re-login.
3. As an agent, I want to run `launch --headless` against the saved profile, so I can operate the site unattended after the human did the one-time login.
4. As an agent, I want `launch --headed` so a human can watch/intervene during development or a tricky flow.
5. As a user, I want `attach` to connect to my own already-running Chrome (remote-debugging enabled), so the controller reuses my live tabs, real fingerprint, and IP.
6. As an agent, I want `goto <url>` to navigate the active page and wait for it to settle, so subsequent reads see rendered content.
7. As an agent, I want `snapshot` to return a token-cheap, structured view of the page (accessibility tree + visible text) with stable element refs, so I can understand the page and decide what to click without parsing raw HTML.
8. As an agent, I want `click <ref|selector>` and `type <ref|selector> <text>` to act on elements, including handling hidden custom inputs (dispatch click) where a normal click would time out.
9. As an agent, I want `eval <js>` to run JavaScript in the page context and get the result, as an escape hatch when a verb does not cover a case.
10. As an agent, I want `wait` (for a selector, navigation, or timeout) so I can pace actions like a human and let XHR-rendered prices load.
11. As a user, I want `cookies export` / `cookies import` so I can move or back up a session, or seed a profile.
12. As an agent, I want every command's output to be structured (incur's TOON/JSON envelope with a declared output schema), so I can chain commands without parsing heuristics.
13. As an agent, I want command call-to-actions (incur `cta`) suggesting likely next verbs after each run, so I can chain navigate → snapshot → click without extra prompting.
14. As an agent or human, I want the CLI to be registerable as an MCP server (`mcp add` / `--mcp`) and to emit a skills/`--llms` manifest, so it is auto-discoverable, with no bespoke MCP code to maintain.
15. As a maintainer, I want the browser-control logic in `core` behind a transport seam, so a future browser-extension transport (zero automation fingerprint) can be added without changing the verb surface.
16. As a maintainer, I want the seam to NOT assume CDP, so a non-Chromium (Firefox) transport can be added later.
17. As a user, I want clear errors when a browser binary is missing or a profile is not set up, telling me the exact command to fix it.
18. As a user, I want a documented humility note that driving these sites can violate their ToS and is intended for personal use on my own session, so the project's scope is honest.
19. As a developer, I want to smoke-test the whole pipe against Kayak (setup-profile → launch headless → goto a search → snapshot results), so I have a concrete end-to-end proof.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** NOT set on this prd. Tasking can be agent-driven once the open questions are resolved. (Individual tasks that touch login/credentials or destructive profile handling may carry their own `humanOnly`, decided by the tasker per task — this prd flag does not pre-set them.)
- **`needsAnswers`: true.** The five open questions above (binary-install policy, Firefox scope, snapshot shape, element addressing, attach UX) shape task boundaries; resolve them (the defaults in each are reasonable to accept) before auto-tasking, or task manually accepting the defaults.

## Implementation Decisions

- **Monorepo from `template-typescript-lib`**: pnpm workspace (`packages/*`), ESM, `tsc` build, `vitest`, `prettier`, changesets, `ldenv`, tabs indentation. Two packages: `packages/core`, `packages/cli`.
- **`core`** exposes a `Driver`/`Transport` interface (the seam): `open(profile|attachTarget) → Session`, and a `Page` abstraction with the verb operations. v1 concrete transport = Playwright. The interface is defined in terms of high-level verbs (navigate, snapshot, click, type, eval, wait, cookies), NOT in terms of CDP, so an extension transport or a Firefox transport can implement it.
- **Profile management**: a dedicated user-data dir under a config location (e.g. `~/.my-browser-controller/profiles/<name>`), launched via Playwright `launchPersistentContext`. Never point at the OS default Chrome profile (Chrome policy refuses it).
- **attach** = Playwright `chromium.connectOverCDP(endpoint)`, reusing `browser.contexts()[0]` (the existing authenticated context) — NOT `newContext()`. Chromium-only; documented as such.
- **`cli`** = `incur` `Cli.create('my-browser-controller', …).command(…).serve()`, one command per verb plus `setup-profile`/`launch`/`attach`, each with a zod `args`/`options`/`output` schema. MCP and skills come from incur for free.
- **Stealth posture**: rely on being a *real* browser/profile/IP rather than fingerprint-spoofing. Note in docs that the classic CDP "console getter" detection broke in V8 (May 2025), so CDP-attach is currently low-risk, but multi-layer detection still exists; the extension transport is the future stronger-stealth path.
- **A session/daemon question** is implicit: verbs need a persistent browser between CLI invocations. Likely a long-lived `core` browser process the CLI talks to (incur can also serve the CLI over fetch, exposing the verbs as an HTTP/MCP endpoint, which naturally hosts the long-lived browser). Exact mechanism (background daemon vs. `incur` serve) is a task-level design decision seeded here.

## Testing Decisions

- **Highest seam = the `core` `Driver` interface**, exercised against a real local Playwright browser hitting a controlled local fixture page (deterministic), asserting verb behaviour (navigate, snapshot shape, click effect, type, eval result, cookie round-trip, profile persistence across relaunch).
- A separate, non-CI **manual smoke** against Kayak (live, flaky, not a gate) documents the end-to-end pipe.
- CLI-level tests assert incur wiring: schemas, output envelope, MCP/`--llms` manifest presence.
- Avoid asserting on real third-party DOM in automated tests (it rots); use local fixtures for behaviour, reserve live sites for manual smoke.

## Out of Scope

- The browser-extension transport (Chrome/Firefox content-script bridge). Designed-for via the seam; built later. Capture as a `work/notes/ideas/` item once tasked.
- Fingerprint spoofing / anti-detect browser builds / proxy rotation (we lean on being a real session).
- Multi-session orchestration / parallel browsers (single active session in v1).
- A hosted/remote service (this is a local tool on the user's machine and IP, by design).
- Bypassing login or solving CAPTCHAs programmatically (the human does the one-time login in `setup-profile`).

## Further Notes

- Reference projects in the same account for house style: `template-typescript-lib` (scaffold), `playwright-browser-harness` (Playwright packaging conventions only — NOT a dependency or design base, per maintainer).
- `incur` docs: https://github.com/wevm/incur — API is `Cli.create()/.command()/.serve()`, with `mcp add`, `skills add`, `--llms`, `--mcp`, TOON output, zod schemas, `cta`, middleware, `cli.fetch` (serve-as-API + `/mcp`).
- ToS honesty: driving Kayak/Skyscanner is against their terms; scope is personal use of one's own authenticated session on one's own machine.
