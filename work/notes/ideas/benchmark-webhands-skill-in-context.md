# Idea: benchmark webhands WITH its skill/API in context (and A/B the skill itself)

## The gap

The scoreboard benchmark currently gives the webhands agent NO webhands knowledge.
Its preamble (`evals/src/no-priming.ts` `VERB_SURFACE_REFERENCE`) points it at
`npx webhands --llms-full` and makes it discover the whole verb surface COLD at
runtime. The transcripts
(`work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`)
show this "discovery tax" eats ~37% of the webhands agent's tool calls before it
even drives the browser.

This is not apples-to-apples in webhands' favour: the model knows Playwright FOR
FREE (it is in its training data), but it does NOT know webhands for free. A real
user's agent would have the webhands skill/API in context (that is the whole point
of `webhands skills` + `skills/use-webhands/SKILL.md`); the benchmark withholds it.

## The idea

Add a benchmark VARIANT that injects webhands knowledge into the webhands leg's
PROTOCOL preamble, and compare three points on the same eval:

1. **webhands-cold** (today): only the `--llms-full` pointer. Pays the discovery tax.
2. **webhands-with-skill**: the `skills/use-webhands/SKILL.md` content (and/or the
   `--llms-full` verb reference, and/or the per-verb `webhands-<verb>` skills)
   inlined into the preamble, so the agent starts already knowing the surface, the
   way a real agent with the skill synced would.
3. **Playwright-only**: the existing baseline.

This does two things at once:

- **Measures the skill's value directly** (the A/B the user asked for): cold vs
  with-skill is the skill's contribution, in tokens + pass-rate. That tells us
  whether `use-webhands` (and the per-verb skills) actually help an agent, and lets
  us ITERATE the skill text and re-measure (a tight optimisation loop for the skill
  itself).
- **Gives webhands a fair shake**: the with-skill point is the honest "does the
  surface deliver?" number, since it removes the runtime discovery tax that a real
  deployment would not pay.

## How it could be wired (cheap)

- The preamble is already a per-adapter `ProtocolPreamble` (toolkitReference +
  leaveOpenRule). Add a webhands-WITH-skill preamble whose `toolkitReference`
  embeds the skill text (read from `skills/use-webhands/SKILL.md` and/or the
  `--llms-full` output) instead of the bare pointer. Keep the no-priming guard on
  the GOAL intact: the skill is toolkit PROTOCOL (how to use the tool), not goal
  priming (how to solve THIS site), exactly like the existing preamble distinction.
- Add a runner selector (e.g. `--webhands-skill cold|skill`) or a third
  `--agent-kind webhands-skilled`, so a single `--compare`/run can pick the variant.
- Record all three on the scoreboard so the skill's value and the fair-shake number
  are both visible.

## Open questions

- WHICH knowledge to inline: the workflow skill (`use-webhands`), the full
  `--llms-full` verb reference, the per-verb skills, or a curated subset? The inlined
  text itself costs input tokens, so there is a sweet spot to find (a lean skill that
  removes discovery turns without bloating every prompt). Measuring cold vs
  variants IS how you find it.
- Does inlining the skill risk priming the GOAL? It should not (it is generic
  tool-usage, site-agnostic), but the no-priming guard + a review of the skill text
  for any site-specific leakage should confirm it.
- Combine with the `execute-script` verb idea
  (`work/notes/ideas/webhands-execute-script-verb.md`): the biggest webhands number
  is probably with-skill AND a batch verb. Measure them independently first, then
  together.

## Provenance

Conversation 2026-06-29, after the first scoreboard runs. The user noted the
benchmark likely does not provide the skill/API and proposed measuring with vs
without it, both to improve the skills and to benchmark their effect.
