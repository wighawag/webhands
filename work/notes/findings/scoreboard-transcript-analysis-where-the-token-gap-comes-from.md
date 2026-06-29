# Where webhands' token gap comes from: a transcript-level read of the scoreboard runs (2026-06-29)

Grounded in the actual agent session transcripts (`~/.pi/agent/sessions/`) of the
scoreboard `--compare` runs, not speculation. Each eval ran the SAME goal + agent
+ model under two toolkits; the webhands leg cost ~4-8x more tokens (see
`evals/SCOREBOARD.md`). The transcripts say exactly why, and point at two concrete
webhands improvements.

## The matched evidence

Tool-call counts, same goal, same agent/model, two toolkits:

| Eval | webhands turns / calls | Playwright-only turns / calls |
| --- | --- | --- |
| `saucedemo-discovery` | 28 / 27 | 12 / 11 |
| `parabank-transfer`   | 41 / 40 | 13 / 12 |

The webhands agent takes **3-4x more turns**. Two distinct causes, both visible in
the transcripts.

### Cause 1: DISCOVERY TAX (front-loaded, one-time-per-run)

The webhands preamble (`evals/src/no-priming.ts` `VERB_SURFACE_REFERENCE`) tells
the agent: *"Your only tool is the `webhands` CLI. Discover its full verb surface
with `npx webhands --llms-full`."* So the agent spends its FIRST several turns just
learning the API. In `saucedemo-discovery`, calls 1-10 (37% of all tool calls)
were:

```
1. npx webhands --llms-full          # didn't resolve (npx webhands not installed in the eval cwd)
2. which npx node npm; ls node_modules/.bin
3. ls -la; ls ../; ls ../packages    # hunting for the bin
4. cat ../packages/cli/package.json; ls node_modules/webhands
5. node ../packages/cli/dist/bin.js --llms-full | head -100
6-10. sed -n through the --llms-full doc, verb section by verb section
```

Only at call #7 (saucedemo) / #7 (parabank) did the agent first DRIVE the browser.
The Playwright agent skips ALL of this: Playwright is in the model's training data,
so turn 1 is already `connectOverCDP` + driving. The webhands API is NOT in the
model's prior, so it must be paid for at runtime, every run.

(Aggravating factor in THESE runs: `npx webhands` did not resolve in the eval cwd,
so the agent also burned turns locating `packages/cli/dist/bin.js`. That part is a
harness packaging wrinkle, but the core discovery tax remains even with a clean
`npx webhands`.)

### Cause 2: ONE VERB PER PROCESS (recurring, per-interaction)

After discovery, the webhands agent drives one verb per `bash` invocation:
`type` username, `type` password, `click` login, `query` for refs, `click`
add-to-cart, `click` cart, ... each a separate `node bin.js <verb>` round-trip,
each re-entering the agent loop (new model turn => re-primed context => the large
`cacheRead` that dominates the token total). The Playwright agent instead WRITES A
SCRIPT (`step1_login.js`, `step2_try_problem.js`, ...) that does locate+click+type
+read in ONE file, runs it once, and reads the result. Its histogram is
`{bash: 6, write: 6}` (write a script, run it), vs webhands' `{bash: 40}`
(forty separate verb shell-outs).

So the gap is NOT "the verbs are bad". On a per-action basis the verbs work fine
(both legs PASS). The gap is **structural**: webhands forces a chatty,
one-process-per-action loop, while raw Playwright lets the agent batch a whole
sub-flow into a single script and pay for one model turn.

## What this points at (two webhands improvements)

1. **An `execute-script` / batch verb** (idea:
   `work/notes/ideas/webhands-execute-script-verb.md`). webhands already has
   `eval`, but it runs a single JS EXPRESSION and returns a serializable value;
   there is no way to hand webhands a multi-statement automation snippet
   (locate -> click -> type -> wait -> read several things) that runs IN the served
   page context in one shot. That is exactly the ergonomic the Playwright agent
   exploits by writing its own script. Giving webhands a first-class "run this
   script against the live page, here is its structured result" verb would let a
   webhands agent batch a sub-flow into ONE turn too, collapsing most of Cause 2.
   It also fits the project's stated stance ("provide both APIs where it makes
   sense"): the discrete verbs stay the floor (and the safe, snapshot-cheap path);
   the script verb is the power-user ramp for when the agent already knows what it
   wants to do.

2. **Put the webhands skill / API in context, and benchmark with vs without it**
   (idea: `work/notes/ideas/benchmark-webhands-skill-in-context.md`). The benchmark
   currently gives the agent NO webhands knowledge: it points at
   `npx webhands --llms-full` and makes the agent discover the surface cold (Cause
   1). But webhands SHIPS skills (`webhands skills` syncs them; there is a
   hand-written `skills/use-webhands/SKILL.md` workflow skill + one auto-generated
   `webhands-<verb>` skill per verb). The model knows Playwright for free; it does
   NOT know webhands for free. A fair "does the surface deliver?" reading should
   measure the webhands agent WITH its skill/API in context (the way a real user's
   agent would have it), not cold. Concretely: add a benchmark variant that injects
   the `use-webhands` skill (or the `--llms-full` text) into the webhands leg's
   preamble, and compare three points: webhands-cold, webhands-with-skill,
   Playwright-only. That both (a) measures the skill's value directly (the A/B you
   asked for) and (b) gives webhands the fair shake of not paying the discovery tax
   at runtime.

## Caveat

These are single runs; the turn/call counts will vary. But the STRUCTURAL pattern
(discovery tax + one-process-per-action vs write-a-script-once) is not noise, it is
inherent to the current shell-verb-per-action shape, and it reproduced across both
PASS evals. The two ideas above attack the two causes directly.
