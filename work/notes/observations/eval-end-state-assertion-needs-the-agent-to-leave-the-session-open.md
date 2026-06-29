# Eval end-state assertion breaks when the agent tears down / navigates away from the session it leaves behind

2026-06-29 (noticed during the first live `run-eval` against a real site)

## What was seen

Live run: `pnpm --filter @webhands/evals run-eval --eval saucedemo-core-flow --headed --agent-cmd "pi --mode json --tools bash,read"` against the REAL https://www.saucedemo.com/ (verified HTTP 200, NOT down). The unaided agent (pi) drove the whole flow correctly and reached `checkout-complete.html` showing "Thank you for your order!". Then, being a tidy agent, it ran `webhands stop` ("Browser session torn down cleanly").

The harness then ran its OWN independent end-state assertion (prd property 2: the harness checks via read verbs, never the agent's self-report). But the session was gone, so the harness's precheck `goto https://www.saucedemo.com/` failed ("entry URL unreachable"), and the run scored **INCONCLUSIVE (milestones 0/4)** even though the agent had SUCCEEDED.

Root cause: the harness's verdict has an UNSTATED assumption that, when the agent reports done, it has LEFT the session alive AND on (or reachable from) the final state. Two ways an agent breaks that:

1. **Self-teardown** (this run): the agent calls `stop`, destroying the session the harness needs.
2. **Navigation drift** (the earlier `pi -p` run, which scored PASS but `milestones 0/4`): the agent navigates all the way to the completion page, so by the time the harness samples the intermediate milestones (reached-cart, reached-checkout) those states are already gone. Only the final end-state assertion still matched.

Both stem from the same thing: the harness asserts AFTER the agent finishes, against whatever live state the agent happened to leave.

## Why the naive fix is wrong, and what the right one is

The naive fix is to tell the agent in its GOAL-PROMPT "don't close the browser / don't run stop". That is wrong for two reasons:

- It is webhands-SPECIFIC ("don't run `webhands stop`"), but the harness is meant to be **agent-toolkit-agnostic**: a planned **Playwright-only** agent configuration (no webhands at all) will drive the SAME evals to compare token cost (see the token-accounting task). A webhands-specific instruction cannot live in a shared goal-prompt.
- It risks leaking into the goal as noise that does not serve the task.

BUT (the resolving insight, 2026-06-29): the webhands-agent and the Playwright-only-agent get **different prompts anyway** (different toolkits), and **BOTH** need the browser/session left open for the harness to validate. So "when you are done, STOP and leave the browser open and on the final page for verification; do not close or reset it" is not goal priming at all — it is a **harness-PROTOCOL instruction that applies to EVERY adapter**, the rule of the test. It belongs in the per-adapter harness preamble (the toolkit-specific wrapper around the goal), NOT inside the goal-prompt, and NOT as selectors/steps. The no-priming rule still binds the GOAL; the protocol preamble is a separate, legitimate layer (it tells the agent how the test is administered, not how to solve it).

Possible implementations to weigh in the fix task:

- A per-adapter **protocol preamble** that says "leave the browser open on the final state for verification; do not stop/close/reset it." Toolkit-specific wording (webhands: "do not run `webhands stop`"; Playwright: "do not `browser.close()`"), composed by the adapter, kept out of the goal-prompt.
- AND/OR make the harness ROBUST to a closed session: if the post-run precheck finds no live session, the harness RE-ESTABLISHES its own read-only session (re-`serve` + re-`goto` the entry) before asserting — so a tidy agent cannot cause a false INCONCLUSIVE. (This is the stronger fix: it does not depend on the agent obeying an instruction.)
- For the milestone-timing half: either sample milestones DURING the run (observe state transitions), or make each milestone an END-STATE-PERSISTENT check (a fact still true on the final page), or accept that milestones are best-effort and only the final assertion is authoritative. Decide which in the fix task.

## Scope

Surfaced during a human-driven live demo, not a task build. The fix lives in the eval-harness FOUNDATION (`evals/src/run-eval.ts` + the adapter preamble in `evals/src/agent-under-test.ts` / `no-priming.ts`), not in any per-tier eval. Worth a fix task; the harness-re-establishes-its-own-session option is the most robust and the most agent-toolkit-agnostic.
