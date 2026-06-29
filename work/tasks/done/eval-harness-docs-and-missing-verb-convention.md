---
title: Eval-harness docs (non-gating/ToS/manual framing) + the missing-verb-as-finding convention
slug: eval-harness-docs-and-missing-verb-convention
prd: agent-capability-eval-harness
blockedBy: [eval-harness-foundation]
covers: [13, 14]
---

## What to build

The docs-and-convention closer for the eval harness:

- **A harness README / docs page** placing the harness's framing alongside the existing humility note: it is the capability SCOREBOARD, deliberately SEPARATE from the deterministic correctness GATE; it is OPT-IN, NON-GATING, real-site, ToS-aware, and run manually or on a schedule (the same "manual by nature" stance as the Kayak smoke). Document how to run an eval (the harness's own runner command), how to read a result (binary pass/fail + milestones + the pass/fail/INCONCLUSIVE distinction), and the no-priming rule (the agent gets only the goal + the verb surface). State plainly that a flaky external site must never red the build and that these evals are never in `pnpm test`/`verify`.
- **The missing-verb-as-FINDING convention.** Document that if running an eval reveals a missing verb (or a verb that works on a clean fixture but breaks on a messy real DOM), that is a FINDING captured per the work/ contract (a `work/notes/findings/` note with a `source:`, and possibly the seed of a future surface PRD), NOT a change to this harness and NOT a new verb added here. This keeps the harness a measurement tool, not a surface change.
- **The WebArena future note.** Record WebArena (`webarena.dev`) as a FUTURE full self-hosted benchmark suite, out of initial scope, so the ambition is captured without bloating v1 (a short docs note and/or a `work/notes/ideas/` item).
- **ToS / authorized-target framing.** Reiterate (consistent with ADR-0002 and the README humility note) that targets are preferably automation-built SANDBOXES, that production sites carry anti-bot/ToS/2FA/real-state hazards and are not standing evals, and that the harness drives webhands as the real, logged-in user on their own machine/IP.

Docs-and-convention only: no harness behaviour change. The non-gating MECHANISM itself is built and proven in `eval-harness-foundation`; this task DOCUMENTS it and the surrounding conventions.

## Acceptance criteria

- [ ] A harness docs page exists framing it as the opt-in, non-gating, real-site, ToS-aware capability scoreboard, separate from the `verify` gate, run manually/scheduled (the "manual by nature" stance), and explaining how to run an eval and read its result (binary + milestones + INCONCLUSIVE).
- [ ] The no-priming rule is documented (agent gets only the goal + verb surface; no selectors/steps/site foreknowledge).
- [ ] The missing-verb-as-FINDING convention is documented: a missing/messy-DOM-broken verb discovered by an eval becomes a `work/notes/findings/` note (with `source:`) and possibly a future surface PRD, not a new verb or a change here.
- [ ] WebArena is recorded as a FUTURE out-of-scope benchmark suite (docs note and/or a `work/notes/ideas/` item).
- [ ] The ToS / authorized-sandbox-target framing is stated, consistent with ADR-0002 and the existing README humility note.
- [ ] No automated test depends on a live third-party site; doc-only portions need no test (changeset added if docs/code warrant it per the repo convention).

## Blocked by

- `eval-harness-foundation`, the docs describe the harness's runner command, its result shape (binary + milestones + INCONCLUSIVE), and its non-gating mechanism, which that task defines.

## Prompt

> Goal: land the docs and conventions for the agent capability eval harness, per the prd `work/prds/tasked/agent-capability-eval-harness.md` (User Stories 13 and 14; ## Out of Scope; ## Further Notes). This is documentation + convention, NOT a behaviour change.
>
> READ FIRST: the prd (especially ## Out of Scope and ## Further Notes' north-star framing), `tasks/done/docs-tos-humility-and-kayak-smoke.md` (the existing non-CI "manual by nature" humility note to sit alongside), ADR-0002 (real-session / personal-use / ToS scope), and the completed `eval-harness-foundation` task + done record (for the runner command, the result shape, and the non-gating mechanism to document accurately).
>
> Write a harness docs page that frames it as the OPT-IN, NON-GATING, real-site, ToS-aware capability SCOREBOARD, deliberately separate from the deterministic `verify` gate (`pnpm format:check && pnpm build && pnpm test`), run manually or on a schedule. Document: how to run an eval (the harness's own runner command), how to read a result (binary pass/fail + milestones + the pass/fail/INCONCLUSIVE distinction), the no-priming rule (agent gets only the goal + the verb surface), and that a flaky external site must never red the build (these evals are never in `pnpm test`).
>
> Document the MISSING-VERB-AS-FINDING convention: a verb an eval reveals as missing, or one that works on a clean fixture but breaks on a messy real DOM, becomes a `work/notes/findings/` note (with a `source:` per the work/ contract) and possibly a future surface PRD, NOT a new verb and NOT a change to this harness. Record WebArena (`webarena.dev`) as a FUTURE out-of-scope benchmark suite (a docs note and/or a `work/notes/ideas/` item). Reiterate the ToS / automation-built-sandbox-preferred framing consistent with ADR-0002 and the README humility note.
>
> What "done" means: a docs page with the scoreboard-vs-gate framing, run/read instructions, the no-priming rule, the missing-verb-as-finding convention, the WebArena future note, and the ToS/sandbox framing; no live-site test added; a changeset if warranted.
>
> FIRST, check this task against current reality: confirm `eval-harness-foundation` landed and the runner command / result shape / non-gating mechanism are as you describe them; if they differ, document what actually shipped, not the assumed shape (WORK-CONTRACT.md "Drift is a needs-attention signal"). RECORD non-obvious in-scope decisions.
