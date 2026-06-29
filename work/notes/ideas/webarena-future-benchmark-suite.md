---
title: WebArena as a FUTURE full self-hosted benchmark suite for the agent-capability eval harness
slug: webarena-future-benchmark-suite
type: idea
status: incubating
created: 2026-06-29
source: 'prd agent-capability-eval-harness (User Story 14 + ## Out of Scope: "WebArena full-benchmark integration ... Noted as a FUTURE self-hosted benchmark suite; out of initial scope") while building work/tasks/ready/eval-harness-docs-and-missing-verb-convention.md'
---

## The ambition

[WebArena](https://webarena.dev) is a standardized, self-hosted benchmark of
realistic web tasks (its own reproducible site instances + a task/verification
set). It is the natural FUTURE upgrade to the eval harness's hand-curated tiered
catalogue (Tier-1 SauceDemo, Tier-2 ParaBank, Tier-3 Magento/Luma): a much richer,
reproducible set of real-web tasks with self-hosted targets, which would remove
the Cloudflare/origin flakiness of the public demo stores (see
`work/notes/findings/magento-demo-tier3-stability.md`) AND give a standardized,
comparable capability number rather than a few curated flows.

## Why it is OUT of v1 scope (recorded, not built)

The prd puts it explicitly in `## Out of Scope` ("WebArena full-benchmark
integration ... out of initial scope") so the ambition is captured without
bloating v1. v1 is the harness spine + a small hand-curated catalogue + the docs
and conventions; WebArena would be a separate, larger piece of work:

- it needs **self-hosting** the WebArena site instances (infra), which is a real
  operational commitment beyond pointing at a public sandbox;
- it would plug into the SAME `AgentUnderTest` launch seam + `{goalPrompt,
  endStateAssertion, milestones[]}` eval contract the foundation already defines,
  so adopting it later is additive (new `*.eval.ts` entries + a self-hosted-target
  story), not a re-architecture;
- it stays subject to the harness's load-bearing properties unchanged:
  **non-gating** (never in `pnpm test`), **no-priming** (goal + verb surface
  only), and the **missing-verb-as-FINDING** convention (a verb a WebArena task
  reveals as missing is a finding, not new harness scope).

## Next step when picked up

A surface/eval PRD scoped to: self-host the WebArena instances, map a subset of
its tasks onto the existing eval contract, and decide the run cadence (its scale
makes it even more clearly a scheduled scoreboard than a manual run). Until then
this note keeps the ambition from evaporating.
