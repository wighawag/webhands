---
title: Simplify the `script` verb to a single source - a file PATH positional (drop the inline-string arg, `--file`, and stdin)
slug: simplify-script-verb-to-file-path-only
blockedBy: []
covers: []
---

## What to build

Make the `script` verb take its JS source EXACTLY ONE way: a **file path
positional argument**. Drop all three of today's alternatives (the inline-string
positional, the `--file <path>` flag, and the stdin pipe). After this change:

- `npx webhands script ./flow.js` is the ONLY form. The positional argument is a
  PATH; the verb reads that file and runs it.
- `--file` is REMOVED (the positional IS the file now, so the flag is redundant).
- The inline-string form (`npx webhands script "async (page) => {...}"`) is
  REMOVED. A bare-source string is no longer accepted.
- The stdin form (`cat flow.js | npx webhands script`) is REMOVED.

This is a deliberate SIMPLIFICATION (user decision): one source, one rule. It also
makes the file-first workflow the ONLY workflow, which is exactly the ergonomic a
raw-Playwright agent already uses (write a flow file, run it) and the path we want
agents on when we measure `script`-vs-Playwright next. The driver-context
semantics of `script` (the full live Playwright `page`, ADR-0012, the ADR-0003
seam-clean RETURN) are UNCHANGED - only HOW the source is supplied changes.

### Where it lives (read first, reconcile - do not duplicate)

- `packages/cli/src/cli.ts`: the `script` command (currently a `cli.command('script', ...)`
  near line 823). Today its `args.source` is an OPTIONAL inline string, its
  `options` extend `connectionOptions` with a `--file` option, and `run` calls
  `resolveScriptSource(c.args.source, c.options.file, readScriptStdin)`. Change:
  - the positional becomes a REQUIRED `path` (a `z.string()` describing a file
    path, not optional, not the source itself);
  - DELETE the `--file` option from the `script` command;
  - DELETE the `readScriptStdin` dependency plumbing if nothing else uses it
    (`CliDeps.readScriptStdin`, the `readScriptStdin` default near line 333, and
    the `readProcessStdin`/`readScriptStdin` helper around line 1758 - confirm no
    other verb consumes stdin before removing the shared helper; if `script` was
    its ONLY consumer, remove it cleanly rather than leaving dead code);
  - REPLACE `resolveScriptSource` (the inline/`--file`/stdin/exactly-one logic
    near line 1722) with a trivial `readFile(path, 'utf8')` at the call site (or a
    tiny helper that just reads the path and gives a LOUD, typed error if the file
    is missing/unreadable - keep the `invalid-script` error code shape so callers
    that branch on it still work). A missing file must fail loud, not hang or
    crash cryptically.
  - Update the `script` command DESCRIPTION + the arg `.describe(...)` so help
    says "a path to a JS file" and shows `npx webhands script ./flow.js`. Remove
    every "inline argument OR --file OR stdin (exactly one)" phrasing.
- `packages/cli/test/wiring.test.ts`: the `script verb wiring` describe block
  (around line 458) currently tests INLINE / `--file` / STDIN / both-rejected.
  REWRITE to the single path-based contract: `script ./file.js` reads the file
  and forwards its contents into the seam `script` call (the existing `--file`
  test is the closest - keep its spirit, drop the flag); a MISSING/unreadable path
  fails loud with the typed error; the inline-string and stdin and both-rejected
  cases are DELETED (the behaviours no longer exist). The argv smoke entry
  (`{argv: ['script'], wantArgs: true, ...}` near line 237) should reflect that
  `script` now REQUIRES a path arg.

### Docs + the script-forward eval preamble (load-bearing - the agents read this)

- `evals/src/no-priming.ts` `WEBHANDS_SCRIPT_FORWARD_REFERENCE` (around line 161)
  currently tells the agent to pass the function `inline as npx webhands script
  "<that function>" or via script --file flow.js`. REWRITE to the file-only form:
  "write the function to a file, then `npx webhands script flow.js`". Keep it
  no-priming-clean (it must still pass `assertSkilledReferenceUnprimed`: no
  selector-shaped fragment, no site URL - the example stays a generic
  `async (page) => { ... }`). The `WEBHANDS_SKILL_REFERENCE` (the full per-verb
  skill reference) and the README/skill `script` examples below use the same
  file-only form.
- `skills/use-webhands/SKILL.md`: the `## Batch a sub-flow with one script`
  section (around line 84) and the per-verb reference line (around line 176) show
  `script "<js>"` / `script --file <path>` / "pipe JS on stdin". REWRITE every one
  to `npx webhands script ./flow.js` (write a file, run it). State the source is a
  FILE PATH.
- `README.md`: the `script` mentions (lines ~11, ~13, ~258, ~268) and any
  invocation example - update to the file-path form.
- `docs/adr/0012-script-verb-driver-context-page.md`: its "What it is" bullet
  "**Source from `--file <path>` OR an inline string OR stdin** (exactly one)"
  (around line 16) was a DELIBERATE part of that ADR's accepted design. This task
  NARROWS it to file-only, so RECORD the change honestly: add a dated AMENDMENT
  section to ADR-0012 (or a short superseding note) stating that the three-source
  design is narrowed to a single file-path source for simplicity (one source, one
  rule; the file-first workflow matches what a Playwright agent writes anyway),
  and that the driver-context + ADR-0003 seam-clean-return semantics are UNCHANGED.
  Do NOT silently contradict the ADR; amend it.
- A changeset: this is a BREAKING change to the `webhands` CLI surface (the inline
  and `--file` and stdin forms are gone). Mark it accordingly and describe the new
  single form.

## Acceptance criteria

- [ ] `npx webhands script ./flow.js` reads the file and runs it as the
      driver-context script; the positional argument is a FILE PATH (required).
- [ ] `--file` is removed from the `script` command; the inline-string positional
      and the stdin source are removed. A bare `webhands script` (no path) fails
      loud (path required); a missing/unreadable path fails loud with a typed,
      non-cryptic error (the `invalid-script` error shape preserved).
- [ ] If `script` was the only stdin consumer, the `readScriptStdin`/
      `readProcessStdin` plumbing + the `resolveScriptSource` multi-source helper
      are removed (no dead code left behind); the driver-context `script`
      semantics (full live `page`, ADR-0003 seam-clean return) are UNCHANGED.
- [ ] `packages/cli/test/wiring.test.ts` covers the new single contract (path
      reads the file -> seam call; missing path fails loud) and the deleted forms'
      tests are removed; `pnpm test` stays green.
- [ ] The `script-forward` eval preamble (`WEBHANDS_SCRIPT_FORWARD_REFERENCE`) and
      the inlined skill reference are updated to the file-only invocation and STILL
      pass `assertSkilledReferenceUnprimed` (no selector-shaped fragment, no site
      URL).
- [ ] Docs updated: `--help`/`--llms-full` for `script`, the `use-webhands` skill,
      the README, and a dated AMENDMENT to ADR-0012 (the three-source design is
      narrowed to file-only; driver-context + seam semantics unchanged). A
      changeset is added (breaking).
- [ ] No new verb; `eval` is untouched (it stays the page-world expression verb).

## Blocked by

- None. Touches `packages/cli` (the `script` command + its source-resolution),
  the `evals/src/no-priming.ts` preamble, `skills/use-webhands/SKILL.md`, the
  README, and ADR-0012.

## Prompt

> Goal: simplify the `script` verb to take its JS source EXACTLY ONE way - a FILE
> PATH positional. Drop the inline-string positional, the `--file` flag, AND the
> stdin pipe. After this: `npx webhands script ./flow.js` is the only form (the
> positional is a path; read it and run it). This is a deliberate user-decided
> simplification (one source, one rule) that also makes the file-first workflow -
> the same one a raw-Playwright agent uses - the only workflow.
>
> READ FIRST and reconcile with current reality (do not duplicate): the `script`
> command in `packages/cli/src/cli.ts` (around line 823 - `args.source` optional
> inline, a `--file` option, `run` calling `resolveScriptSource(source, file,
> readScriptStdin)`); `resolveScriptSource` (around line 1722, the exactly-one
> inline/`--file`/stdin logic); the `readScriptStdin`/`readProcessStdin` plumbing
> (`CliDeps.readScriptStdin`, the default near line 333, the helper near line
> 1758); the `script verb wiring` tests in `packages/cli/test/wiring.test.ts`
> (around line 458 - inline/`--file`/stdin/both-rejected); the script-forward
> preamble `WEBHANDS_SCRIPT_FORWARD_REFERENCE` in `evals/src/no-priming.ts`
> (around line 161) and `assertSkilledReferenceUnprimed`; the `script` lines in
> `skills/use-webhands/SKILL.md` (sections around lines 84 and 176); the README
> `script` mentions; and `docs/adr/0012-script-verb-driver-context-page.md` (its
> "Source from --file OR inline OR stdin" bullet, around line 16, was a deliberate
> accepted design - amend it, do not silently contradict it).
>
> KEY DESIGN POINTS (user decisions): the positional becomes a REQUIRED file path;
> `--file` removed; inline-string source removed; stdin removed. The
> source-resolution collapses to `readFile(path, 'utf8')` with a LOUD typed error
> on a missing/unreadable file (preserve the `invalid-script` error shape). If
> `script` was the ONLY stdin consumer, remove the `readScriptStdin`/
> `readProcessStdin`/`resolveScriptSource` machinery cleanly (no dead code) -
> CONFIRM no other verb uses stdin before removing the shared helper. The
> driver-context `script` semantics (full live Playwright `page`, ADR-0012) and
> the ADR-0003 seam-clean RETURN are UNCHANGED; only HOW the source is supplied
> changes. `eval` is untouched.
>
> Rewrite the wiring tests to the single contract (path reads the file -> seam
> `script` call; missing path fails loud; bare `script` requires a path), deleting
> the inline/stdin/both-rejected cases. Update the script-forward eval preamble +
> the inlined skill reference to the file-only invocation, keeping them
> no-priming-clean (still pass `assertSkilledReferenceUnprimed`, generic
> `async (page) => {...}` example, no selector/URL). Update `--help`/`--llms-full`,
> the skill, the README, and add a DATED amendment to ADR-0012 (three-source design
> narrowed to file-only; driver-context + seam semantics unchanged). Add a
> changeset (BREAKING for `webhands`).
>
> What "done" means: `script` reads a file path and nothing else; the dropped
> forms are gone with no dead code; tests green; the agent-facing preamble + skill
> + README + ADR all say the file-only form and the preamble stays
> no-priming-clean; `eval` and the driver-context semantics are untouched.
>
> RECORD the non-obvious decisions (whether stdin had other consumers, the exact
> missing-file error shape, and the ADR-0012 amendment wording).
