import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	locator,
	substituteEnvPlaceholders,
	hasEnvPlaceholder,
	UnresolvedEnvPlaceholderError,
	isControllerError,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
	type Session,
} from '../src/index.js';

/**
 * `{ENV:NAME}` placeholder substitution in value-bearing verbs (task
 * `env-placeholder-substitution-and-dotenv-loading`; prd
 * `distill-session-into-hand`, resolved decision #1).
 *
 * Two seams are covered here:
 *
 * 1. The PURE substitution function ({@link substituteEnvPlaceholders}) directly
 *    (verbatim passthrough, resolve, fail-loud), reading an EXPLICIT env map so
 *    it never touches the real `process.env`.
 * 2. The VERB layer: the `type` verb (the sole value-bearing verb) resolving
 *    `{ENV:NAME}` at type-time against a REAL local Playwright browser driving
 *    the LOCAL FIXTURE PAGE, mirroring `click-type-verbs.test.ts`.
 *
 * SHARED-WRITE / ENV ISOLATION. Substitution reads env IN-PROCESS (the verb
 * body reads `process.env` of the served controller), so the verb-layer cases
 * that need a variable set the test process's OWN `process.env[key]` and RESTORE
 * it after each test (there is no child process whose env we could override
 * instead). The pure-function cases pass an explicit env map, so they touch
 * `process.env` not at all. Every launch points its profile root at a per-test
 * temp dir; nothing here touches the real `~/.webhands`.
 */
describe('{ENV:NAME} placeholder substitution', () => {
	describe('substituteEnvPlaceholders (pure, explicit env)', () => {
		it('returns a value with NO placeholder VERBATIM (backward compatible)', () => {
			expect(substituteEnvPlaceholders('hunter2', {})).toBe('hunter2');
			// A `{...}` that is not a well-formed {ENV:NAME} is left untouched.
			expect(substituteEnvPlaceholders('{"a":1}', {})).toBe('{"a":1}');
			expect(substituteEnvPlaceholders('{ENV:}', {})).toBe('{ENV:}');
			expect(hasEnvPlaceholder('hunter2')).toBe(false);
		});

		it('substitutes {ENV:NAME} with the resolved value', () => {
			expect(hasEnvPlaceholder('{ENV:PASSWORD}')).toBe(true);
			expect(
				substituteEnvPlaceholders('{ENV:PASSWORD}', {PASSWORD: 's3cret'}),
			).toBe('s3cret');
			// A placeholder embedded in surrounding text resolves in place.
			expect(
				substituteEnvPlaceholders('Bearer {ENV:TOKEN}', {TOKEN: 'abc'}),
			).toBe('Bearer abc');
		});

		it('fails LOUD (typed) on an UNSET variable, never a silent empty', () => {
			try {
				substituteEnvPlaceholders('{ENV:MISSING}', {});
				expect.unreachable('expected an UnresolvedEnvPlaceholderError');
			} catch (cause) {
				expect(cause).toBeInstanceOf(UnresolvedEnvPlaceholderError);
				expect(isControllerError(cause)).toBe(true);
				const err = cause as UnresolvedEnvPlaceholderError;
				expect(err.code).toBe('unresolved-env-placeholder');
				expect(err.envName).toBe('MISSING');
				expect(err.message).toContain('MISSING');
			}
		});

		it('fails LOUD on an EMPTY variable too (empty is treated as unset)', () => {
			expect(() =>
				substituteEnvPlaceholders('{ENV:EMPTY}', {EMPTY: ''}),
			).toThrow(UnresolvedEnvPlaceholderError);
		});
	});

	describe('the `type` verb (real browser, local fixture, seam)', () => {
		let server: FixtureServer;
		const tempRoots: string[] = [];
		const savedEnv: Record<string, string | undefined> = {};

		beforeAll(async () => {
			server = await startFixtureServer();
		});

		afterAll(async () => {
			await server.close();
		});

		afterEach(async () => {
			while (tempRoots.length > 0) {
				const dir = tempRoots.pop()!;
				await rm(dir, {recursive: true, force: true});
			}
			// Restore any process.env key a test set, so nothing leaks across tests
			// and the real environment is left exactly as it was.
			for (const [key, value] of Object.entries(savedEnv)) {
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
			for (const key of Object.keys(savedEnv)) delete savedEnv[key];
		});

		/** Set a process.env key for this test, remembering the prior value to restore. */
		function setEnv(key: string, value: string): void {
			if (!(key in savedEnv)) {
				savedEnv[key] = process.env[key];
			}
			process.env[key] = value;
		}

		/** Ensure a process.env key is UNSET for this test, remembering the prior value. */
		function unsetEnv(key: string): void {
			if (!(key in savedEnv)) {
				savedEnv[key] = process.env[key];
			}
			delete process.env[key];
		}

		async function openOnFixture(name: string): Promise<Session> {
			const root = await mkdtemp(join(tmpdir(), 'mbc-env-'));
			tempRoots.push(root);
			const loc = resolveProfileLocation(name, {root});
			await mkdir(loc.profileDir, {recursive: true});
			const transport = new PlaywrightLaunchTransport({root});
			const session = await transport.open({mode: 'launch', profile: name});
			await session.page.navigate(`${server.url}/click-type.html`);
			return session;
		}

		it('types the RESOLVED value of process.env into the page for {ENV:NAME}', async () => {
			// Use a bespoke, unlikely-to-collide var name and a value that is NOT the
			// literal token, so the assertion proves substitution (not a passthrough).
			setEnv('WEBHANDS_TEST_PASSWORD', 's3cret-value');
			const session = await openOnFixture('env-resolve');
			try {
				await session.page.type(
					locator(`page.getByLabel('Query')`),
					'{ENV:WEBHANDS_TEST_PASSWORD}',
				);
				// The RESOLVED value landed in the input; the token did not.
				expect(
					await session.page.eval(`document.getElementById('query').value`),
				).toBe('s3cret-value');
			} finally {
				await session.close();
			}
		});

		it('types a value with NO {ENV:...} VERBATIM (unchanged behaviour)', async () => {
			const session = await openOnFixture('env-verbatim');
			try {
				await session.page.type(
					locator(`page.getByLabel('Query')`),
					'plain literal text',
				);
				expect(
					await session.page.eval(`document.getElementById('query').value`),
				).toBe('plain literal text');
			} finally {
				await session.close();
			}
		});

		it('an UNSET {ENV:NAME} fails LOUD and types NOTHING (no silent empty)', async () => {
			unsetEnv('WEBHANDS_TEST_UNSET');
			const session = await openOnFixture('env-unset');
			try {
				// Precondition: the field is empty.
				expect(
					await session.page.eval(`document.getElementById('query').value`),
				).toBe('');

				await expect(
					session.page.type(
						locator(`page.getByLabel('Query')`),
						'{ENV:WEBHANDS_TEST_UNSET}',
					),
				).rejects.toBeInstanceOf(UnresolvedEnvPlaceholderError);

				// The field is STILL empty: the verb failed BEFORE typing, so no
				// silent empty (nor a partial) reached the page.
				expect(
					await session.page.eval(`document.getElementById('query').value`),
				).toBe('');
			} finally {
				await session.close();
			}
		});
	});
});
