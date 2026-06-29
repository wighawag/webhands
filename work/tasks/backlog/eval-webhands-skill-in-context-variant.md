---
title: Benchmark webhands WITH its skill/API in context (a `webhands-skilled` agent variant) so the scoreboard measures the surface fairly + A/Bs the skill
slug: eval-webhands-skill-in-context-variant
blockedBy: []
covers: []
---

## What to build

Add a third agent configuration to the eval harness, **webhands-skilled**: a
webhands agent whose protocol preamble INLINES webhands knowledge (the
`skills/use-webhands/SKILL.md` workflow skill and/or the `npx webhands --llms-full`
verb reference) instead of merely POINTING the agent at a discovery command. Then
make the scoreboard a three-way read: **webhands-cold** (today) vs
**webhands-skilled** vs **Playwright-only**.

This is grounded in the transcript analysis
(`work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`):
the webhands leg currently pays a runtime "discovery tax" (~37% of its tool calls
spent learning the API via `--llms-full` before it drives the browser), because
the model knows Playwright for free but does NOT know webhands for free. The
benchmark withholds the very skill webhands SHIPS (`webhands skills` +
`skills/use-webhands/SKILL.md` + per-verb skills). Measuring the webhands agent
with its skill in context is both (a) the honest "does the surface deliver?"
number a real deployment would see, and (b) a direct A/B of the skill's value.

End-to-end vertical slice:

- **A `WEBHANDS_SKILLED_PREAMBLE`** alongside the existing `WEBHANDS_PREAMBLE` /
  `PLAYWRIGHT_PREAMBLE` in `evals/src/no-priming.ts`. Its `toolkitReference`
  embeds the webhands skill text (read from `skills/use-webhands/SKILL.md`, and/or
  the `--llms-full` output) so the agent STARTS already knowing the surface. The
  `leaveOpenRule` is the webhands one (unchanged). The agent still drives the
  webhands verb surface; only how much it is TOLD up front changes.
- **The skill text is PROTOCOL, not goal priming.** It is generic, site-agnostic
  tool-usage knowledge (how to use webhands), exactly the `ProtocolPreamble`
  distinction the harness already draws. The no-priming guard still binds the
  GOAL. IMPORTANT: confirm the inlined skill text carries NO site-specific
  selectors/steps/URLs (it must pass the same spirit as `assertNoPriming`); if the
  skill text ever did, that would be priming and must be stripped. Add a check/test
  that the skilled preamble does not smuggle goal priming.
- **A `webhands-skilled` agent kind.** Extend the runner's `AgentKind`
  (`evals/src/bin/run-evals.ts`) from `webhands | playwright` to
  `webhands | webhands-skilled | playwright`, wire `buildAgent` to construct a
  `ShellAdapter` with the skilled preamble (same launch shape; only the preamble
  differs, like the Playwright adapter). It drives webhands exactly as the cold
  config does, so it is directly comparable.
- **A three-way comparison.** Allow `--compare` (or a new `--compare3` / repeated
  legs) to run the SAME eval under all three configs and print them side by side
  on the SAME fields (outcome, milestones, tokens), so cold vs skilled vs baseline
  line up. Keep token + outcome fields identical across all three.
- **Re-run + record.** A live `saucedemo-core-flow` (and ideally discovery +
  parabank) three-way run, recorded into `evals/SCOREBOARD.md` as a new section, so
  the skill's value (cold -> skilled delta) and the fair-shake number
  (skilled vs Playwright) are both visible. This is the measurement the idea exists
  to produce.

Toolkit-agnostic plumbing, NON-GATING, under `evals/`. No new webhands verb. The
deterministic self-test covers the new preamble + agent-kind plumbing (a fake
adapter; the skilled preamble inlines the skill text; the no-priming guard still
binds the goal; the three-way comparison renders three results) under the `evals`
`self-test` script, never `pnpm test`.

## Acceptance criteria

- [ ] A `webhands-skilled` preamble inlines the webhands skill/API text
      (`skills/use-webhands/SKILL.md` and/or `--llms-full`) so the webhands agent
      starts knowing the surface; it drives the SAME verb surface as the cold
      config (only the up-front knowledge differs).
- [ ] The inlined skill text is verified to carry NO goal priming (no site-specific
      selectors/steps/URLs); a test asserts the skilled preamble passes the
      no-priming spirit, and the no-priming guard still binds the GOAL.
- [ ] The runner gains a `webhands-skilled` agent kind (`--agent-kind`), built as a
      `ShellAdapter` with the skilled preamble; it is comparable to the cold +
      Playwright configs on identical outcome + token fields.
- [ ] The harness can run the SAME eval under all THREE configs and print a
      side-by-side comparison on identical fields (cold vs skilled vs Playwright).
- [ ] A live three-way run is recorded in `evals/SCOREBOARD.md` (cold -> skilled
      delta = the skill's value; skilled vs Playwright = the fair-shake number).
- [ ] Toolkit-agnostic, non-gating, under `evals/`; no new webhands verb; no
      live-site test in `pnpm test`.
- [ ] A deterministic self-test covers the skilled-preamble + agent-kind +
      three-way-comparison plumbing under the `evals` `self-test` script.

## Blocked by

- None. Builds on the shipped preamble + `--agent-kind` + `--compare` machinery
  (`tasks/done/eval-playwright-only-baseline-comparison.md`,
  `tasks/done/eval-baseline-shared-driving-surface-over-cdp.md`).

## Prompt

> Goal: add a `webhands-skilled` agent config to the eval harness, a webhands
> agent whose protocol preamble INLINES the webhands skill/API
> (`skills/use-webhands/SKILL.md` and/or `npx webhands --llms-full`) instead of
> just pointing at a discovery command, and make the scoreboard a three-way read:
> webhands-cold vs webhands-skilled vs Playwright-only. This measures the surface
> FAIRLY (a real agent has the skill in context; the model knows Playwright for
> free but not webhands) and A/Bs the skill's value. Grounded in
> `work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`
> (the ~37% discovery tax) and the idea
> `work/notes/ideas/benchmark-webhands-skill-in-context.md`.
>
> READ FIRST: `evals/src/no-priming.ts` (the `ProtocolPreamble` shape +
> `WEBHANDS_PREAMBLE`/`PLAYWRIGHT_PREAMBLE` + `buildAgentInput` +
> `assertNoPriming`); `evals/src/bin/run-evals.ts` (the `AgentKind` selector +
> `buildAgent` + `--compare`); `evals/src/agent-under-test.ts` (`ShellAdapter` +
> the preamble option); `skills/use-webhands/SKILL.md` (the skill text to inline);
> `evals/SCOREBOARD.md` (where to record the three-way run).
>
> KEY DESIGN POINTS: the skilled preamble's `toolkitReference` embeds the webhands
> skill text so the agent starts knowing the surface; it drives the SAME verb
> surface as the cold config (only up-front knowledge differs). The skill text is
> PROTOCOL, not goal priming (generic tool usage, site-agnostic) - VERIFY it carries
> no site-specific selectors/steps/URLs and add a test asserting so; the no-priming
> guard still binds the GOAL. Extend `AgentKind` to
> `webhands | webhands-skilled | playwright`, build the skilled kind as a
> `ShellAdapter` with the skilled preamble. Provide a three-way comparison on
> identical outcome + token fields. Re-run a live saucedemo-core-flow (ideally also
> discovery + parabank) three ways and record it in `evals/SCOREBOARD.md`
> (cold->skilled = skill value; skilled vs Playwright = fair shake). Toolkit-agnostic,
> non-gating, under evals/, no new verb, deterministic self-test under the evals
> self-test script (never pnpm test).
>
> What "done" means: the scoreboard can be read three ways (cold / skilled /
> Playwright) on the same eval with identical fields; the skilled preamble inlines
> the skill without priming the goal; a live three-way run is recorded so the
> skill's value and the fair-shake number are both visible.
>
> FIRST, check against current reality: confirm the preamble/`AgentKind`/`--compare`
> shapes are as described (they may have evolved) and reconcile rather than
> duplicate. RECORD the non-obvious decisions (exactly what skill text is inlined and
> why, how the three-way comparison is invoked, how priming is checked).
