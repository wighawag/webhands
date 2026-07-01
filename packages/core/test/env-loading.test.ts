import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {loadWebhandsEnv} from '../src/index.js';

/**
 * `.env` loading for the served process via ldenv (task
 * `env-placeholder-substitution-and-dotenv-loading`; prd
 * `distill-session-into-hand`, resolved decision #1).
 *
 * The controller that owns the browser (ADR-0005: `serve`) loads `.env` /
 * `.env.local` / `.env.<mode>` at startup so an `{ENV:NAME}` placeholder resolves
 * against a gitignored `.env.local` and not only the interactive shell. These
 * tests assert the two behaviours the acceptance criteria call out: a
 * `.env.local`-only var resolves, and the real shell env WINS over a file on a
 * conflicting key (ldenv's documented priority).
 *
 * ISOLATION MECHANISM (stated explicitly, per the task's shared-write rule).
 * ldenv's `folder` bounds an UPWARD `.env` search that STARTS at `process.cwd()`,
 * so to read a fixture and NOT the developer's real home/cwd `.env` files each
 * test:
 *   - creates a fresh TEMP directory and writes the fixture `.env*` files there,
 *   - `process.chdir()`s INTO that temp dir and passes it as `folder`, so ldenv
 *     resolves against the fixture only, and
 *   - RESTORES the original cwd AND every `process.env` key it touched afterwards
 *     (substitution reads env IN-PROCESS, so loadWebhandsEnv mutates THIS
 *     process's `process.env`; we snapshot the specific keys and restore them so
 *     the real environment is left untouched and nothing leaks across tests).
 * The bespoke `WEBHANDS_ENVTEST_*` key names make a real-environment collision
 * effectively impossible, and the restore is asserted.
 */
describe('loadWebhandsEnv (.env loading, isolated temp dir)', () => {
	const originalCwd = process.cwd();
	const tempDirs: string[] = [];
	const touchedKeys = [
		'WEBHANDS_ENVTEST_LOCAL_ONLY',
		'WEBHANDS_ENVTEST_SHARED',
		'WEBHANDS_ENVTEST_BASE',
	] as const;
	const savedEnv: Record<string, string | undefined> = {};

	function snapshotAndClear(): void {
		for (const key of touchedKeys) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
	}

	afterEach(async () => {
		// Restore cwd first, then the exact env keys we could have touched.
		process.chdir(originalCwd);
		for (const key of touchedKeys) {
			const value = savedEnv[key];
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		while (tempDirs.length > 0) {
			await rm(tempDirs.pop()!, {recursive: true, force: true});
		}
	});

	async function fixtureDir(files: Record<string, string>): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), 'webhands-envtest-'));
		tempDirs.push(dir);
		for (const [name, content] of Object.entries(files)) {
			await writeFile(join(dir, name), content, 'utf8');
		}
		return dir;
	}

	it('resolves a var defined ONLY in a gitignored .env.local', async () => {
		snapshotAndClear();
		const dir = await fixtureDir({
			'.env.local': 'WEBHANDS_ENVTEST_LOCAL_ONLY=fromdotenvlocal\n',
		});
		process.chdir(dir);

		// Precondition: the var is NOT in the environment before loading.
		expect(process.env.WEBHANDS_ENVTEST_LOCAL_ONLY).toBeUndefined();

		const parsed = loadWebhandsEnv({folder: dir});

		// ldenv returns the parsed file vars AND mutates process.env with them, so
		// `{ENV:NAME}` substitution (which reads process.env) resolves the value.
		expect(parsed.WEBHANDS_ENVTEST_LOCAL_ONLY).toBe('fromdotenvlocal');
		expect(process.env.WEBHANDS_ENVTEST_LOCAL_ONLY).toBe('fromdotenvlocal');
	});

	it('the real shell env WINS over a .env file on a conflicting key (ldenv priority)', async () => {
		snapshotAndClear();
		// The real environment already has the key set (as an exported shell var
		// would be): it must beat the file's value.
		process.env.WEBHANDS_ENVTEST_SHARED = 'from-real-env';
		const dir = await fixtureDir({
			'.env':
				'WEBHANDS_ENVTEST_SHARED=from-dotenv-file\nWEBHANDS_ENVTEST_BASE=basefromfile\n',
		});
		process.chdir(dir);

		loadWebhandsEnv({folder: dir});

		// The pre-existing real value WON; the file's value did not overwrite it.
		expect(process.env.WEBHANDS_ENVTEST_SHARED).toBe('from-real-env');
		// A key NOT already in the env is still taken from the file (proves the
		// file WAS loaded, so "real env wins" is a priority, not "files ignored").
		expect(process.env.WEBHANDS_ENVTEST_BASE).toBe('basefromfile');
	});

	it('leaves the real environment untouched for keys it does not define', async () => {
		snapshotAndClear();
		const dir = await fixtureDir({
			'.env.local': 'WEBHANDS_ENVTEST_LOCAL_ONLY=x\n',
		});
		process.chdir(dir);

		// A well-known real env var (PATH) must be present and unchanged: loading
		// our fixture must never clear or clobber unrelated environment.
		const pathBefore = process.env.PATH;
		loadWebhandsEnv({folder: dir});
		expect(process.env.PATH).toBe(pathBefore);
	});
});
