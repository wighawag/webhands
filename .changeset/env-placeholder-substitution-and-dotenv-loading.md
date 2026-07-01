---
'@webhands/core': minor
'webhands': minor
---

Add `{ENV:NAME}` placeholder substitution for value-bearing verbs plus `.env` loading via `ldenv`, and advertise the capability to the agent. This is the foundation the `distill` work depends on: it keeps a value the agent types (and a later verb-trace / emitted hand scaffold) free of literal secrets, while the real value still reaches the page.

- **`{ENV:NAME}` substitution in `type` (webhands' OWN grammar, not ldenv's `@@VAR`).** The value-bearing `type` verb resolves an `{ENV:NAME}` token against `process.env.NAME` at type-time, in the SERVED controller process (where the env is loaded). A value with no `{ENV:...}` is typed VERBATIM (backward compatible). An UNSET or EMPTY variable fails LOUD with a typed `UnresolvedEnvPlaceholderError` (code `unresolved-env-placeholder`), never a silent empty type. Exposed as `substituteEnvPlaceholders` / `hasEnvPlaceholder` from `@webhands/core`.
- **`.env` loading via ldenv at `serve` startup.** The long-lived `serve` process loads `.env` / `.env.local` / `.env.<mode>` via ldenv's importable `loadEnv()` before the browser opens (the process that launches the browser and reads `process.env` for substitution), so `{ENV:PASSWORD}` resolves against a gitignored `.env.local` and not only the interactive shell. The operator's real shell env WINS over a `.env` file on a conflicting key (ldenv's documented priority). Exposed as `loadWebhandsEnv` from `@webhands/core`; `ldenv` is added as a `@webhands/core` dependency.
- **Agent-facing advertisement.** The `type` verb's tool / `--help` description now states a value may be `{ENV:NAME}` and that the agent should use it for credentials the operator put in the environment. The bundled `use-webhands` skill gains a "handling sensitive info" rung (prefer `type '#pass' '{ENV:PASSWORD}'` over a literal; the operator supplies the value via env / `.env.local`; you never read it), kept no-priming-clean.

Honest scope: `{ENV:NAME}` is HYGIENE, not a security boundary. The substituted value still lands in the DOM and is readable back, and a local agent can read the env itself; the point is only to avoid gratuitously writing a literal credential into the tool-call and the on-disk artifacts when a placeholder works identically.
