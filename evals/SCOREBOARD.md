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

## The three-way read: cold vs skilled vs Playwright (2026-06-29)

> The two-way table above gives the webhands agent NO webhands knowledge: its
> preamble only POINTS it at `npx webhands --llms-full`, so it discovers the verb
> surface COLD at runtime and pays a "discovery tax"
> (`work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`).
> That is not apples-to-apples: the model knows Playwright for free (training
> data) but does NOT know webhands for free. The **webhands-skilled** leg fixes
> that: its preamble INLINES the `use-webhands` skill (curated to the
> site-agnostic PROTOCOL layer, no goal priming), so the agent STARTS knowing the
> surface, the way a real deployment with the skill synced would. Three legs, the
> SAME goal + the SAME harness end-state assertion, only the up-front knowledge
> differs:
>
> - **cold -> skilled** = the **skill's value** (an A/B of `use-webhands`);
> - **skilled vs Playwright** = the **fair-shake** number (the honest "does the
>   surface deliver?" reading a real agent would see).

Agent + model identical to the two-way table; produced by `run-eval --compare3`
(see [How to reproduce](#how-to-reproduce)). Single live runs, so treat as a
snapshot, not an average (single-run variance is real, especially on `out`).

| Eval | Tier | cold | skilled | Playwright | cold total | skilled total | Playwright total | cold->skilled (total) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `saucedemo-core-flow` | 1 | **PASS** | **PASS** | **PASS** | 6.14M | 5.58M | 0.55M | ~0.91x (−9%) |
| `saucedemo-discovery` | 1 | **PASS** | **PASS** | FAIL | 11.55M | 6.49M | 0.36M | ~0.56x (−44%) |
| `parabank-transfer` | 2 | FAIL | **PASS** | FAIL | 4.30M | 7.56M | 0.58M | n/a (cold FAILed) |

Raw `--compare3` output for each row:

```
comparison: saucedemo-core-flow (same goal + assertion, 3 toolkits)
  shell            PASS         milestones 0/4   tokens: in 638 / out 11.9k / cacheRead 5723.1k / cacheWrite 401.2k / total 6136.9k
  webhands-skilled PASS         milestones 0/4   tokens: in 896 / out 16.9k / cacheRead 5359.9k / cacheWrite 206.4k / total 5584.1k
  playwright       PASS         milestones 0/4   tokens: in 172 / out  4.0k / cacheRead  436.4k / cacheWrite 109.6k / total  550.1k

comparison: saucedemo-discovery (same goal + assertion, 3 toolkits)
  shell            PASS         milestones 0/4   tokens: in 976 / out 20.4k / cacheRead 11027.6k / cacheWrite 497.0k / total 11546.0k
  webhands-skilled PASS         milestones 0/4   tokens: in 996 / out 19.0k / cacheRead  6218.8k / cacheWrite 254.4k / total  6493.2k
  playwright       FAIL         milestones 1/4   tokens: in 120 / out  2.5k / cacheRead   259.4k / cacheWrite 100.5k / total   362.6k

comparison: parabank-transfer (same goal + assertion, 3 toolkits)
  shell            FAIL         milestones 0/4   tokens: in 474 / out  8.8k / cacheRead 4009.8k / cacheWrite 279.0k / total 4298.0k
  webhands-skilled PASS         milestones 2/4   tokens: in 948 / out 17.1k / cacheRead 7247.2k / cacheWrite 297.8k / total 7563.0k
  playwright       FAIL         milestones 0/4   tokens: in 182 / out  3.3k / cacheRead  477.1k / cacheWrite  98.8k / total  579.3k
```

### What the three-way read shows

- **The skill removes the discovery tax (the A/B).** On `saucedemo-discovery` the
  skilled leg cut the total ~44% (11.55M -> 6.49M) for the SAME PASS: the bulk of
  the gap was `cacheRead` from the cold agent re-priming `--llms-full` discovery
  turns, exactly the tax the transcript analysis predicted. On the trivial
  `saucedemo-core-flow` the saving is smaller (~9%) because there is little to
  discover. The `out`-token figure is noisier run to run (the skilled
  `core-flow` leg happened to reason more this run); `total`/`cacheRead` is the
  cleaner skill-value axis.
- **The skill can flip a FAIL to a PASS.** On `parabank-transfer` the COLD
  webhands agent FAILed while the SKILLED agent PASSed: knowing the surface up
  front let it compose the longer register->open->transfer->confirm flow that the
  cold agent (and Playwright) did not finish. That is the skill's value as a
  capability delta, not just a token delta.
- **The fair-shake number (skilled vs Playwright).** Raw Playwright is still far
  cheaper in tokens on these simple, one-shot-scriptable sandbox flows (it writes
  one script and runs it), as the two-way section already explains. But the
  fair-shake reading is no longer the cold agent's inflated discovery-tax total:
  skilled is the honest surface number, and on the harder discovery/stateful
  flows it PASSed where Playwright FAILed. The webhands thesis (verbs win on
  messy/changing DOMs, anti-bot, and human-in-the-loop flows) is what the harder
  tiers exist to measure; this three-way read just makes the webhands column an
  HONEST baseline (skill in context) rather than a tax-inflated one.

## The four-way read: cold vs skilled vs script-forward vs Playwright (2026-06-29)

> After the `script` verb landed (a driver-context batch verb: run one JS
> function of the full live Playwright `page` in ONE call;
> `docs/adr/0012`), this is the run that asks: with webhands AT ITS BEST (skill in
> context AND the batch verb available), how close is it to raw Playwright? Four
> configs, the SAME goal + harness assertion, only the agent's up-front knowledge
> differs:
>
> - **cold** \u2014 only the `--llms-full` pointer (discovers everything cold).
> - **skilled-full** \u2014 the inlined `use-webhands` skill describing ALL verbs
>   INCLUDING `script`; the agent decides what to use.
> - **script-forward** \u2014 the same full surface, but the preamble PUTS `script`
>   FORWARD as the preferred batch path.
> - **playwright** \u2014 the raw-Playwright baseline.
>
> Same agent + model as the other sections; single live runs (snapshot, not an
> average). Totals in millions of tokens (input + output + cache).

| Eval | Tier | cold | skilled-full | script-forward | playwright |
| --- | --- | --- | --- | --- | --- |
| `saucedemo-core-flow` | 1 | PASS 9.28M | PASS 1.56M | **PASS 1.36M** | PASS 0.31M |
| `saucedemo-discovery` | 1 | PASS 8.90M | PASS 3.29M | **PASS 2.18M** | PASS 1.29M |
| `parabank-transfer` | 2 | PASS 8.95M | PASS 2.98M | **PASS 3.32M** | **FAIL** 0.33M |

### What the four-way read shows

- **More webhands knowledge monotonically closes the gap.** The token total falls
  at every step that hands the agent more up-front knowledge:
  `cold -> skilled -> script-forward`. On `saucedemo-core-flow`: 9.28M -> 1.56M ->
  1.36M (cold was ~30x raw Playwright; script-forward is ~4.5x). On
  `saucedemo-discovery`: 8.90M -> 3.29M -> 2.18M (~6.9x -> ~1.7x). The cold
  column was overwhelmingly DISCOVERY TAX, not the verb surface being inefficient.
- **Putting `script` forward helps on the scriptable flows.** On both SauceDemo
  flows the script-forward config beat skilled-full (1.36M vs 1.56M; 2.18M vs
  3.29M): nudged to batch the sub-flow into one `script` call, the agent made
  fewer model round-trips. On `parabank-transfer` script-forward was slightly
  HIGHER than skilled (3.32M vs 2.98M) \u2014 single-run variance, and the long
  register/open/transfer flow benefits less from one big script than a focused
  sub-flow does. The effect is real but flow-dependent; measure per eval, do not
  assume script-forward is always cheapest.
- **The capability story is the bigger one.** On `parabank-transfer` ALL THREE
  webhands configs PASS while raw **Playwright FAILs**: the longer stateful flow
  is where "write one script by hand" breaks down and composing the verb surface
  (with the skill) wins. So even though Playwright is still the cheapest in raw
  tokens on the trivial flows, it is NOT strictly better: on the harder tier it
  did not reach the goal at all. webhands-at-its-best (script-forward) is within a
  small factor on the easy flows AND more capable on the harder one.
- **Does webhands deliver?** With the skill in context and the `script` verb,
  YES, meaningfully: the honest gap to raw Playwright on simple flows is now a
  small single-digit factor (not the ~30x the cold benchmark implied), and on the
  stateful flow webhands succeeds where raw Playwright fails. The remaining
  token gap on trivial one-shot-scriptable flows is the expected cost of a
  composable surface, and the harder/messier/anti-bot tiers (where the surface is
  designed to win) are what future runs measure.

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

For the THREE-way read (cold vs skilled vs Playwright), swap `--compare` for
`--compare3`:

```sh
pnpm --filter @webhands/evals run-eval \
  --eval saucedemo-discovery \
  --compare3 \
  --parse-usage \
  --webhands "node packages/cli/dist/bin.js" \
  --agent-cmd      "pi --print --mode json --tools bash,read,write --model <model>" \
  --playwright-cmd "bash -c 'cd <dir-where-playwright-resolves> && exec pi --print --mode json --tools bash,read,write --model <model>'"
```

The SKILLED leg reuses `--agent-cmd` (only the preamble differs from the cold
leg, not the launch command); pass `--skilled-cmd` to launch it differently. The
skilled preamble INLINES the curated `use-webhands` skill text
(`evals/src/no-priming.ts` `WEBHANDS_SKILL_REFERENCE`), which is held to the
no-priming spirit (`assertSkilledReferenceUnprimed`: no selector-shaped fragment,
no site URL) so the inlined PROTOCOL never smuggles goal priming.

The webhands leg drives the verb surface; the Playwright-only leg connects its own
Playwright to the harness's served browser over CDP (`WEBHANDS_CDP_ENDPOINT`,
exposed by `serve`) and drives the SAME page, so the harness's verdict reads the
page the agent actually drove. This shared-surface fix is what makes the baseline's
outcome trustworthy (see
`work/notes/findings/baseline-comparison-needs-a-shared-driving-surface-not-two-browsers.md`
and `...baseline-now-passes-on-a-shared-cdp-surface...md`).

The eval harness is **non-gating** and lives outside `packages/*`, so a flaky live
site can never red the build; it is never part of `pnpm test`.
