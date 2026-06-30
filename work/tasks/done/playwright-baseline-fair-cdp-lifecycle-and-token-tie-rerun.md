---
title: Make the Playwright baseline leg FAIR on multi-script flows (its scripts must disconnect/exit, not hang on the CDP connection) + re-run the script-only token tie
slug: playwright-baseline-fair-cdp-lifecycle-and-token-tie-rerun
blockedBy: []
covers: []
---

## What to build

Fix the Playwright-only baseline leg so it can COMPLETE a multi-script
read-decide-loop flow, then re-run the clean script-only-vs-Playwright TOKEN tie on
the dynamic eval. RIGHT NOW the baseline reliably SELF-STALLS and that confounds
the scoreboard (finding
`work/notes/findings/playwright-baseline-self-stalls-on-connectovercdp-lifecycle-dynamic-eval.md`):
on `cart-threshold-checkout` the Playwright agent FAILed 4/4 consecutive runs,
ALWAYS at 1/4, ALWAYS ~0.19-0.23M tokens, because its exploration script does
`chromium.connectOverCDP(...)` then never disconnects (and uses
`waitUntil:'networkidle'`), so `node explore.js` HANGS to the wall-clock cap and
the run dies before the agent ever drives the cart loop. The webhands-script-only
leg PASSed 4/4 (~1.6-2.3M) the same runs. So the "Playwright FAILs the dynamic
eval" rows OVERSTATE webhands' win: the baseline is losing on a self-inflicted
`connectOverCDP`-lifecycle bug, not on capability. Make the baseline FAIR, then
the tie-or-beat number is honest.

### Root cause (read the finding first)

The Playwright preamble (`PLAYWRIGHT_PREAMBLE` in `evals/src/no-priming.ts`, around
line 364) tells the agent to `connectOverCDP` and, in its `leaveOpenRule`, to NOT
`browser.close()` (correct: closing would end the shared session the harness
verifies) and notes "Disconnecting from the shared browser is fine". But it NEVER
tells the agent that EACH `node` script it writes MUST `browser.disconnect()` (or
otherwise let the process EXIT) or the live CDP connection keeps Node's event loop
alive and the script HANGS. So the agent writes `browser.close && null` (a no-op
trying to obey "don't close") and the script never exits. It also reaches for
`waitUntil:'networkidle'`, which may never settle on an app page.

### The fix (two parts; part 1 is the high-leverage one)

1. **Steer the Playwright-leg preamble to a NON-HANGING pattern** (the real fix).
   Update `PLAYWRIGHT_PREAMBLE.toolkitReference` / `leaveOpenRule` so the agent
   knows:
   - the served browser is ALREADY at `WEBHANDS_CDP_ENDPOINT`; CONNECT with
     `connectOverCDP`, drive the existing context/page;
   - **every script it runs MUST let its `node` process EXIT** - call
     `await browser.disconnect()` at the END of each script (NOT
     `browser.close()`, which would tear down the shared browser). Disconnecting
     ends the agent's CLIENT connection without closing the served browser, so the
     process exits AND the session stays open for the harness to verify. State this
     as the explicit reason (so the agent does not "obey" the no-close rule by
     writing a no-op that leaves the connection dangling). The `leaveOpenRule`
     should DISTINGUISH "do not CLOSE the shared browser" from "DO disconnect your
     client so your script exits".
   - prefer `waitUntil:'domcontentloaded'` + an explicit locator/`waitForSelector`
     wait over `waitUntil:'networkidle'` on app pages (networkidle may never
     settle).
   This stays PROTOCOL (how to drive the shared browser correctly), NOT goal
   priming: it names no site selector and no URL, so it does not change the
   no-priming posture. (The Playwright preamble is NOT guarded by
   `assertSkilledReferenceUnprimed` - that guard is for the inlined WEBHANDS skill
   references - but keep the same spirit: no site selectors, no site URL.)

2. **A harness watchdog that reaps a hung child** (defense in depth, secondary).
   The agent runs as one `bash -c` child with a wall-clock `timeoutMs`
   (`evals/src/agent-under-test.ts`, the `spawn('bash', ['-c', command], ...)` +
   the `setTimeout(... child.kill('SIGTERM') ..., input.timeoutMs)` around line
   227-237). A hung inner `node` eats the whole wall-clock today. This is HARD to
   bound per-inner-script from outside the agent (the harness does not see the
   agent's individual tool calls), so the MINIMAL honest improvement is: confirm
   the existing SIGTERM-on-timeout actually KILLS the whole child PROCESS GROUP
   (so a hung `node` grandchild dies with the bash child, not orphaned), using a
   detached process group + `child.kill(-pid)` / `SIGKILL` escalation if SIGTERM
   leaves grandchildren. If the current teardown already group-kills, just RECORD
   that it does and leave part 2 as verified-sufficient. Do NOT over-engineer a
   per-tool-call watchdog the harness has no hook for; part 1 (the preamble) is the
   real fix.

### Re-run the token tie (the measurement)

After the fix, RE-RUN the clean head-to-head on `cart-threshold-checkout`, SAME
agent + model + `--parse-usage` as every scoreboard run, enough repeats to get a
run where BOTH `webhands-script-only` AND `playwright` COMPLETE the loop (PASS),
plus a small spread. Record the result in `evals/SCOREBOARD.md` updating /
appending to the `### Script-only head-to-head` subsection: the clean TOKEN tie
(both finish, who is leaner) with the actual numbers, and whether the
`connectOverCDP`-lifecycle fix let Playwright complete. If Playwright STILL cannot
complete after a fair preamble, record THAT honestly (a deeper capability finding),
do not fabricate a tie.

## Acceptance criteria

- [ ] `PLAYWRIGHT_PREAMBLE` steers the agent to a non-hanging CDP pattern: each
      script `await browser.disconnect()`s (so `node` exits) WITHOUT
      `browser.close()`ing the shared browser; the `leaveOpenRule` distinguishes
      "do not CLOSE the shared browser" from "DO disconnect your client"; it
      prefers `domcontentloaded`+locator-wait over `networkidle`. Stays
      site-agnostic (no selector, no URL).
- [ ] The harness's timeout teardown is confirmed (or fixed) to kill the whole
      child PROCESS GROUP so a hung inner `node` cannot be orphaned / eat the
      wall-clock silently; the behaviour is recorded.
- [ ] A re-run of the script-only-vs-Playwright tie on `cart-threshold-checkout`
      is recorded in `evals/SCOREBOARD.md` (under the existing `### Script-only
      head-to-head` subsection): the clean TOKEN comparison where BOTH legs
      complete (or an honest record that Playwright still cannot, with why).
- [ ] Any deterministic self-test touching the preamble still passes under the
      `evals` `self-test` script (the Playwright preamble is exercised by the
      no-priming / comparison plumbing tests); `pnpm test` stays green (evals are
      outside `packages/*`).
- [ ] Non-gating, under `evals/` only; no new webhands verb. No changeset needed
      for an evals-only change unless the repo convention says otherwise.

## Blocked by

- None. Touches `evals/src/no-priming.ts` (the Playwright preamble), possibly
  `evals/src/agent-under-test.ts` (the spawn/timeout teardown), and
  `evals/SCOREBOARD.md`. Builds on the finding
  `work/notes/findings/playwright-baseline-self-stalls-on-connectovercdp-lifecycle-dynamic-eval.md`
  and the `webhands-script-only` kind (already on main).

## Prompt

> Goal: make the Playwright-only baseline leg FAIR so it can COMPLETE a
> multi-script read-decide-loop, then re-run the clean script-only-vs-Playwright
> TOKEN tie on `cart-threshold-checkout`. Today the baseline reliably SELF-STALLS
> (finding `work/notes/findings/playwright-baseline-self-stalls-on-connectovercdp-lifecycle-dynamic-eval.md`):
> its `connectOverCDP` exploration script never disconnects (writes
> `browser.close && null`, a no-op, trying to obey the "do not close the shared
> browser" rule) so `node` hangs to the wall-clock cap and the run dies at 1/4,
> ~0.2M tokens, EVERY run (4/4 observed), while webhands-script-only PASSes 4/4. So
> the "Playwright FAILs the dynamic eval" rows overstate webhands' win on a
> self-inflicted baseline bug.
>
> READ FIRST: the finding above; `PLAYWRIGHT_PREAMBLE` in `evals/src/no-priming.ts`
> (~line 364 - its `toolkitReference` says connectOverCDP + take the existing
> context/page; its `leaveOpenRule` forbids `browser.close()` and only NOTES
> "disconnecting is fine" without telling the agent its script MUST disconnect to
> exit); the spawn/timeout teardown in `evals/src/agent-under-test.ts` (~line
> 227-237, `spawn('bash',['-c',command])` + `setTimeout(...child.kill('SIGTERM'))`);
> `evals/src/catalogue/cart-threshold-checkout.eval.ts`; the `### Script-only
> head-to-head` subsection of `evals/SCOREBOARD.md`.
>
> KEY DESIGN POINTS: (1, the real fix) update `PLAYWRIGHT_PREAMBLE` so the agent
> knows every `node` script it runs MUST `await browser.disconnect()` at the end
> (ends its CLIENT connection so the process EXITS) but must NOT `browser.close()`
> (which would tear down the shared browser the harness verifies); the
> `leaveOpenRule` must DISTINGUISH "do not CLOSE the shared browser" from "DO
> disconnect your client so your script exits"; prefer
> `waitUntil:'domcontentloaded'`+a locator wait over `networkidle`. Keep it
> site-agnostic (no selector, no URL) - it is PROTOCOL, not goal priming. (2,
> secondary) confirm the timeout teardown group-kills the whole child process
> tree so a hung inner `node` cannot be orphaned / silently eat the wall-clock
> (detached process group + kill(-pid) / SIGKILL escalation if needed); if it
> already group-kills, just record that. Do NOT build a per-tool-call watchdog the
> harness has no hook for.
>
> THEN re-run the tie: `webhands-script-only` vs `playwright` on
> `cart-threshold-checkout`, same agent+model+--parse-usage, enough repeats to get
> a run where BOTH COMPLETE (PASS) + a small spread. Record in the `### Script-only
> head-to-head` subsection: the clean TOKEN comparison (both finish, who is
> leaner), and whether the lifecycle fix let Playwright complete. If Playwright
> STILL cannot complete after a fair preamble, record THAT honestly (do not
> fabricate a tie).
>
> What "done" means: the Playwright preamble steers a non-hanging
> disconnect-to-exit pattern; the timeout teardown group-kill is confirmed/fixed;
> a re-run tie is recorded with both legs' real numbers (or an honest "still
> cannot, here is why"); evals self-test + `pnpm test` green; evals-only,
> non-gating, no new verb.
>
> RECORD the non-obvious decisions (the exact disconnect-not-close wording, the
> teardown group-kill finding, and the re-run result + what it finally says about
> the clean token tie).
