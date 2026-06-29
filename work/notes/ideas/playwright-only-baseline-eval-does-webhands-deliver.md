---
title: A Playwright-only baseline agent configuration for the eval harness, to measure "does webhands deliver?" by comparing token cost + pass-rate against a webhands agent on the same goals
slug: playwright-only-baseline-eval-does-webhands-deliver
type: idea
status: proposed
created: 2026-06-29
---

## The idea

Run the SAME eval goals with two agent configurations and compare them:

1. a **webhands** agent (the verb surface), and
2. a **Playwright-only** agent (raw Playwright, no webhands at all).

Compare on **token cost** (the `eval-token-accounting-for-webhands-vs-baseline` task adds this to the output) and **pass-rate / milestones**. If the webhands agent reaches the goals in materially fewer tokens (and/or higher pass-rate), the verb surface is demonstrably earning its keep. That is the concrete, measurable answer to the prd `agent-capability-eval-harness` north star ("does webhands actually deliver?"), turning a belief into a scoreboard number.

## Why it fits the harness cleanly

- The harness is deliberately **agent-toolkit-agnostic**: the `AgentUnderTest` launch seam launches any agent invocable as a shell command, fed the goal + a toolkit-specific protocol preamble. A Playwright-only agent is just another adapter/command whose preamble teaches Playwright instead of the webhands verb surface.
- The eval's **goal** and the harness's **end-state assertion** are unchanged between the two configs (the harness validates via its own reads regardless of how the agent drove). Only the agent's toolkit + preamble differ.
- The two prompts WILL differ (different toolkits), and BOTH need the agent to leave the browser open for verification, so the "leave the session open" instruction is a per-adapter PROTOCOL preamble, not goal priming (see `work/notes/observations/eval-end-state-assertion-needs-the-agent-to-leave-the-session-open.md`).

## Dependencies / sequencing

- DEPENDS ON token accounting in the eval output (`work/tasks/backlog/eval-token-accounting-for-webhands-vs-baseline.md`) so the comparison has a number.
- Likely also wants the leave-session-open fix (the observation above) so a tidy agent does not score a false INCONCLUSIVE and skew the comparison.
- A subtlety to design through: a Playwright-only agent needs Playwright AVAILABLE to it (a driving surface + a live browser/page) without going through webhands; decide whether it drives its own Playwright or a harness-provided page, and keep the end-state assertion the harness's own (never the agent's self-report), so the comparison is fair.

## Status

Proposed (idea), 2026-06-29, from the live-demo conversation where the value of measuring webhands against a no-webhands baseline became clear. Promote to a task once the token-accounting task lands and the leave-session-open fix is decided.
