# webhands vs Playwright-only: the capability scoreboard

> The concrete answer to **"does webhands deliver?"** Same eval goal, same agent,
> same model, two toolkits: a **webhands** agent (drives the verb surface) and a
> **Playwright-only** baseline (drives raw Playwright over a shared CDP surface,
> no webhands). Compared on **outcome** (PASS / FAIL / INCONCLUSIVE) and **token
> cost**. Produced by `run-eval --compare` (see [How to reproduce](#how-to-reproduce)).

## What this measures (and what it does not)

- It measures whether a capable, unaided agent can **compose the toolkit to
  finish a real job on a real site**, and **how many tokens** it burned doing so.
  Both legs run the SAME goal and the SAME harness-owned end-state assertion (the
  harness validates via its own reads, never the agent's self-report); only the
  agent's toolkit + protocol preamble differ, so the rows are apples-to-apples.
- It is **not** a benchmark average. Each row below is a **single live run**
  against a live third-party site with a nondeterministic LLM agent, so exact
  token counts vary run to run and outcomes can shift with site health. Treat the
  numbers as a **snapshot reference baseline** a later webhands change is measured
  against, not a precise score.
- `INCONCLUSIVE` means the SITE was unhealthy (down / rate-limited / Cloudflare
  outage), not that the agent failed. The harness reserves `FAIL` for a genuine
  capability miss on a healthy site.

## The reference run (2026-06-29)

Agent: `pi --print --mode json --tools bash,read,write`, model
`etherplay/claude-opus-4-8`, `--parse-usage` (exact token capture from pi's JSON
stream). Tokens shown as `total` (input + output + cache read/write); `out` =
output tokens, the part most directly attributable to the agent's reasoning +
tool authoring.

| Eval | Tier | webhands outcome | Playwright-only outcome | webhands tokens (total / out) | Playwright tokens (total / out) | webhands ÷ baseline (total) |
| --- | --- | --- | --- | --- | --- | --- |
| `saucedemo-core-flow` | 1 | **PASS** | **PASS** | 6.58M / 15.2k | 0.84M / 6.4k | ~7.8x |
| `saucedemo-discovery` | 1 | **PASS** | **PASS** | 6.38M / 17.3k | 1.67M / 12.2k | ~3.8x |
| `parabank-transfer` | 2 | **PASS** | **PASS** | 11.67M / 24.9k | 1.59M / 10.7k | ~7.3x |
| `magento-checkout` | 3 | INCONCLUSIVE | INCONCLUSIVE | 3.36M / 8.4k | 0.33M / 2.5k | n/a (site down) |

Raw `--compare` output for each row:

```
comparison: saucedemo-core-flow (same goal + assertion, two toolkits)
  shell       PASS         milestones 0/4   tokens: in 726 / out 15.2k / cacheRead 6328.8k / cacheWrite 237.6k / total 6582.3k
  playwright  PASS         milestones 0/4   tokens: in 254 / out  6.4k / cacheRead  716.7k / cacheWrite 116.1k / total  839.5k

comparison: saucedemo-discovery (same goal + assertion, two toolkits)
  shell       PASS         milestones 0/4   tokens: in 824 / out 17.3k / cacheRead 6008.6k / cacheWrite 349.3k / total 6376.1k
  playwright  PASS         milestones 0/4   tokens: in 416 / out 12.2k / cacheRead 1508.7k / cacheWrite 153.6k / total 1674.9k

comparison: parabank-transfer (same goal + assertion, two toolkits)
  shell       PASS         milestones 2/4   tokens: in 1.1k / out 24.9k / cacheRead 11266.4k / cacheWrite 374.5k / total 11666.9k
  playwright  PASS         milestones 2/4   tokens: in 402 / out 10.7k / cacheRead  1493.2k / cacheWrite  87.8k / total  1592.1k

comparison: magento-checkout (same goal + assertion, two toolkits)
  shell       INCONCLUSIVE milestones 0/4   tokens: in 424 / out 8.4k / cacheRead 3075.0k / cacheWrite 274.0k / total 3357.9k
  playwright  INCONCLUSIVE milestones 0/4   tokens: in 118 / out 2.5k / cacheRead  238.2k / cacheWrite  86.4k / total  327.2k
```

(Magento returned Cloudflare HTTP 526 at run time, so both legs correctly
reported INCONCLUSIVE; rerun when the site is healthy for a tier-3 capability
reading.)

## How to read it: does webhands deliver?

On these **simple, scriptable sandbox flows, both toolkits reach the goal**, and
the raw token total is currently **higher for webhands** (roughly 4x to 8x). That
is honest, and it has a clear, non-damning cause:

- The webhands agent drives via many small `npx webhands <verb>` shell
  round-trips. Each invocation re-primes the agent's context, which dominates
  `cacheRead` (the bulk of the total). It is a **chatty, verb-at-a-time** loop.
- The Playwright-only agent **writes one script and runs it** (`connectOverCDP`,
  then a single automation file), so it pays for far fewer model round-trips.

So on a flow that is trivial to script in one shot, raw Playwright is cheaper, as
expected. The webhands thesis is **not** that verbs beat a hand-written script on
an easy, stable, well-documented site. It is that verbs win where
"write-a-Playwright-script-once" breaks down:

- **messy / unfamiliar / changing DOMs** the agent must explore step by step
  (exactly the tier-3+ regression-catcher cases),
- **anti-bot / stealth / real-session** sites where a raw Playwright launch is a
  bigger tell (webhands' stealth + real-profile launch is the point),
- **captcha / human-in-the-loop** flows the verb surface is built to compose.

Those are the cases the harder tiers exist to measure. The numbers above are the
**baseline** that makes that future measurement meaningful: when a webhands change
narrows or flips the token gap on a hard site, this scoreboard is what it is
compared against.

### Caveats / known nuances

- The `milestones N/4` column is a coarse signal: intermediate-page milestones
  are scored against the FINAL page, so a flow whose intermediate states do not
  persist (e.g. SauceDemo) reads `0/4` even on a PASS, while ParaBank's persistent
  states read `2/4`. PASS/FAIL + tokens are the trustworthy axes.
- `cost` reads `0` here because the configured provider reported zero cost; the
  field is plumbed and will populate for a priced provider.
- Single-run variance is real. For a firmer number, run each eval a few times and
  take the spread.

## How to reproduce

```sh
# from the repo root, with packages built (pnpm -r build) and a real agent (e.g. pi) on PATH
pnpm --filter @webhands/evals run-eval \
  --eval saucedemo-core-flow \
  --compare \
  --parse-usage \
  --webhands "node packages/cli/dist/bin.js" \
  --agent-cmd     "pi --print --mode json --tools bash,read,write --model <model>" \
  --playwright-cmd "bash -c 'cd <dir-where-playwright-resolves> && exec pi --print --mode json --tools bash,read,write --model <model>'"
```

The webhands leg drives the verb surface; the Playwright-only leg connects its own
Playwright to the harness's served browser over CDP (`WEBHANDS_CDP_ENDPOINT`,
exposed by `serve`) and drives the SAME page, so the harness's verdict reads the
page the agent actually drove. This shared-surface fix is what makes the baseline's
outcome trustworthy (see
`work/notes/findings/baseline-comparison-needs-a-shared-driving-surface-not-two-browsers.md`
and `...baseline-now-passes-on-a-shared-cdp-surface...md`).

The eval harness is **non-gating** and lives outside `packages/*`, so a flaky live
site can never red the build; it is never part of `pnpm test`.
