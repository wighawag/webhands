# The agent-capability eval harness lives OUTSIDE `packages/*` and OWNS the serve lifecycle

The capability eval harness (prd `agent-capability-eval-harness`) lives in a
top-level `evals/` workspace member, deliberately NOT under `packages/*`, so the
repo gate (`pnpm test` = `pnpm --filter './packages/*' test`, and likewise
`build`) is STRUCTURALLY unable to reach its live-site path: a flaky third-party
site can never red the build. It is still a pnpm workspace member (so it can
`import` `webhands`/`@webhands/core` and install its own deps), but it has its
OWN runner command (`@webhands/evals` `run-eval`) and its own self-test command
(`self-test`); neither is wired into any `packages/*` `test` script. The harness
also OWNS the `serve` session lifecycle around each eval: per ADR-0005 a verb
with no live `serve` errors and never auto-spawns, so the harness shells out to
the published `serve`/`stop` verbs against an ISOLATED `WEBHANDS_HOME` temp root
(endpoint + profile + screenshots there, never the real `~/.webhands`),
forwarding the existing `--profile`/`--proxy`/`--stealth` options unchanged.

## Considered Options

- **A `packages/*` member whose `test` the gate fans out to** — REJECTED: the
  gate would then run the live-site evals, exactly the flakiness we must keep
  out. Non-gating would be a convention, not a structural fact.
- **A separate repo** — REJECTED for v1: it could not `import` the workspace
  packages directly nor share the `startFixtureServer`-style local-fixture
  approach, and it splits the project for no v1 benefit.
- **The harness auto-spawning its own browser instead of driving `serve`** —
  REJECTED: it would fork ADR-0005's explicit-lifecycle model and bypass the
  real agent-facing surface (the published `serve` + verb path).

## Consequences

- The gate-testable D3 machinery self-test is deterministic and local-fixture
  by nature, but it runs under `evals/`'s OWN vitest (the `self-test` script),
  NOT `pnpm test`: even the harness's own self-test is kept out of the gate so
  no eval path can creep into `verify`.
- The `--filter './packages/*'` path glob is now load-bearing for the
  non-gating guarantee: moving `evals/` under `packages/` would silently pull
  it into the gate. The exclusion is asserted structurally (the filter selects
  only `@webhands/core` + `webhands`).
- The harness adds NO new verb and no private back door: it drives the SAME
  `webhands <verb>` surface a real agent uses, against an isolated home.
