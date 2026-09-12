import {existsSync, readFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
	PACKAGE_ROOT,
	SKILLS_DEPTH,
	SKILLS_DIR,
	SKILLS_INCLUDE,
	SKILL_PATHS,
} from '../src/skills.js';

/**
 * The hand-authored `use-webhands` skill must SHIP INSIDE the published package
 * and be installable from it (task
 * `ship-use-webhands-skill-in-published-package`).
 *
 * Before this, `files` omitted the skill and the CLI passed no `sync` option at
 * all, so the tarball carried no skill and `webhands skills add` had nothing
 * hand-authored to install — while `README.md` already told users to install
 * "the bundled skill". Consumers were forced to symlink the skill out of a git
 * CHECKOUT, which is mutable and unversioned: it describes whatever branch that
 * clone sits on, not the binary the reader actually has.
 *
 * Three failure modes are guarded here, all of which are silent at runtime (a
 * missing skill makes `skills add` succeed with one fewer skill, not error):
 *
 * 1. the skill file is not where the CLI's own resolution says it is,
 * 2. `files` stops carrying `skills`, so `npm pack` drops it again, and
 * 3. the emit layout changes so `PACKAGE_ROOT` no longer names the package.
 *
 * The END-TO-END proof (pack, install the tarball into a scratch project with
 * no clone present, run `skills add`, assert the skill lands) is deliberately
 * NOT automated here: it needs a real `pnpm pack` plus a registry install, and
 * `skills add` writes into the user's REAL agents-skills directory
 * (`~/.agents/skills/`, via `os.homedir()`), which a unit test must never
 * touch. It is a release-time check; these assertions are its cheap standing
 * guard.
 */

/** This package's manifest, read fresh (not imported) so `files` is asserted as published. */
function manifest(): {files?: string[]; name?: string} {
	return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
}

describe('use-webhands skill packaging', () => {
	it('resolves PACKAGE_ROOT to this package, from src/ or dist/', () => {
		// One level up from the module, in BOTH layouts (the tsc emit is flat).
		// If this breaks, every path below is wrong in the published package only
		// — which is exactly the failure that shipped 0.6.0 with no skill.
		expect(manifest().name).toBe('webhands');
	});

	it('ships the skill inside the package directory', () => {
		const path = SKILL_PATHS['use-webhands'];
		expect(path).toBeDefined();
		expect(existsSync(path!)).toBe(true);

		// Inside the PACKAGE, not the monorepo root: `files` can only ship what
		// lives under the package dir, and `incur` resolves its globs from here.
		const rel = relative(PACKAGE_ROOT, path!);
		expect(rel.startsWith('..')).toBe(false);
		expect(rel).toBe(join('skills', 'use-webhands', 'SKILL.md'));
	});

	it('lists the skills directory in package.json files', () => {
		// `files` is what actually decides tarball contents; its omission is the
		// single line that kept the skill out of every release so far.
		expect(manifest().files).toContain('skills');
	});

	it('matches every shipped skill with the include globs handed to incur', () => {
		// `incur` names an included skill after its PARENT DIRECTORY, so the glob
		// and the on-disk layout have to agree for the skill to be installable.
		expect(SKILLS_INCLUDE).toContain('skills/*');
		for (const [name, path] of Object.entries(SKILL_PATHS)) {
			expect(path).toBe(join(SKILLS_DIR, name, 'SKILL.md'));
		}
	});

	it('keeps generated skills collapsed into a single command reference', () => {
		// depth 0 = one generated `webhands` skill. The default (1) emits one per
		// verb — 26 near-duplicates of a reference `use-webhands` already carries
		// in full, which buries the hand-authored skill in the agent's skill list.
		expect(SKILLS_DEPTH).toBe(0);
	});
});
