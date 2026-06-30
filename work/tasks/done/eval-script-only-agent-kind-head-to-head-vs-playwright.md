---
title: Add a `webhands-script-only` eval agent kind (drive EXCLUSIVELY via `script`) + benchmark it head-to-head vs Playwright on the dynamic read-decide-loop eval
slug: eval-script-only-agent-kind-head-to-head-vs-playwright
blockedBy: []
covers: []
---

## What to build

Add a NEW eval agent kind, `webhands-script-only`, whose preamble tells the agent
to drive the browser EXCLUSIVELY through the `script` verb (write a flow file, run
`npx webhands script ./flow.js`, read the result, repeat), with NO per-verb
`click`/`type`/`snapshot` shelling-out as the working path. This is the TRUEST
head-to-head with the raw-Playwright baseline: `script` hands the agent the full
live Playwright `page`, so a script-only webhands agent and a raw-Playwright agent
are writing the SAME automation against the SAME shared browser; the ONLY
difference is webhands SERVES the browser (and brings stealth/real-profile/
human-in-the-loop, which these sandbox evals do not yet stress). The hypothesis we
want to MEASURE: on a read-decide-loop flow a one-shot blind script cannot win,
the script-only webhands leg should TIE or BEAT raw Playwright on tokens, because
the surfaces are identical and webhands need not re-launch its own browser.

This is the measurement that answers "why would Playwright be better if webhands
gives the same surface via scripts?" - it isolates the surface from the
chattiness/discovery confounds the other kinds carry.

Scope: non-gating, under `evals/` only. A new `AgentKind` + adapter + preamble
(mirrors how `webhands-cold-cta` and `webhands-script-forward` were added), NO
harness-engine change, NO new webhands verb. Then RUN it and record the result.

### Where it lives (read first, reconcile - do not duplicate)

- `evals/src/no-priming.ts`: add a `WEBHANDS_SCRIPT_ONLY_REFERENCE` +
  `WEBHANDS_SCRIPT_ONLY_PREAMBLE`, mirroring `WEBHANDS_SCRIPT_FORWARD_REFERENCE` /
  `WEBHANDS_SCRIPT_FORWARD_PREAMBLE` (around line 161 / 209). The reference must:
  - instruct the agent to drive the WHOLE flow through `script` (the file-only
    form landed by `simplify-script-verb-to-file-path-only`: write the function to
    a file, then `npx webhands script ./flow.js`); the agent reads the live page
    INSIDE the script (Playwright locators/`textContent`/etc.) and returns a
    serializable value, then writes the NEXT script based on what it read - so a
    read-decide-loop is a sequence of `script` files, each one model turn;
  - keep `serve` lifecycle + the leave-open rule (reuse `WEBHANDS_LEAVE_OPEN_RULE`);
  - stay NO-PRIMING-CLEAN: it MUST pass `assertSkilledReferenceUnprimed` (no
    selector-shaped fragment - so NO `#id`/`.class`/`[attr=]` in the example; use
    a generic `async (page) => { ...use the Playwright page API... ; return a
    serializable value }` like the script-forward example does - and NO site URL).
    Mirror the exact genericity of the existing script-forward example.
- `evals/src/agent-under-test.ts`: add a `WebhandsScriptOnlyAdapter extends
  ShellAdapter` (mirror `WebhandsScriptForwardAdapter`, ~line 347) wired to the
  new preamble; import it where the others are imported (~line 8-11).
- `evals/src/bin/run-evals.ts`: add `'webhands-script-only'` to the `AgentKind`
  union (~line 147) and the `AGENT_KINDS` array (~line 153), a `case
  'webhands-script-only': return new WebhandsScriptOnlyAdapter(opts)` in
  `buildAgent`, and the import. Update the `--agent-kind` help text that lists the
  kinds. No `--compare` machinery change is required (it is a single-config kind,
  run via `--agent-kind webhands-script-only`, exactly like the others).
- `evals/src/index.ts`: export the new preamble/adapter if the others are exported
  there (match the existing surface).

### The deterministic self-test

- Add coverage under the `evals` `self-test` script (never `pnpm test`): the new
  `WEBHANDS_SCRIPT_ONLY_REFERENCE` passes `assertSkilledReferenceUnprimed`; the
  `WebhandsScriptOnlyAdapter` is named `webhands-script-only` and feeds the agent
  the script-only preamble on stdin (same launch mechanism as the other adapters);
  `buildAgent('webhands-script-only', ...)` returns it. Mirror the existing
  `webhands-cold-cta` / `webhands-script-forward` adapter tests.

### The benchmark run (the measurement - this is the point)

- RUN the new kind against the DYNAMIC eval `cart-threshold-checkout` (the
  read-decide-loop flow a blind script cannot one-shot, from
  `tasks/done/eval-dynamic-non-scriptable-mid-run-goal-shift.md`) head-to-head with
  the raw-Playwright baseline, using the SAME agent + model + `--parse-usage` as
  every other scoreboard run (`pi --print --mode json --tools bash,read,write
  --model etherplay/claude-opus-4-8`). A live `script-only` leg + a `playwright`
  leg (and, for context, the `script-forward` leg too if cheap). Record a NEW
  dated subsection under the existing `## Dynamic (non-scriptable) read` section of
  `evals/SCOREBOARD.md` titled for the script-only head-to-head, stating the
  hypothesis (TIE-or-BEAT: identical surface, no re-launch) and the ACTUAL result
  whichever way it falls (both informative). NOTE in the scoreboard that the
  script-only leg is the cleanest "is the surface itself competitive?" reading,
  because it removes the chattiness confound.
  - If the live site/fixture or the agent makes the run INCONCLUSIVE, retry per
    the harness's bounded-retry, and if it stays inconclusive record THAT honestly
    (do not fabricate a number); the kind + self-test still land.

## Acceptance criteria

- [ ] A new `webhands-script-only` `AgentKind` + `WebhandsScriptOnlyAdapter` +
      `WEBHANDS_SCRIPT_ONLY_PREAMBLE`/`_REFERENCE`, wired into `buildAgent`,
      `AGENT_KINDS`, and `--agent-kind` (mirrors `webhands-cold-cta` /
      `webhands-script-forward`); no harness-engine change, no new webhands verb.
- [ ] The preamble drives the flow EXCLUSIVELY via the file-only `script`
      (`npx webhands script ./flow.js`); the read-decide-loop is a sequence of
      `script` files. It stays no-priming-clean: passes
      `assertSkilledReferenceUnprimed` (no selector-shaped fragment, no site URL;
      generic `async (page) => {...}` example).
- [ ] A deterministic self-test (under the `evals` `self-test` script, never
      `pnpm test`) covers: the reference passes the no-priming guard; the adapter
      is named `webhands-script-only` and feeds the script-only preamble;
      `buildAgent` returns it.
- [ ] A live benchmark run of `webhands-script-only` vs `playwright` on
      `cart-threshold-checkout` is recorded in `evals/SCOREBOARD.md` (a new dated
      subsection under `## Dynamic (non-scriptable) read`) with the TIE-or-BEAT
      hypothesis and the ACTUAL result (or an honest INCONCLUSIVE if the run could
      not complete healthily).
- [ ] Non-gating, under `evals/` only; `pnpm test` stays green (the eval harness is
      outside `packages/*`); a changeset is NOT required for an evals-only change
      unless the repo convention says otherwise (reconcile with how the other
      evals-only tasks did it).

## Blocked by

- None as a CODE dependency. It BUILDS ON the file-only `script` form (task
  `simplify-script-verb-to-file-path-only`, already done) and the dynamic eval
  (`cart-threshold-checkout`, already done) + the existing `--agent-kind`
  machinery. (If either were not yet on main this would block, but both are
  merged.)

## Prompt

> Goal: add a `webhands-script-only` eval agent kind that drives the browser
> EXCLUSIVELY through the file-only `script` verb (write a flow file, `npx webhands
> script ./flow.js`, read the serializable result, write the next script), then
> BENCHMARK it head-to-head against raw Playwright on the dynamic read-decide-loop
> eval `cart-threshold-checkout`. This isolates the SURFACE from the
> chattiness/discovery confounds: a script-only webhands agent and a raw-Playwright
> agent write the SAME automation against the SAME shared browser, so it directly
> measures "is webhands-via-script competitive with raw Playwright?" The hypothesis:
> on a flow a blind one-shot script cannot win, script-only should TIE or BEAT
> Playwright (identical surface, and webhands need not re-launch its own browser).
>
> READ FIRST and reconcile (do not duplicate): `evals/src/no-priming.ts`
> (`WEBHANDS_SCRIPT_FORWARD_REFERENCE`/`_PREAMBLE` ~line 161/209 - the template;
> `assertSkilledReferenceUnprimed` and `SELECTOR_SHAPES` - what the preamble must
> NOT contain; `WEBHANDS_LEAVE_OPEN_RULE`); `evals/src/agent-under-test.ts`
> (`WebhandsScriptForwardAdapter` ~line 347 - the adapter template);
> `evals/src/bin/run-evals.ts` (`AgentKind` ~line 147, `AGENT_KINDS` ~line 153,
> `buildAgent` switch, the `--agent-kind` help); `evals/src/index.ts` (exports);
> the dynamic eval `tasks/done/eval-dynamic-non-scriptable-mid-run-goal-shift.md`
> + `evals/src/catalogue/cart-threshold-checkout.eval.ts`; the `## Dynamic
> (non-scriptable) read` section of `evals/SCOREBOARD.md` (where to record);
> `tasks/done/simplify-script-verb-to-file-path-only.md` (the `script ./flow.js`
> file-only form this preamble must use).
>
> KEY DESIGN POINTS: mirror exactly how `webhands-cold-cta` and
> `webhands-script-forward` were added (a new AgentKind + adapter + preamble, NO
> engine change). The preamble drives the WHOLE flow via `script` files
> (file-only form); the agent reads the live page INSIDE each script (Playwright
> locators/textContent) and returns a serializable value, then writes the next
> script from what it read - a read-decide-loop as a sequence of one-model-turn
> `script` runs. Keep `serve` lifecycle + the leave-open rule. It MUST pass
> `assertSkilledReferenceUnprimed`: NO selector-shaped fragment (no `#id`/`.class`/
> `[attr=]` in the example - use the SAME generic `async (page) => {...}` shape the
> script-forward example uses) and NO site URL. Add the deterministic self-test
> (reference passes the guard; adapter named + feeds the preamble; buildAgent
> returns it), under the `evals` `self-test` script, never `pnpm test`.
>
> THEN RUN the benchmark: a live `webhands-script-only` leg + a `playwright` leg
> (and `script-forward` for context if cheap) on `cart-threshold-checkout`, SAME
> agent + model + `--parse-usage` as every scoreboard run. Record a NEW dated
> subsection under `## Dynamic (non-scriptable) read` with the TIE-or-BEAT
> hypothesis and the ACTUAL result, noting the script-only leg is the cleanest
> "is the surface itself competitive?" reading. If it cannot complete healthily,
> record an honest INCONCLUSIVE - do not fabricate a number; the kind + self-test
> still land.
>
> What "done" means: the `webhands-script-only` kind exists and is wired
> everywhere the other kinds are, its preamble is script-exclusive + file-only +
> no-priming-clean, a deterministic self-test covers it, and a live head-to-head vs
> Playwright on the dynamic eval is recorded on the scoreboard with the hypothesis
> and the real result. Non-gating, evals-only, no new verb, `pnpm test` green.
>
> RECORD the non-obvious decisions (the exact script-only preamble wording, how the
> read-decide-loop is framed as a sequence of script files, and the benchmark
> result + what it says about surface competitiveness).
