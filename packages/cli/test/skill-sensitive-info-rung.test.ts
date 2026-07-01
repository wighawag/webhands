import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

/**
 * The bundled `use-webhands` skill's "handling sensitive info" rung (task
 * `env-placeholder-substitution-and-dotenv-loading`; prd
 * `distill-session-into-hand`, stories 7-8).
 *
 * An unadvertised capability is an unused one, so the skill's advertisement of
 * `{ENV:NAME}` is asserted, not assumed. Two checks, mirroring the repo's
 * existing skilled-reference-unprimed discipline (`assertSkilledReferenceUnprimed`
 * in `evals/src/no-priming.ts`):
 *
 * 1. the rung EXISTS and teaches the placeholder for credentials, and
 * 2. that rung stays NO-PRIMING-CLEAN: it must carry NO selector-shaped fragment
 *    (the `page.locator(...)`/`getBy*`/`querySelector`/`data-testid`/bare-CSS-id
 *    shapes) and NO site URL, because inlined skill text is site-agnostic
 *    PROTOCOL (how to use webhands), never goal priming for a given site.
 *
 * We assert against the SHIPPED `skills/use-webhands/SKILL.md` file (the real
 * artifact synced to an agent), not a transcription, so the advertisement cannot
 * silently rot. The `{ENV:NAME}` grammar itself is intentionally NOT selector-
 * shaped (it is a value placeholder), so it does not trip the guard.
 */

/** The selector/URL shapes inlined skill PROTOCOL text must never carry. */
const SELECTOR_SHAPES: readonly RegExp[] = [
	/page\.locator\(/i,
	/getByRole\(/i,
	/getByTestId\(/i,
	/getByText\(/i,
	/frameLocator\(/i,
	/querySelector/i,
	/\bcss=|\bxpath=/i,
	/data-testid/i,
	/#[A-Za-z][\w-]*\s*(?:\{|>|\.|$)/, // a bare CSS id selector
];
const URL_SHAPE = /https?:\/\/[^\s"'`)<>]+/i;

/** The repo-root path to the shipped skill file. */
function skillPath(): string {
	// This test file lives at packages/cli/test/; the skill is at the repo root.
	const here = dirname(fileURLToPath(import.meta.url));
	return join(here, '..', '..', '..', 'skills', 'use-webhands', 'SKILL.md');
}

/**
 * Extract the "handling sensitive info" section body: from its heading up to the
 * next `## ` heading. Returns `undefined` if the section is absent.
 */
function sensitiveInfoRung(skill: string): string | undefined {
	const match = skill.match(
		/^##\s+Handling sensitive info[^\n]*\n([\s\S]*?)(?=^##\s)/m,
	);
	return match?.[1];
}

describe('use-webhands skill: handling sensitive info rung', () => {
	const skill = readFileSync(skillPath(), 'utf8');

	it('contains a "handling sensitive info" rung teaching {ENV:NAME} for credentials', () => {
		const rung = sensitiveInfoRung(skill);
		expect(
			rung,
			'the skill must have a Handling sensitive info section',
		).toBeDefined();
		const body = rung ?? '';
		// Teaches the placeholder grammar and that it is for credentials the
		// operator supplied via the environment / .env.local, without reading them.
		expect(body).toContain('{ENV:NAME}');
		expect(body).toContain('{ENV:PASSWORD}');
		expect(body.toLowerCase()).toContain('credential');
		expect(body).toContain('.env.local');
	});

	it('the rung stays no-priming-clean: no selector-shaped fragment, no site URL', () => {
		const body = sensitiveInfoRung(skill) ?? '';
		for (const shape of SELECTOR_SHAPES) {
			expect(
				shape.test(body),
				`the sensitive-info rung must carry no selector-shaped fragment (matched ${shape})`,
			).toBe(false);
		}
		expect(
			URL_SHAPE.test(body),
			'the sensitive-info rung must name no site URL (it is site-agnostic protocol)',
		).toBe(false);
	});
});
