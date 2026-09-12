import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Where `webhands skills add` finds the hand-authored skill it installs.
 *
 * ## Why this resolves from the MODULE, not the cwd
 *
 * `skills add` / `skills list` come from `incur` for free, and `incur` picks up
 * hand-authored SKILL.md files through `sync.include` globs resolved against a
 * `sync.cwd`. Its DEFAULTS are asymmetric (`incur@0.4.x`, `SyncSkills.ts`):
 * `sync()` falls back to a package root walked up from `realpath(argv[1])`,
 * while `list()` falls back to `process.cwd()`. Taking the defaults therefore
 * yields an `add` that works and a `list` that silently omits the skill from
 * any directory that is not the package root — the two commands would disagree
 * about which skills exist. Passing an EXPLICIT `cwd` derived from this
 * module's own location makes both correct from anywhere, which is the whole
 * point: a consumer runs `npx webhands skills add` from their own project, with
 * no checkout of this repo anywhere on the machine.
 *
 * ## Why `..` is the package root in BOTH layouts
 *
 * The tsc emit is flat (`src/skills.ts` -> `dist/skills.js`), so this module
 * sits exactly one level under the package root whether it is running from
 * `src/` (vitest, tsx) or from `dist/` (the published package). The skill is
 * authored at `<package>/skills/` and shipped by the `files` entry of the same
 * name, so the same path serves development and an npm install. If the emit
 * layout ever gains a nested directory, {@link SKILL_PATHS} stops resolving and
 * the skills test fails loudly rather than shipping a skill nobody can install.
 */
export const PACKAGE_ROOT: string = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
);

/** The directory holding the hand-authored skill(s) shipped with the package. */
export const SKILLS_DIR: string = join(PACKAGE_ROOT, 'skills');

/**
 * The `incur` glob(s) naming the hand-authored skills to install alongside the
 * generated command reference. `incur` names each matched skill after its
 * PARENT DIRECTORY, so `skills/*` installs `use-webhands` from
 * `skills/use-webhands/SKILL.md`.
 */
export const SKILLS_INCLUDE: readonly string[] = ['skills/*'];

/**
 * The generated-skill grouping depth.
 *
 * `incur` ALWAYS generates skill files from the command map; `depth` decides how
 * many. The default (`1`) emits one per verb — 26 skills for this CLI, which
 * floods an agent's skill list with near-duplicates of a reference the
 * hand-authored `use-webhands` skill already carries in full (it states outright
 * that the reader need not run `--help` / `--llms-full`). `0` collapses them
 * into a SINGLE `webhands` command reference beside `use-webhands`.
 *
 * Zero generated skills is not reachable through `incur@0.4.x`: `SyncSkills`
 * renders the command map unconditionally and installs whatever it rendered, so
 * one generated skill is the floor. `0` is that floor.
 */
export const SKILLS_DEPTH = 0;

/** Absolute path to each hand-authored skill file shipped with the package. */
export const SKILL_PATHS: Readonly<Record<string, string>> = {
	'use-webhands': join(SKILLS_DIR, 'use-webhands', 'SKILL.md'),
};
