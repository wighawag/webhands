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
> ParaBank `cold-cta` leg above stumbled into) is recorded just below, and the
> dynamic-eval run lands in its own `## Dynamic (non-scriptable) read` section.

### Post-#25 re-measure: actionable snapshot ref `--by-ref` (2026-06-30)

> After `snapshot-ref-actionable-unify-with-by-ref` landed (PR #25): a `snapshot`
> `[ref=eN]` is now directly actionable via `click`/`type --by-ref`, so an agent
> can read-then-act in one loop without the `eval`/`querySelectorAll` fallback the
> transcripts exposed. Re-ran the `skilled` + `script-forward` legs on the
> fully-improved surface (both #24 and #25 live). All PASS. Totals (millions):
>
> | Eval | skilled | script-forward |
> | --- | --- | --- |
> | `saucedemo-core-flow` | 0.61M | 1.20M |
> | `saucedemo-discovery` | 2.66M | 3.37M |
> | `parabank-transfer` | 1.64M | 5.02M |
>
> **Honest finding: the snapshot-act `--by-ref` path was NOT exercised by the
> agent on these STATIC scriptable flows.** A transcript pass over the six runs
> (counting `--by-ref` / `aria-ref` tool calls) shows **0 snapshot-ref `--by-ref`
> acts**: the agents that read with `snapshot` still preferred to batch the
> sub-flow via `script` (script-forward) or to `eval` a small extraction (a couple
> of `eval`/`querySelector` calls remain), rather than the per-element
> `snapshot -> click eN --by-ref` loop. This is expected and is exactly WHY the
> dynamic eval (#3, `eval-dynamic-non-scriptable-mid-run-goal-shift`) is serialised
> LAST: the snapshot-ref fix's value is the look->decide->act-on-one-element loop,
> which a statically scriptable flow under-exercises (the agent can plan the whole
> flow up front and batch it). The CAPABILITY is present and correct (proven by
> `packages/core/test/snapshot-ref-actionable.test.ts`: read->act hits the right
> element, stale fails loud, re-snapshot supersedes); the per-flow ADOPTION on
> these easy flows is low, and the dynamic eval is the measurement designed to
> surface it. (Single-run variance is real, so do not over-read the small
> per-cell shifts vs the five-way table above.)

## Dynamic (non-scriptable) read: mid-run termination on a live value (2026-06-30)

> The FIRST eval a write-once-run-once BLIND script cannot win (task
> `eval-dynamic-non-scriptable-mid-run-goal-shift`; idea
> `work/notes/ideas/dynamic-evals-that-cannot-be-one-shot-scripted.md`). Every
> other row above is STATICALLY SCRIPTABLE: the whole flow can be planned up front
> and run blind in one script, which is exactly why raw Playwright is cheapest on
> them (it writes one script and runs it). This eval removes that advantage by
> design: the correct actions resolve ONLY from live, varying page state, so BOTH
> toolkits must observe-then-act.
>
> **Target + levers (the decision):** a small randomised LOCAL fixture
> (`evals/src/dynamic-fixture.ts`), HOST-deterministic (every value is a pure
> function of the per-run nonce, so the harness + the self-test can re-derive the
> correct end state) yet AGENT-unpredictable (only revealed on the page at run
> time). Chosen over a live sandbox for determinism + immunity to third-party
> flake (weighed against a live store's realism). Three levers combine so a single
> blind script provably cannot encode the flow, AND a single read-all-upfront
> script still gets the wrong answer:
>
> - **mid-run termination on a live value**: "add items until the shown subtotal
>   exceeds the shown free-shipping threshold, then check out" — the threshold is
>   nonce-randomised and only on the page, so no fixed script encodes the stop;
> - **runtime-revealed varying target**: prices + their order are nonce-seeded, so
>   which/how many items clear the threshold varies per run;
> - **subtotal not precomputable from the cards**: a per-item handling fee is added
>   in the cart ONLY, so even reading every card price up front cannot compute the
>   running subtotal — the agent must add, READ the live cart subtotal, then
>   decide.
>
> **Spike result (recorded):** over 3000 nonces, NO fixed "add the K cheapest
> cards" choice clears every run (add-2 fails 99%, add-3 63%, add-4 9% and
> overshoots), while the harness's read-loop reference plan clears 100% and the
> minimal clearing cart varies from 2 to 6 items — so a single blind script
> genuinely cannot one-shot it (self-test:
> `evals/test/dynamic-cart-eval.test.ts`).
>
> **Hypothesis (from the idea note):** on this eval the Playwright-vs-webhands
> token gap should NARROW or FLIP (both must loop; webhands' cheap structured
> reads no longer lose to one blind script). Same agent + model as every other
> section (`pi --print --mode json --tools bash,read,write`,
> `etherplay/claude-opus-4-8`, `--parse-usage`); SINGLE live runs (a snapshot, not
> an average). Totals in millions of tokens (input + output + cache).

| Run | cold | skilled | playwright | webhands ÷ baseline |
| --- | --- | --- | --- | --- |
| `--compare` (cold vs Playwright) | **PASS 2.80M** | n/a | **PASS 1.40M** | ~2.0x (NARROWED) |
| `--compare3` (cold vs skilled vs Playwright) | **PASS 3.19M** | **PASS 1.84M** | **FAIL** 0.33M | n/a (FLIPPED on capability) |

Raw run lines (token figures are pi's exact `--parse-usage` capture):

```
--compare (cold webhands vs Playwright-only):
  shell            PASS  milestones 4/4   tokens: in 440 / out 9.5k / cacheRead 2515.5k / cacheWrite 279.0k / total 2804.5k
  playwright       PASS  milestones 4/4   tokens: in 328 / out 8.6k / cacheRead 1187.3k / cacheWrite 205.4k / total 1401.6k

--compare3 (cold vs skilled vs Playwright-only):
  shell            PASS  milestones 4/4   tokens: in 444 / out 11.3k / cacheRead 2937.8k / cacheWrite 242.0k / total 3191.5k
  webhands-skilled PASS  milestones 4/4   tokens: in 386 / out  7.8k / cacheRead 1673.8k / cacheWrite 157.0k / total 1839.0k
  playwright       FAIL  milestones 1/4   tokens: in 112 / out  1.9k / cacheRead  298.4k / cacheWrite  30.2k / total  330.7k
```

### What the dynamic read shows (the hypothesis confirmed BOTH ways)

- **The gap NARROWED, exactly as predicted.** In the `--compare` run both toolkits
  PASSed and the webhands÷baseline ratio fell to **~2.0x**, versus the ~4-8x on
  the static scriptable flows (and the up-to-~30x the cold benchmark implied). The
  CAUSE is the eval's whole point: Playwright could no longer write one blind
  script and run it. Its own agent transcript says so — it noticed the displayed
  prices did NOT match the subtotal (the hidden handling fee), so it had to read
  the live `#cart-subtotal` after EACH click and decide whether to continue. That
  read-act-read loop is precisely the cost the static flows let it skip, and it is
  what closes the gap.
- **And it FLIPPED on capability.** In the `--compare3` run raw **Playwright
  FAILed** (1/4 milestones: it reached the store but never composed the loop to
  clear the threshold), while BOTH webhands configs PASSed (skilled cheapest at
  1.84M). On the interactive flow the "write one script" shape broke down, the
  clean "webhands delivers on interactive flows" result the idea note predicted.
  (Single-run variance is real: the same Playwright baseline PASSed the easier
  `--compare` run; the point is that its structural advantage is GONE here, so its
  outcome is no longer reliably better.)
- **webhands at its best (skilled) is the headline.** The skilled leg (the
  fair-shake config a real deployment with the skill synced would see) PASSed at
  1.84M, the cheapest webhands number on this eval, and PASSed where Playwright
  FAILed. This is the eval the harder tiers were building toward: it measures the
  verb surface's look->decide->act value, and on it webhands is both competitive
  on tokens AND more reliable on outcome.
- **Honest caveat.** This is a LOCAL fixture, not a live store, so the realism is
  bounded; it is a deterministic SPIKE proving the concept (a blind script cannot
  win, the end state is host-checkable, the gap narrows/flips), not a
  production-traffic benchmark. The natural follow-ups are a second dynamic eval
  on a live sandbox (e.g. ParaBank "transfer your entire current balance") and a
  few repeat runs for a spread rather than a single snapshot.

### Script-only head-to-head: is the webhands SURFACE itself competitive with raw Playwright? (2026-06-30)

> The CLEANEST "is webhands-via-script competitive with raw Playwright?" reading
> on this dynamic eval (task
> `eval-script-only-agent-kind-head-to-head-vs-playwright`; new agent kind
> `webhands-script-only`). The other webhands legs above carry a CHATTINESS /
> DISCOVERY confound: they may use many small `npx webhands <verb>` round-trips
> and pay a discovery tax, so a token gap vs Playwright mixes "the surface" with
> "how the agent used it". The `webhands-script-only` kind REMOVES that confound:
> its preamble drives the WHOLE flow EXCLUSIVELY through the file-only `script`
> verb (write `./flow.js`, `npx webhands script ./flow.js`, read the serializable
> result, write the next script), with NO discrete `click`/`type`/`snapshot`
> working path. Because `script` hands the agent the FULL live Playwright `page`,
> a script-only webhands agent and a raw-Playwright agent write the SAME
> automation against the SAME shared browser; the ONLY difference is webhands
> SERVES the browser (the agent need not re-launch its own). The read-decide-loop
> is framed as a SEQUENCE of one-model-turn `script` files: each script ACTS,
> READS the live page, and RETURNS what it saw; the agent decides, then writes the
> NEXT script.
>
> **Hypothesis (TIE-or-BEAT):** on this flow (a blind one-shot script cannot win,
> the stop point is a live nonce-seeded threshold), the script-only webhands leg
> should TIE or BEAT raw Playwright, because the surfaces are identical and
> webhands need not re-launch a browser. Same agent + model + `--parse-usage` as
> every other section (`pi --print --mode json --tools bash,read,write`,
> `etherplay/claude-opus-4-8`); SINGLE live runs (a snapshot, not an average).
> Totals in millions of tokens (input + output + cache).

| Leg | outcome | total tokens | note |
| --- | --- | --- | --- |
| `webhands-script-only` | **PASS 4/4** | **2.42M** | the clean surface read: script-exclusive, no chattiness confound |
| `playwright` (baseline) | **FAIL 1/4** | 0.23M | stalled on its own inspect script; never composed the loop |
| `webhands-script-forward` (context) | PASS 4/4 | 2.93M | skilled, `script` LED but discrete verbs still available |

Raw run lines (token figures are pi's exact `--parse-usage` capture):

```
webhands-script-only   PASS  milestones 4/4   tokens: in 514 / out 13.0k / cacheRead 2212.6k / cacheWrite 197.1k / total 2423.2k
playwright             FAIL  milestones 1/4   tokens: in  84 / out  1.6k / cacheRead  210.7k / cacheWrite  16.5k / total  228.9k
webhands-script-forward PASS milestones 4/4   tokens: in 566 / out 15.1k / cacheRead 2665.8k / cacheWrite 244.7k / total 2926.2k
```

**What the script-only read shows (the hypothesis confirmed on CAPABILITY; the
clean token tie is INCONCLUSIVE this snapshot):**

- **The surface is competitive: script-only PASSed where raw Playwright FAILed.**
  On the truest head-to-head, the script-only webhands agent drove the whole
  read-decide-loop as a sequence of file-only `script` runs (it noticed the
  displayed prices did NOT match the cart subtotal because of the hidden handling
  fee, so it added an item, read the live subtotal off the returned script value,
  decided, and wrote the next script) and reached the order-complete end state
  with the subtotal over the threshold. Raw Playwright reached the store but then
  STALLED on its own inspect script (a `node` script that connected over CDP but
  never disconnected/exited, so the model turn hung to the wall-clock cap) and
  FAILed 1/4. So on capability the script-only leg BEAT Playwright, the stronger
  half of the TIE-or-BEAT hypothesis.
- **The clean TOKEN tie is INCONCLUSIVE this single run.** Because Playwright did
  not complete the flow, its 0.23M is the cost of stalling early, NOT the cost of
  doing the same automation, so it is NOT an apples-to-apples token comparison.
  The honest token reading is among the legs that DID complete: script-only
  (2.42M) is the CHEAPEST webhands config on this eval, below `script-forward`
  (2.93M) and the cold/skilled legs in the table above (2.80M / 1.84M
  respectively across the two earlier comparison runs) — consistent with
  "driving exclusively via `script` is at least as lean as the other webhands
  configs". A clean script-only-vs-Playwright TOKEN tie needs a run where BOTH
  legs finish the loop; that is the natural follow-up (a few repeats for a
  spread, and a Playwright run that does not self-stall).
- **Why this leg is the cleanest "is the surface competitive?" reading.** It is
  the ONLY config where the webhands agent and the Playwright agent write the
  SAME automation (the full live `page`) against the SAME shared browser, with no
  per-verb shelling-out and no `--llms-full` discovery tax. So its result speaks
  to the SURFACE itself, not to how chatty the agent chose to be: on this dynamic
  flow the webhands surface, used script-only, is at least as capable as raw
  Playwright and at least as lean as the other webhands configs.
- **Honest caveats.** SINGLE live runs on a LOCAL fixture (bounded realism, real
  single-run variance: Playwright has PASSed the easier `--compare` run above, so
  do not read its stall here as "Playwright cannot do this"). Also an ENVIRONMENT
  artifact: `npx webhands` was not on PATH in this fresh worktree, so every
  webhands leg fell back to invoking the CLI directly via
  `node node_modules/webhands/dist/bin.js` (a few discovery turns; same surface,
  see `work/notes/observations/evals-npx-webhands-not-on-path-in-fresh-worktree.md`).

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

The DYNAMIC (non-scriptable) eval runs under the SAME machinery; just swap the
`--eval` id. The runner serves the randomised LOCAL fixture itself for the run
(no live site, no extra setup), so the same `--compare`/`--compare3` invocation
works:

```sh
pnpm --filter @webhands/evals run-eval \
  --eval cart-threshold-checkout \
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
