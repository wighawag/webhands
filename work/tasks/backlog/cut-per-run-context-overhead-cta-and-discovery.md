---
title: Cut the per-run CONTEXT overhead a webhands agent pays (CTA off by default + a per-verb skill that obviates runtime `--help`/`--llms-full`)
slug: cut-per-run-context-overhead-cta-and-discovery
blockedBy: []
covers: []
---

## What to build

Cut the token overhead a webhands agent pays AROUND the useful work, the dominant
reason the webhands legs cost more tokens than the Playwright baseline even when
they take few calls (finding
`work/notes/findings/scoreboard-api-friction-from-transcripts-ref-collision-and-page-prefix.md`
and the transcript byte-analysis below). On `saucedemo-core-flow` the leanest
webhands leg pulled ~7.3KB of tool-result bytes into context vs the Playwright
winner's ~0.56KB; the `script` RESULT itself was a lean ~0.83KB, so the gap is
OVERHEAD, not the verbs. The measured contributors, biggest first:

1. **`--help` / `--llms-full` re-dumped into context (~4.4KB, the single biggest
   payload).** Even the skilled/script-forward agent still ran `--help` 2-3x to
   (re)learn the surface. Playwright pays ZERO (it knows Playwright from training).
2. **Per-result CTA blocks.** Every verb result appends a `cta: {commands:[...]}`
   "Suggested command" block (`packages/cli/src/cli.ts`), ~5% of result bytes and
   pure overhead when an agent/program consumes the output, it never reads the
   suggestion.
3. **Bin-discovery noise (~1.3KB `ls -la` etc.).** Partly a benchmark artifact (the
   eval cwd has no installed `webhands`), but the agent's FIRST turns are spent
   finding how to invoke the tool.

This task attacks the two that are real webhands-surface/docs issues (1 and 2); 3
is mostly harness packaging and is only addressed by docs steering (name the
invocation).

End-to-end:

- **CTA suppressed BY DEFAULT (#2)** (user decision). The per-result `cta` block is
  human onboarding scaffolding; an agent driving the surface does not read it, and
  the transcripts show even COLD pi agents ignored the CTA breadcrumbs and read
  `--llms-full` anyway, so the CTA is net overhead, not discovery aid. So flip it:
  STOP appending the `cta` block by DEFAULT, and add a `--cta` (or `--hints`) flag
  to RE-ENABLE it for a human exploring interactively. (Not an opt-out `--no-cta`,
  the lean output is the default; the human affordance is opt-in.) The README's
  own step-by-step covers human onboarding, and the CTA chain is NOT an ADR'd
  load-bearing decision, so default-off is low-risk; keep the breadcrumbs reachable
  via the flag. Record the flag name.
- **An ENV override so the CTA default can be pinned without per-call flags.** The
  eval agent invokes `npx webhands <verb>` ITSELF (the harness does not inject a
  flag per call), so re-enabling CTAs for a control leg cannot rely on the agent
  passing `--cta`. Add an env var (e.g. `WEBHANDS_CTA=1`) that forces the CTA
  default back ON (and the flag still wins over it). This is what lets the harness
  pin a `cold-cta` baseline leg (below) without the agent's cooperation, and is
  generally useful (a user can set their preferred default once). Precedence:
  explicit `--cta`/no-flag > env > built-in default (off).
- **A skill that COVERS EVERY VERB so runtime `--help`/`--llms-full` is unneeded
  (#1)** (user decision). The `skills/use-webhands/SKILL.md` (and the inlined eval
  skilled-preamble derived from it) must describe WHAT EACH VERB DOES + its
  must-know argument forms, completely enough that a skilled agent does NOT run
  `--help`/`--llms-full` at runtime. Concretely: a per-verb line for every verb
  (what it does + the key args/flags), the `page.`-prefixed locator form, and a
  plain statement "this is the full verb reference; drive directly, you do not
  need `--help`/`--llms-full`". This is the highest-leverage cut: it removes the
  ~4.4KB re-dump. Keep the skill text within the eval no-priming spirit (the
  inlined preamble is guarded by `assertSkilledReferenceUnprimed`, no
  selector-shaped fragment, no site URL), so the per-verb arg examples must be
  generic, not site selectors.
- **Docs steer the invocation (#3, light).** The skill names the canonical
  invocation (`npx webhands <verb>`) up front so a real deployment's agent does not
  hunt for the bin. (The eval cwd artifact is harness-side and out of scope here.)

Stays a webhands SURFACE + DOCS change. The CTA flag is gated packages
(`packages/cli`, real unit coverage); the skill is `skills/use-webhands/SKILL.md`.
No new verb. No eval-harness engine change (the harness just MEASURES the win,
follow-up below).

## Acceptance criteria

- [ ] The per-result `cta` block is suppressed BY DEFAULT; a `--cta`/`--hints` flag
      RE-ENABLES it for a human. The flag name + the default flip are recorded.
- [ ] An env var (e.g. `WEBHANDS_CTA=1`) forces the CTA default back ON, with
      precedence flag > env > built-in default (off); unit-covered.
- [ ] A `cold-cta` eval agent kind reproduces the pre-flip cold baseline (the cold
      preamble + `WEBHANDS_CTA=1` in the agent env), so the original four-way
      numbers stay reproducible and `cold-cta - cold` isolates the CTA cost.
- [ ] `skills/use-webhands/SKILL.md` describes WHAT EACH VERB DOES + its must-know
      argument forms (a per-verb reference, incl. the `page.`-prefixed locator
      form), states plainly the agent need NOT run `--help`/`--llms-full` at
      runtime, and names the canonical `npx webhands <verb>` invocation up front.
- [ ] The inlined eval skilled-preamble derived from the skill still passes
      `assertSkilledReferenceUnprimed` (no selector-shaped fragment, no site URL):
      the per-verb arg examples are generic, not site selectors.
- [ ] Real unit coverage in `packages/cli`: a verb run emits NO `cta` block by
      default; with `--cta`/`--hints` the CTA is present; `pnpm test` stays green.
- [ ] A new webhands verb is NOT added. (This DOES touch the eval harness, the
      `cold-cta` agent kind, but adds no harness ENGINE change beyond a new kind +
      env plumbing.)
- [ ] Docs updated: the flag in `--help`/`--llms-full` + the README (default output
      no longer shows the suggestion); a changeset added.

- **A `cold-cta` baseline agent kind (keep the old baseline live, user decision).**
  Flipping the CTA default changes the absolute cold number vs the recorded
  four-way before-table (which was measured with CTAs ON). Rather than freeze a
  historical row, SPLIT cold into two live, re-runnable controls in the eval
  harness (`evals/src/bin/run-evals.ts` `AgentKind` + `evals/src/no-priming.ts`):
  - **`cold`** = the existing cold config against the NEW default (CTA off). The
    live baseline going forward.
  - **`cold-cta`** = the SAME cold config (same preamble, no skill, only the
    `--llms-full` pointer) but with CTAs forced ON via the env override above, so
    it reproduces the surface as the original four-way table measured it.
  This keeps the pre-existing baseline directly comparable (re-run `cold-cta`
  anytime), and the delta `cold-cta - cold` cleanly ISOLATES what the CTA blocks
  cost. The `cold-cta` kind just sets `WEBHANDS_CTA=1` in the agent's env (the
  `LaunchInput.env` channel) with the otherwise-identical cold preamble.

## Note on the cold-baseline measurement (read before the follow-up re-measure)

The `cold-cta` kind above is the mechanism that keeps the baseline comparable:
flipping the CTA default applies to ALL configs equally so it does not bias the
COMPARISON, and `cold-cta` reproduces the pre-flip surface so the old four-way
numbers stay reproducible. The COLD config DEFINITION is unchanged (still no skill,
only the `--llms-full` pointer); only the tool's default verbosity and the skill's
completeness change. When re-measuring (follow-up), run `cold`, `cold-cta`,
`skilled`, `script-forward`, `playwright` and record `cold-cta` against the old
row (sanity-check it reproduces) + the rest as the new state.

## Blocked by

- None. Touches `packages/cli` output (the existing `--format`/`--filter-output`
  layer) and `skills/use-webhands/SKILL.md`.

## Prompt

> Goal: cut the per-run CONTEXT overhead a webhands agent pays around the useful
> work, the dominant reason webhands legs cost more tokens than the Playwright
> baseline even at few calls (transcript byte-analysis: the leanest webhands
> core-flow leg pulled ~7.3KB of result bytes vs Playwright's ~0.56KB; the `script`
> result itself was a lean ~0.83KB, so it is OVERHEAD, not the verbs). Two real
> surface/docs fixes: (1) the ~4.4KB `--help`/`--llms-full` re-dump the agent still
> pulls at runtime, and (2) the per-result `cta: {commands:[...]}` "Suggested
> command" block every verb appends.
>
> READ FIRST: the finding
> `work/notes/findings/scoreboard-api-friction-from-transcripts-ref-collision-and-page-prefix.md`;
> `packages/cli/src/cli.ts` (where the `cta` block is appended per verb, and the
> existing global output flags `--format`/`--filter-output`/`--full-output`);
> `skills/use-webhands/SKILL.md` (the workflow skill + its verb quick-reference);
> `evals/SCOREBOARD.md` (the four-way table is the BEFORE baseline to re-measure
> against, script-forward: core-flow 1.36M, discovery 2.18M, parabank 3.32M).
>
> KEY DESIGN POINTS (user decisions): (CTA) suppress the per-result `cta` block BY
> DEFAULT and add a `--cta`/`--hints` flag to RE-ENABLE it for a human (lean output
> is the default; the human breadcrumb is opt-in). Justified: even COLD pi agents
> ignored the CTA and read `--llms-full` anyway, so it is net overhead; the CTA
> chain is not ADR'd and the README covers human onboarding, so default-off is
> low-risk. (SKILL) make `skills/use-webhands/SKILL.md` describe WHAT EACH VERB DOES
> + its must-know arg forms (a per-verb reference, incl. the `page.`-prefixed
> locator form), state plainly the agent need NOT run `--help`/`--llms-full`, and
> name `npx webhands <verb>` up front. Keep the inlined eval skilled-preamble
> derived from it passing `assertSkilledReferenceUnprimed` (no selector-shaped
> fragment, no site URL), so per-verb arg examples are GENERIC, not site selectors.
> Add an ENV override (e.g. `WEBHANDS_CTA=1`) that forces CTAs back on (precedence
> flag > env > default-off), because the eval agent invokes webhands itself and
> cannot be relied on to pass `--cta`. Then add a `cold-cta` eval agent kind
> (`evals/src/bin/run-evals.ts` + `no-priming.ts`) = the SAME cold preamble (no
> skill, only the `--llms-full` pointer) + `WEBHANDS_CTA=1` in the agent env
> (`LaunchInput.env`), so the pre-flip baseline stays live + reproducible and
> `cold-cta - cold` isolates the CTA cost. Real unit coverage for the CTA flag
> (absent by default, present with --cta) + the env override. No new verb. Update
> --help/--llms-full + README + a changeset.
>
> COLD-BASELINE NOTE: flipping the CTA default applies to ALL configs equally, so
> it does not bias the comparison, but it changes absolute numbers vs the recorded
> four-way before-table (CTAs were ON then). The cold config DEFINITION is
> unchanged (still no skill, only the `--llms-full` pointer). When re-measuring,
> re-run ALL FOUR configs into a NEW dated SCOREBOARD row labelled "CTA default-off
> + skill covers every verb"; do not cross-compare absolute numbers across the
> surface change.
>
> What "done" means: the CTA is gone by default (re-enable via flag), the skill is
> a complete per-verb reference so a skilled agent drives without re-dumping
> `--help`/`--llms-full`, removing the two biggest overhead payloads; human
> onboarding still reachable (the flag + README); the inlined preamble stays
> no-priming-clean; gated packages green.
>
> FIRST, confirm the CTA is still appended in `cli.ts` as described, the global
> output-flag layer + the skill shape are as described, and `assertSkilledReferenceUnprimed`
> still guards the inlined preamble (they may have evolved); reconcile rather than
> duplicate. RECORD the non-obvious decisions (the re-enable flag name, exactly
> what the skill now asserts about not needing `--help`, and any per-verb arg
> example you had to genericise to stay no-priming-clean).
>
> FOLLOW-UP (NOT this task): re-run the scoreboard for ALL FOUR configs after this
> lands and record a new dated row vs the four-way BEFORE numbers to quantify the
> overhead cut. Leave/file that as a follow-up.
