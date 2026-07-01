---
title: '{ENV:NAME} placeholder substitution in verbs + .env loading via ldenv (with agent-facing advertisement)'
slug: env-placeholder-substitution-and-dotenv-loading
prd: distill-session-into-hand
blockedBy: []
covers: [7, 8, 9]
---

## What to build

A thin end-to-end capability: an agent can type a credential as an `{ENV:NAME}`
placeholder and webhands substitutes the real value from its OWN process env at
type-time, so the literal secret never appears in the tool-call (nor, later, in
the session verb trace or an emitted hand scaffold). This is the FOUNDATION task
the rest of the `distill` prd is `blockedBy`.

Three parts ship together (they are one capability, useless apart):

1. **Substitution.** Value-bearing verbs (at least `type`; audit the verb surface
   for any other verb that takes a caller-supplied VALUE that could be a
   credential) resolve an `{ENV:NAME}` token in the value against
   `process.env.NAME` at the moment the verb runs. A value with no `{ENV:...}` is
   typed VERBATIM (backward compatible). An UNRESOLVED `{ENV:NAME}` (env var
   unset/empty) FAILS LOUD with a typed, clear error, NEVER a silent empty type.
   The `{ENV:NAME}` grammar is webhands' OWN (do not adopt ldenv's `@@VAR` CLI
   syntax); ldenv is only the file loader in part 2.
2. **`.env` loading via `ldenv`.** The long-lived `serve` process loads `.env`,
   `.env.local`, `.env.<mode>` at startup using `ldenv`'s importable `loadEnv()`
   (package `ldenv`, it wraps dotenv + dotenv-expand and, by its own contract,
   lets a variable already present in the real environment WIN over a `.env` file).
   Result: `{ENV:PASSWORD}` resolves against a gitignored `.env.local` and NOT
   only the interactive shell. Where the browser is actually launched is where the
   env must be loaded (the process that reads `process.env` for substitution).
3. **Agent-facing advertisement (an unadvertised capability is an unused one).**
   The `type` verb's tool / `--help` DESCRIPTION states that a value may be
   `{ENV:NAME}` and that the agent SHOULD use it for credentials the operator put
   in the environment (so the agent handles secrets without reading them BY
   DEFAULT). AND the bundled `use-webhands` SKILL gains a short "handling sensitive
   info" rung: prefer `type '#pass' '{ENV:PASSWORD}'` over a literal; the operator
   supplies the value via env / `.env.local`; you never need to read it. Keep the
   skill text no-priming-clean (generic, no site selectors), matching the existing
   skill discipline.

Honest scope to preserve in the wording: `{ENV:NAME}` is HYGIENE, not a security
boundary. The substituted value still lands in the DOM and is readable back, and a
local agent can read the env itself; the point is not to hide the secret from the
agent (the context already trusts the agent) but to avoid gratuitously writing the
literal into the tool-call, the on-disk trace, and the reusable scaffold when a
placeholder works identically.

## Acceptance criteria

- [ ] `type '<locator>' '{ENV:PASSWORD}'` types the RESOLVED value of
      `process.env.PASSWORD` into the page.
- [ ] A value containing no `{ENV:...}` is typed verbatim (backward compatible;
      existing `type` behaviour unchanged).
- [ ] An unset/empty `{ENV:NAME}` FAILS LOUD with a typed, clear error (asserted),
      never a silent empty type.
- [ ] Every value-bearing verb that could carry a credential resolves `{ENV:NAME}`
      the same way (audit + cover the ones found, not just `type`).
- [ ] `serve` loads `.env` / `.env.local` / `.env.<mode>` via ldenv's `loadEnv()`:
      a var defined ONLY in a gitignored `.env.local` resolves in `{ENV:NAME}`.
- [ ] The operator's real shell env WINS over a `.env` file on a conflicting key
      (ldenv's documented priority), asserted by a test.
- [ ] The `type` verb description / `--help` mentions `{ENV:NAME}` and its
      credential use (asserted by a test that reads the description).
- [ ] The `use-webhands` skill contains the "handling sensitive info" rung and
      stays no-priming-clean (reuse the repo's existing skilled-reference-unprimed
      style of assertion; no selector-shaped fragment, no site URL).
- [ ] Tests cover the new behaviour (mirror the repo's existing verb/CLI test
      style).
- [ ] **Shared/global write isolation:** the `.env`-loading tests must NOT read
      the developer's real home/cwd `.env` files nor mutate the real
      `process.env` in a way that leaks across tests. Point ldenv at a TEMP env
      directory / fixture and restore `process.env` after each test; assert the
      real environment is untouched. State the mechanism in the test (which dir
      ldenv resolves from, and whether the substitution reads env in-process or in
      a child, since that decides whether overriding a child's env is enough or the
      test process's own `process.env` must be set/restored).

## Blocked by

- None. Can start immediately. (Every other task in the `distill-session-into-hand`
  prd is `blockedBy` THIS task.)

## Prompt

> Build `{ENV:NAME}` placeholder substitution for webhands' value-bearing verbs
> plus `.env` loading via the `ldenv` package, and advertise the capability to the
> agent (verb description + `use-webhands` skill). This is the foundation the
> `distill` prd (`work/prds/tasked/distill-session-into-hand.md`) depends on: it is
> what keeps a later session verb-trace and emitted hand scaffold free of literal
> secrets.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm how the CLI defines verbs today (the `incur`-based command
> definitions in the cli package, where `type` takes a `text` value), where the
> browser is actually launched / where `serve` owns the long-lived process (ADR-0005),
> and how the bundled skill (`use-webhands`) and its no-priming assertions are
> structured. If a dependency or ADR has changed an assumption here, route to
> needs-attention with the discrepancy rather than building on the stale premise.
>
> Domain vocabulary: a **verb** is one CLI/incur command acting on the live page;
> `serve` owns the ONE long-lived browser (ADR-0005); the value the agent passes to
> `type` currently lands in the page verbatim. The NEW `{ENV:NAME}` grammar is
> webhands' own (do NOT use ldenv's `@@VAR` CLI syntax); `ldenv` is used ONLY as an
> importable `.env` loader (`import { loadEnv } from 'ldenv'`, it wraps dotenv +
> dotenv-expand and honours the real env over files). Add `ldenv` as a dependency
> of the package that launches the browser.
>
> Seams to test at: the verb layer (does `type` resolve/refuse `{ENV:NAME}`
> correctly?), the env-loading step (does a `.env.local`-only var resolve, and does
> real env win?), and the descriptions/skill (are they actually advertised?). Keep
> env-loading tests ISOLATED (temp env dir, restore `process.env`) and assert the
> real environment is untouched.
>
> RECORD non-obvious in-scope decisions (a new error/exit code for the unresolved
> placeholder, exactly which verbs count as value-bearing, whether substitution is
> in-process or in a child), as a `## Decisions` note in the done record, or an ADR
> if it meets the ADR gate (hard to reverse + surprising + a real trade-off). An
> un-recorded in-scope decision is a review finding.
>
> Every change requires a changeset (`pnpm changeset`).
