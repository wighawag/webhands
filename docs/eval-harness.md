# The agent-capability eval harness (the SCOREBOARD, not the gate)

This is the **capability scoreboard**: a repeatable, **opt-in** harness that
hands an unaided agent a high-level natural-language goal on a real, unfamiliar,
multi-step site and mechanically checks whether the agent reached the goal. It
**MEASURES** how far webhands' agent-facing surface gets a capable agent on real
sites; it does not gate correctness.

It is deliberately **SEPARATE** from the deterministic correctness GATE
(`pnpm format:check && pnpm build && pnpm test`, the `verify` step). The gate
runs against **local fixtures only** and proves the verbs work mechanically in
isolation. This harness proves the next thing up: that an agent can **COMPOSE**
those verbs to accomplish a real job on a site it has never seen and was given no
script for, and it catches the "works on a clean fixture, fails on a messy real
DOM" regression that local fixtures structurally cannot reveal. Both matter; they
answer different questions. (Background: ADR-0002, the README *Scope and honesty*
note, and the manual [`manual-smoke-kayak.md`](manual-smoke-kayak.md), the
closest prior art for the "manual / live by nature, not a gate" stance.)

The unit is an **eval** = `{goalPrompt, endStateAssertion, milestones[]}` run
against a real (preferably sandbox) site. The agent's PATH is free (it discovers
the site live); only the END STATE is checked, by the **harness**, via webhands'
own read verbs. That is how the harness stays deterministic despite a
non-deterministic agent.

## Manual by nature, NON-GATING, and never in `pnpm test`

These evals are **opt-in and live by nature**, the same stance as the manual
Kayak smoke ([`manual-smoke-kayak.md`](manual-smoke-kayak.md)): a real
third-party site rots, rate-limits, and goes down, so **a flaky external site
must NEVER red the build.** They are run **manually or on a schedule**, never on
every change.

This is **structural**, not just a promise:

- The gate is `pnpm test` = `pnpm --filter './packages/*' test` (see
  `package.json`). The harness lives in the top-level **`evals/`** directory,
  **OUTSIDE `packages/*`**, so the gate's filter cannot fan out to it. (`evals/`
  is a workspace member only so its deps install and it can import `webhands` /
  `@webhands/core`; see the comment in `pnpm-workspace.yaml`.)
- The live-site harness has its **own runner command** (below), wired into no
  `packages/*` `test` script.
- The only gate-testable part is the **deterministic self-test** (the D3
  machinery proof), which runs against a **local fixture page**, never a real
  site. It is `@webhands/evals`'s own `self-test` script and is a machinery check,
  not a capability subject (it is **primed by construction**, so a green self-test
  is never a capability pass).

If you ever want to enforce the non-gating-ness mechanically, assert that running
the gate does not launch any live-site eval; the directory split above is what
makes that true.

## How to run an eval

The harness drives webhands through its **existing surface** (the
`npx webhands <verb>` CLI path the README leads with). It adds **no new verbs**
(see *The missing-verb-as-FINDING convention* below). It also owns bringing a
`serve` session up around an eval and tearing it down after (ADR-0005), against a
warmed, dedicated profile, honoring the existing `--proxy` / stealth options.

Run **one** eval against a **real agent** (the generic shell adapter, the v1
"agent-under-test" launch seam):

```sh
pnpm --filter @webhands/evals run-eval \
  --eval <id> \
  --agent-cmd "<command that launches your unaided agent>" \
  [--model <model>] \
  [--webhands "<how to invoke webhands>"] \
  [--max-attempts <n>]
```

- `--eval <id>` selects a catalogue entry (one `*.eval.ts` file per eval). Run
  with `--help` for the registered ids (Tier-1 `saucedemo-core-flow` /
  `saucedemo-discovery`, Tier-2 `parabank-transfer`, Tier-3 `magento-checkout`).
- `--agent-cmd "<cmd>"` is the shell command that launches the unaided agent; the
  **goal-prompt is fed on its stdin**. Any agent invocable as a shell command
  plugs in (`claude -p`, `pi --print`, …). Use `{model}` in the command for
  model-pinning (dorfl's substitution pattern) and pass `--model` to fill it.
- `--webhands "<cmd>"` overrides how webhands is invoked (default: `npx webhands`).
- `--max-attempts <n>` bounds the retries on INCONCLUSIVE (default 3); a genuine
  FAIL is never retried.

The DETERMINISTIC machinery proof is the **separate** self-test (it does **not**
launch a real agent or touch a real site):

```sh
pnpm --filter @webhands/evals self-test
```

## How to read a result

A run prints one line and exits with a routable code:

```
<id> [<tier>] -> <PASS|FAIL|INCONCLUSIVE> (milestones <reached>/<total>: <ids…>) [<reason>]
```

Three things to read:

1. **The binary verdict (PASS / FAIL).** PASS iff **every** end-state check
   passed, decided by the **harness** reading the live page with webhands' own
   read verbs (`query` / `snapshot` / `exists` / `count` / `getAttribute`), **not**
   by trusting the agent's "I'm done". The agent's self-report only TRIGGERS the
   check; a hallucinated "done" cannot pass an eval.

2. **The milestones (partial credit).** `reached/total` plus the ordered ids the
   agent got to (e.g. `reached-login, reached-cart`). Milestones are ordered and
   the score is the **longest reached prefix**, the natural reading of "how far
   did the agent get", so a near-miss is a useful capability signal and not a flat
   fail.

3. **The third state: INCONCLUSIVE (the crucial distinction).** A non-PASS is
   **not** automatically a capability FAIL. Before scoring a FAIL the harness runs
   a cheap **site-health precheck** (the entry URL loads, an expected landmark is
   present):

   - **healthy site, end state not reached → FAIL** (a genuine agent failure;
     never retried).
   - **unhealthy site (down / rate-limited / structurally changed) →
     INCONCLUSIVE** (retried a bounded number of times; the bracketed reason names
     the failed probe).

   So an external-site outage shows up as INCONCLUSIVE, **never** as a false
   capability regression. (Example: the Cloudflare-fronted Magento demo can be
   hard-down; that surfaces as INCONCLUSIVE, the signal to widen the run interval,
   not a red scoreboard. See
   `work/notes/findings/magento-demo-tier3-stability.md`.)

Exit codes mirror the three states for a scheduler: **0** = PASS, **1** = FAIL,
**2** = INCONCLUSIVE (and **3** = the runner itself crashed).

## The no-priming rule

What makes this a **capability** eval and not a scripted test is that the
agent-under-test receives **EXACTLY** the goal-prompt text **+ the verb-surface
reference, and nothing else**: **no selectors, no step list, no site URLs beyond
the one entry point named in the goal.** It is pointed at the verb surface only
(`npx webhands --llms-full` / `npx webhands <verb> --help`) and left to discover
the site live, the way a person would by hand.

This is **enforced as code, not a guideline**: the harness assembles agent input
in exactly one place and runs a priming guard first, which **refuses** a
goal-prompt that carries a selector-shaped fragment or names any URL other than
the eval's declared entry URL. A primed eval throws before any agent or `serve`
is launched. (The deterministic self-test is primed by construction and never
passes through this guard, which is exactly why it can never masquerade as a
capability pass.)

## The missing-verb-as-FINDING convention

The harness adds **NO new verbs**: the surface is complete for measuring. So when
running an eval reveals that a verb is **missing**, or that a verb works on a
clean fixture but **breaks on a messy real DOM**, that is **a FINDING, not a
change here.** Specifically:

- It does **NOT** become a new verb added to the harness, and it does **NOT**
  become a behaviour change to this harness. The harness stays a **measurement
  tool**, not a surface change.
- It **DOES** become a note in **`work/notes/findings/`** per the work/ contract,
  carrying a **`source:`** that records how it was observed (which eval, on which
  site, what failed), and **possibly the seed of a future surface PRD**.

This keeps the scoreboard honest: the harness reports the gap; the gap is fixed
(if at all) by a deliberate, separately-reviewed change to the **verb surface**,
not by quietly editing the thing that measures it.

## WebArena (a FUTURE benchmark suite, out of scope)

[**WebArena**](https://webarena.dev) is recorded as a **FUTURE** full,
self-hosted benchmark suite, **out of initial scope**. The ambition (a richer,
standardized, self-hosted benchmark of realistic web tasks) is captured here so it
is not lost, without bloating v1's hand-curated tiered catalogue. It is **not** a
standing eval today; integrating it is a separate, future decision. See
`work/notes/ideas/webarena-future-benchmark-suite.md`.

## ToS / authorized-target framing

Consistent with [`adr/0002`](adr/0002-real-session-over-fingerprint-spoofing.md)
and the README *Scope and honesty* note:

- **Prefer automation-built SANDBOXES.** Targets are preferably realistic
  sandboxes built to be automated (SauceDemo, ParaBank, the Luma/Magento demo
  store), **not** production sites. The hand-curated catalogue uses exactly these.
- **Production sites are NOT standing evals.** A production site carries
  anti-bot / ToS / 2FA / real-state hazards; driving one is generally against its
  Terms of Service. If a production target is ever added it is a **deliberate,
  separate, human-gated** decision, never a default.
- **Real, logged-in, on your own machine/IP.** The harness drives webhands as the
  **real, logged-in user on their own machine and IP**, reusing their own
  authenticated session, exactly as ADR-0002 frames personal use. The human does
  any one-time login / challenge clearance in the headed `setup-profile` step;
  webhands never bypasses login or solves CAPTCHAs itself.
- **Per-run state hygiene.** Where a site allows it, each run uses a fresh,
  per-run nonce-tagged identity (so re-runs are independent and the assertion is
  unambiguous); cleanup is best-effort teardown after a clean PASS only, and never
  part of the verdict. A FAIL / INCONCLUSIVE run keeps its state for inspection.

In short: this scoreboard measures what a capable agent can do **the way you
could by hand**, on safe authorized sandboxes, as your own real session, never as
a CI gate.
