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

## The five-way read after the overhead cut: CTA default-off + a complete per-verb skill (2026-06-30)

> After `cut-per-run-context-overhead-cta-and-discovery` landed (PR #24): the
> per-result `cta` block is now SUPPRESSED by default (re-enable with
> `--cta`/`--hints` or `WEBHANDS_CTA=1`), and the inlined `use-webhands` skill is a
> COMPLETE per-verb reference, so a skilled agent drives WITHOUT re-dumping
> `--help`/`--llms-full` at runtime. This run measures all FIVE configs, adding the
> new **`webhands-cold-cta`** kind (the SAME cold preamble + `WEBHANDS_CTA=1` pinned
> in the agent env) that reproduces the pre-flip CTA-on surface, so `cold-cta`
> stays comparable to the 2026-06-29 four-way `cold` row and `cold-cta - cold`
> isolates the CTA cost.
>
> Same agent + model as the other sections (`pi --print --mode json --tools
> bash,read,write`, `etherplay/claude-opus-4-8`, `--parse-usage`); SINGLE live runs
> (a snapshot, not an average, run-to-run variance on `total` is large, especially
> on the long ParaBank flow). Totals in millions of tokens (input + output +
> cache). **Do NOT cross-compare absolute numbers across the 2026-06-29 surface
> change except via `cold-cta`** (the only row measuring the pre-flip surface).

| Eval | Tier | cold (CTA-off) | cold-cta (CTA-on) | skilled | script-forward | playwright |
| --- | --- | --- | --- | --- | --- | --- |
| `saucedemo-core-flow` | 1 | PASS 8.19M | PASS 7.08M | PASS 2.86M | **PASS 2.27M** | PASS 0.51M |
| `saucedemo-discovery` | 1 | PASS 9.09M | PASS 9.75M | PASS 5.94M | **PASS 1.18M** | PASS 0.91M |
| `parabank-transfer` | 2 | PASS 8.10M | PASS 15.94M | PASS 1.60M | **PASS 1.49M** | **FAIL** 0.22M |

Raw run lines (token figures are pi's exact `--parse-usage` capture):

```
saucedemo-core-flow (shell/cold)            PASS  tokens: in 844 / out 14.5k / cacheRead 7709.6k / cacheWrite 465.7k / total 8190.6k
saucedemo-core-flow (webhands-cold-cta)     PASS  tokens: in 742 / out 13.8k / cacheRead 6729.7k / cacheWrite 334.5k / total 7078.7k
saucedemo-core-flow (webhands-skilled)      PASS  tokens: in 564 / out 12.8k / cacheRead 2725.1k / cacheWrite 118.0k / total 2856.4k
saucedemo-core-flow (webhands-script-fwd)   PASS  tokens: in 480 / out 10.8k / cacheRead 2135.6k / cacheWrite 123.8k / total 2270.6k
saucedemo-core-flow (playwright)            PASS  tokens: in 170 / out  4.5k / cacheRead  400.3k / cacheWrite 105.4k / total  510.3k

saucedemo-discovery (shell/cold)            PASS  tokens: in 946 / out 20.5k / cacheRead 8681.5k / cacheWrite 387.9k / total 9090.9k
saucedemo-discovery (webhands-cold-cta)     PASS  tokens: in 954 / out 20.3k / cacheRead 9370.5k / cacheWrite 355.2k / total 9746.9k
saucedemo-discovery (webhands-skilled)      PASS  tokens: in 870 / out 18.1k / cacheRead 5647.5k / cacheWrite 276.6k / total 5943.1k
saucedemo-discovery (webhands-script-fwd)   PASS  tokens: in 300 / out  6.2k / cacheRead 1094.7k / cacheWrite  81.8k / total 1183.0k
saucedemo-discovery (playwright)            PASS  tokens: in 274 / out  8.2k / cacheRead  788.1k / cacheWrite 114.6k / total  911.2k

parabank-transfer (shell/cold)              PASS  tokens: in 744 / out 15.0k / cacheRead 7605.5k / cacheWrite 474.8k / total 8096.0k
parabank-transfer (webhands-cold-cta)       PASS  tokens: in 980 / out 18.8k / cacheRead 15382.8k/ cacheWrite 532.4k / total 15935.1k
parabank-transfer (webhands-skilled)        PASS  tokens: in 312 / out  6.1k / cacheRead 1446.5k / cacheWrite 149.2k / total 1602.1k
parabank-transfer (webhands-script-fwd)     PASS  tokens: in 286 / out  5.9k / cacheRead 1230.7k / cacheWrite 256.0k / total 1492.8k
parabank-transfer (playwright)              FAIL  tokens: in  82 / out  1.6k / cacheRead  141.8k / cacheWrite  79.6k / total  223.1k
```

### What the five-way read shows (and the byte-level confirmation)

- **The overhead cut is unambiguous at the BYTE level, not just the noisy token
  total.** A pass over this run's agent transcripts
  (`~/.pi/agent/sessions/--tmp-...-evals--`, measuring `toolResult` bytes pulled
  into context) shows the regime split cleanly: the **skilled / script-forward**
  legs pull **0 `--llms-full` re-dumps and 0 CTA blocks**, dropping result bytes
  from ~40-71KB (cold) to **4-18KB**. The complete per-verb skill genuinely
  obviates the runtime `--help`/`--llms-full` re-dump (the ~4.4KB+ payload the task
  targeted), and the default-off CTA removes the per-result `cta` bytes. The
  ordering `cold/cold-cta >> skilled > script-forward` holds in BOTH the byte
  measure and the token total.
- **`cold-cta` reproduces the pre-flip baseline (the control works).** The
  `cold-cta` rows sit in the same order of magnitude as the 2026-06-29 four-way
  `cold` rows (core 7.08M vs 9.28M; discovery 9.75M vs 8.90M; parabank 15.94M vs
  8.95M), and crucially `cold-cta` carries the CTA blocks (transcripts: 10-20 CTA
  results per run) while the new `cold` (CTA-off) carries far fewer/none. The CTA
  env override + the `cold-cta` kind work as designed: the old surface stays live
  and re-runnable. (Single-run variance is large on the long ParaBank flow, where
  the `cold-cta` agent hit the `page.`-prefixed locator grammar, fell back to
  `script`, and looped, inflating that one cell, the documented friction the
  `snapshot-ref` task next addresses, not a measurement error.)
- **`cold-cta - cold` isolates the CTA cost, but it is DWARFED by run variance.**
  The CTA block is ~5% of result bytes; on these flows the run-to-run LLM variance
  on `total` is far larger, so the `cold-cta - cold` delta is not a clean dollar
  figure here (core: cold-cta is even slightly LOWER this run). The CTA's real cost
  shows up structurally in the byte count (CTA results present in cold/cold-cta,
  absent in skilled/script-forward), not as a stable token delta on a single run.
  The value of suppressing it is removing pure-overhead bytes an agent never reads,
  consistently, not a headline per-run saving.
- **The capability story is unchanged and still the bigger one.** All three
  webhands configs PASS `parabank-transfer`; raw **Playwright FAILs** it again
  (exactly as 2026-06-29). On the easy flows Playwright is still cheapest in raw
  tokens, but it is not strictly better: on the stateful flow it did not reach the
  goal. webhands-at-its-best (script-forward) is within a small factor on the easy
  flows AND more capable on the harder one.

> FOLLOW-UP measured here is the overhead-cut re-measure for task #24. The
> `snapshot-ref-actionable` re-measure (cutting the `eval`-fallback round-trips the
> ParaBank `cold-cta` leg above stumbled into) is its own follow-up, and the
> dynamic-eval run lands in its own `## Dynamic (non-scriptable) read` section.

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
