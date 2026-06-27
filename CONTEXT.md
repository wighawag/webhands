# CONTEXT — webhands domain language

The domain glossary for `webhands`. Agents and skills use THIS vocabulary when naming modules, tests, and discussing the system. Architectural rationale lives in `docs/adr/` (decisions); product framing lives in `work/prds/`.

## What webhands is

A CLI (built with [`incur`](https://github.com/wevm/incur), so it doubles as an MCP server) that drives a real, persistent browser via Playwright, letting an agent or human control any website from a genuinely logged-in browser session. It launches or attaches to a Chromium/Firefox instance using a dedicated profile, supports a headed login pass that is later reused headless, and exposes verbs (`goto`, `snapshot`, `click`, `type`, `eval`, `cookies`). A `core` package holds the browser-control logic plus a transport seam (CDP/Playwright now, a content-script browser extension later); a `cli` package wraps `core` with `incur`.

## Core domain terms

- **controller** — the long-lived process (the CLI/`core`) that owns the connection to a browser and issues verbs against a page. The browser is attached TO; the controller holds the control loop (chosen because MV3 extension service workers cannot reliably hold a long-lived loop).
- **driver / transport** — the seam between `core`'s verbs and the actual browser. v1 transport is Playwright (launch a dedicated profile, or `connectOverCDP` to a running Chromium). The seam is defined so a future **extension transport** (a browser extension content-script bridge) can slot in without changing the verb surface. The seam must NOT leak CDP/Chromium-only types (CDP-attach is Chromium-only; Firefox attaches differently). Element addressing is **Playwright-equivalent**: verbs accept a raw Playwright locator string, so "transport-neutral" means any transport must offer Playwright-grade addressing (see `docs/adr/0003`+`0004`).
- **profile** — a dedicated browser user-data directory the controller owns (NOT the user's daily Chrome profile, which Chrome policy now refuses to automate). State (cookies, logins, challenge clearance) persists here across runs.
- **setup-profile** — the headed verb: open the dedicated profile in a visible browser so a human logs in / clears any anti-bot challenge ONCE; later `launch --headless` reuses that saved state.
- **launch** — start a browser the controller spawns (headed or headless) against the dedicated profile.
- **attach** — connect the controller to a browser the USER already started (e.g. Chrome with remote debugging enabled), reusing live logged-in tabs.
- **verb** — one CLI command / `incur` command that acts on the attached page: `goto`, `snapshot` (accessibility tree + text, cheap for an agent to read), `click`, `type`, `eval`, `wait`, `cookies` (export/import).
- **hand** — a capability MODULE that closes over the WebHandsPage and contributes verbs. Given a scoped-but-live hand-context `{pwPage, context, ensureOpen}` (the live Playwright `Page`, the `BrowserContext`, and the per-session lifecycle guard), a hand returns named verbs plus an optional `dispose`. webhands' own eight verbs are themselves built-in hands composed over an internal **hand-host** primitive (proven by self-application). `hand` is a THIRD axis orthogonal to `transport` and `verb`: a **transport** is HOW we reach the browser, a **verb** is one agent-facing action, a **hand** is a capability module closing over the WebHandsPage. Guards: a hand is **NOT a verb** (one hand may contribute several verbs plus in-process logic); a hand is **NOT a transport** (it does not `open` sessions — it gets the live Playwright page directly). Hands are offered only by a transport that can hand over live page access (the Playwright transport); a transport that cannot do page-level operations offers no hands. Hands are trusted, local, in-process peers with ZERO isolation. As of Phase 2 the `Hand`/`HandContext` contract is PUBLIC (exported from the package entry point) and a third-party hand loads ONLY when explicitly NAMED in `<home>/hands.json` with a PINNED entry point (modeled on pi's `packages[]`): no auto-discovery, no `node_modules` scan, no convention-inferred entry. Loading a hand == trusting an in-process npm dependency (a strictly larger surface than the page-sandboxed `eval`); naming a hand in config IS the trust act, separate from install. See `docs/adr/0006` (Phase-1 internal hand-host) and `docs/adr/0007` (Phase-2 public contract + explicit-declarative loading + trust framing); both refine `0003`/`0004`.
- **extension transport (deferred)** — the phase-2 stealth fallback: a Chrome/Firefox extension content-script that reads/drives the page with zero automation fingerprint, bridged to the controller. Designed-for via the transport seam; NOT built in v1. To qualify as a fallback it must offer Playwright-equivalent element addressing (the capability floor set by `docs/adr/0004`).
- **incur** — the CLI framework (`Cli.create().command().serve()`) the `cli` package uses; it provides MCP (`--mcp` / `mcp add`), agent skills, TOON output, and JSON-schema'd I/O for free, so the same binary serves both humans and agents.
- **promptGuidance** — the per-repo NUDGE namespace in `.dorfl.json` whose members (currently just `testFirst`) strengthen the wording in the worker's in-band prompt. NOT a gate: the `verify` step is still the only acceptance bar. Omitted ⇒ off; absence is the default.
- **work/ contract** — the on-disk system this repo uses, defined by the reference docs in **`work/protocol/`** (copied here by `setup`): `WORK-CONTRACT.md` (the contract), `CLAIM-PROTOCOL.md`, `REVIEW-PROTOCOL.md`, `task-template.md`, `prd-template.md`, `ADR-FORMAT.md`. Three REGIME umbrellas — `notes/` (capture buckets), `tasks/` (the build board), `prds/` (the prd lifecycle) — plus top-level `questions/` and `protocol/`. One markdown file per item, status = the folder it lives in (never a field). Capture buckets: `notes/ideas/` (proposed), `notes/observations/` (spotted, unverified, append-only), `notes/findings/` (verified external/domain ground truth, each with a `source:`). ADRs (`docs/adr/`, format in `work/protocol/ADR-FORMAT.md`) record what WE decided and why.

## Conventions

Standing per-change rules agents must follow in this repo.

- Every change requires a changeset (`pnpm changeset`). For enforcement, wire a check (e.g. `changeset status --since=main`) into the `.dorfl.json` `verify` gate.

## Skills this repo uses

- Required: `setup` (onboarding/migration), `to-prd`, `to-task`.
- Recommended: `review`, `grill-me`.
