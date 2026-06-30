---
title: Cut the per-run CONTEXT overhead a webhands agent pays (suppressible CTA blocks + a skill that obviates runtime `--help`/`--llms-full`)
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

- **A suppressible CTA (#2).** Add a global output flag to STOP appending the
  `cta` block, e.g. `--no-cta` (or `--quiet`), sitting beside the existing global
  output flags (`--format`, `--filter-output`, `--full-output` in the CLI). STRONG
  DEFAULT to consider + record: auto-suppress the CTA when `--format json` (a
  machine/agent consumer never wants the human-facing suggestion), keeping it ON
  for the default human TOON format. The CTA is a human onboarding affordance; an
  agent piping `--format json` is the case to trim. Decide + record whether it is
  opt-out flag, format-conditioned default, or both.
- **A skill that OBVIATES runtime `--help`/`--llms-full` (#1).** The
  `skills/use-webhands/SKILL.md` (and the inlined eval skilled-preamble derived
  from it) must be a confident, COMPLETE-ENOUGH verb reference that a skilled agent
  does NOT need to run `--help`/`--llms-full` at runtime. Concretely: make the
  skill state plainly "this is the full verb reference; you do NOT need to run
  `--help` or `--llms-full`, drive directly", and ensure the verb quick-reference
  it carries is complete enough to act on (it already lists the verbs; add the
  must-know argument forms, e.g. the `page.`-prefixed locator form, so the agent
  has what `--help` would have told it). This is the highest-leverage cut: it
  removes the ~4.4KB re-dump.
- **Docs steer the invocation (#3, light).** The skill names the canonical
  invocation (`npx webhands <verb>`) up front so a real deployment's agent does not
  hunt for the bin. (The eval cwd artifact is harness-side and out of scope here.)

Stays a webhands SURFACE + DOCS change. The CTA flag is gated packages
(`packages/cli`, real unit coverage); the skill is `skills/use-webhands/SKILL.md`.
No new verb. No eval-harness engine change (the harness just MEASURES the win,
follow-up below).

## Acceptance criteria

- [ ] A global output flag suppresses the per-result `cta` block (e.g. `--no-cta`/
      `--quiet`); the default behaviour is recorded (incl. whether `--format json`
      auto-suppresses). Human-default output is unchanged.
- [ ] `skills/use-webhands/SKILL.md` states it is the COMPLETE verb reference and
      that the agent need NOT run `--help`/`--llms-full` at runtime, and carries the
      must-know argument forms (at least the `page.`-prefixed locator form) so that
      is true; it names the canonical `npx webhands <verb>` invocation up front.
- [ ] Real unit coverage in `packages/cli` for the CTA-suppression flag (a verb run
      with it emits NO `cta` block; without it, the CTA is present); `pnpm test`
      stays green.
- [ ] No new webhands verb; no eval-harness engine change.
- [ ] Docs updated: the flag in `--help`/`--llms-full`; a changeset added.

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
> KEY DESIGN POINTS: (CTA) add a global flag to suppress the `cta` block
> (`--no-cta`/`--quiet`), beside the existing output flags; STRONGLY CONSIDER
> auto-suppressing it when `--format json` (an agent/program consumer never reads
> the suggestion) while keeping it for the human TOON default, decide + record the
> default. (SKILL) make `skills/use-webhands/SKILL.md` a confident COMPLETE verb
> reference that says plainly the agent need NOT run `--help`/`--llms-full` at
> runtime, and carry the must-know arg forms (esp. the `page.`-prefixed locator
> form) so that holds; name `npx webhands <verb>` up front. Real unit coverage for
> the CTA flag (present without, absent with). No new verb, no harness engine
> change. Update --help/--llms-full + a changeset.
>
> What "done" means: an agent can suppress the CTA (or it is auto-suppressed under
> --format json) and the skill is a complete-enough reference that a skilled agent
> drives directly without re-dumping `--help`/`--llms-full`, removing the two
> biggest overhead payloads; human-default output unchanged; gated packages green.
>
> FIRST, confirm the CTA is still appended in `cli.ts` as described and the global
> output-flag layer + the skill shape are as described (they may have evolved);
> reconcile rather than duplicate. RECORD the non-obvious decisions (the CTA flag
> name + its default / format-conditioning, and exactly what the skill now asserts
> about not needing `--help`).
>
> FOLLOW-UP (NOT this task): re-run the scoreboard `--compare`/`--agent-kind` after
> this lands and compare the webhands legs' tokens against the recorded four-way
> BEFORE numbers to quantify the overhead cut. Leave/file that as a follow-up.
