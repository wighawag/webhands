import {chmod, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {afterEach, describe, expect, it} from 'vitest';
import {
	discoverChromeExecutable,
	isControllerError,
	isLiveDevToolsEndpoint,
	REAL_CHROME_ENV,
	RealChromeNotFoundError,
	RealChromeStartError,
	spawnRealChrome,
	type RealChrome,
} from '../src/index.js';

/**
 * {@link spawnRealChrome}: start the user's own Chrome with a debugging port so the
 * controller can ATTACH to it (ADR-0014).
 *
 * The real-browser cases spawn Playwright's OWN bundled Chromium as the
 * "system Chrome" (via `executablePath`), so they exercise the real spawn, the
 * real `DevToolsActivePort` read and the real termination WITHOUT requiring a
 * Google Chrome install on the machine running the suite. Discovery is tested
 * separately against a temp directory, so it needs no browser at all.
 *
 * Isolation: every user-data dir is a per-test temp dir. This spawns PROCESSES, so
 * each test terminates what it started in `afterEach`, including on failure.
 */
describe('spawnRealChrome (real process, Playwright Chromium as the system browser)', () => {
	const spawned: RealChrome[] = [];
	const tempDirs: string[] = [];

	afterEach(async () => {
		while (spawned.length > 0) {
			await spawned.pop()!.close();
		}
		while (tempDirs.length > 0) {
			// A just-terminated Chrome can still be flushing its profile, so a plain
			// recursive rm races it and throws ENOTEMPTY. Retry briefly: this is
			// cleanup, and a flaky teardown would look like a real failure.
			await rm(tempDirs.pop()!, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
		}
	});

	async function tempDir(prefix = 'mbc-real-chrome-'): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), prefix));
		tempDirs.push(dir);
		return dir;
	}

	/** Spawn headless (CI has no display) and register teardown. */
	async function spawn(userDataDir: string): Promise<RealChrome> {
		const chrome = await spawnRealChrome({
			userDataDir,
			executablePath: chromium.executablePath(),
			headless: true,
		});
		spawned.push(chrome);
		return chrome;
	}

	it('returns a LIVE loopback CDP endpoint an attach can use', async () => {
		const chrome = await spawn(await tempDir());

		// Loopback only: the debugging port is a code-execution surface on the live
		// page and must never be reachable off-box (CONTEXT.md).
		expect(chrome.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(chrome.pid).toBeGreaterThan(0);
		expect(chrome.executablePath).toBe(chromium.executablePath());

		// It is genuinely attachable, not merely a formatted string.
		const res = await fetch(`${chrome.endpoint}/json/version`);
		expect(res.ok).toBe(true);
		expect(((await res.json()) as {Browser?: string}).Browser).toMatch(
			/Chrom/i,
		);
	});

	it('close() terminates the browser it spawned, and is idempotent', async () => {
		const chrome = await spawn(await tempDir());
		expect(await isLiveDevToolsEndpoint(chrome.endpoint)).toBe(true);

		await chrome.close();
		// A second close must not throw (stop is idempotent, and the user may have
		// closed the window themselves first).
		await chrome.close();

		// The browser is gone. Asserted with the SAME bounded liveness probe the code
		// uses, not a bare `fetch` rejection: a plain fetch to the dead port takes
		// ~10s to give up here, which would make this test look like a hang.
		expect(await isLiveDevToolsEndpoint(chrome.endpoint)).toBe(false);
	});

	it('FAILS FAST with a typed error when the executable exits immediately', async () => {
		// `/bin/true` exits 0 at once and never publishes a port. Without the
		// exit-watching abort, this would wait out the whole ready timeout, so the
		// assertion is BOTH the typed error and that it took nowhere near it.
		const started = Date.now();
		const err = await spawnRealChrome({
			userDataDir: await tempDir(),
			executablePath: '/bin/true',
			readyTimeoutMs: 10_000,
		}).then(
			() => {
				throw new Error('expected spawnRealChrome to reject');
			},
			(e: unknown) => e,
		);

		expect(err).toBeInstanceOf(RealChromeStartError);
		expect(isControllerError(err)).toBe(true);
		expect((err as RealChromeStartError).code).toBe('real-chrome-start-failed');
		// The reason names what actually happened, and the message points at the
		// overwhelmingly common cause (the profile dir already being in use).
		expect((err as RealChromeStartError).message).toMatch(/exited with code 0/);
		expect((err as RealChromeStartError).message).toMatch(/already running/i);
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it('REFUSES to spawn over a browser already running on that profile dir', async () => {
		// The subtle hazard this pins: a second Chrome on the same user-data dir does
		// NOT fail loudly. It hands its URL to the running instance and exits 0,
		// leaving the FIRST browser's DevToolsActivePort file in place. Reading that
		// file would hand back a LIVE endpoint belonging to a browser we do not own,
		// and whose lifetime we would then wrongly claim: our close() would kill our
		// own already-dead child while the user's browser kept running.
		const dir = await tempDir();
		const first = await spawn(dir);

		const err = await spawnRealChrome({
			userDataDir: dir,
			executablePath: chromium.executablePath(),
			headless: true,
			readyTimeoutMs: 8_000,
		}).then(
			() => {
				throw new Error('expected spawnRealChrome to refuse');
			},
			(e: unknown) => e,
		);

		expect(err).toBeInstanceOf(RealChromeStartError);
		expect((err as RealChromeStartError).message).toMatch(
			/already running against/i,
		);
		// The FIRST browser is untouched by the refused attempt.
		expect(await isLiveDevToolsEndpoint(first.endpoint)).toBe(true);
	});

	it('ignores a STALE port file from a previous run (spawns fresh)', async () => {
		// The other half of the guard: the port file survives the browser's exit, so
		// it must not be mistaken for a running browser NOR for our new browser's port.
		const dir = await tempDir();
		const first = await spawn(dir);
		const deadEndpoint = first.endpoint;
		await first.close();

		const second = await spawn(dir);
		expect(await isLiveDevToolsEndpoint(second.endpoint)).toBe(true);
		// A genuinely new port, not the dead one read back off disk.
		expect(second.endpoint).not.toBe(deadEndpoint);
	});
});

describe('discoverChromeExecutable (no browser needed)', () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		while (tempDirs.length > 0) {
			await rm(tempDirs.pop()!, {recursive: true, force: true});
		}
	});

	/** A temp dir holding an EXECUTABLE file with the given name. */
	async function dirWithExecutable(
		name: string,
	): Promise<{dir: string; path: string}> {
		const dir = await mkdtemp(join(tmpdir(), 'mbc-chrome-path-'));
		tempDirs.push(dir);
		const path = join(dir, name);
		await writeFile(path, '#!/bin/sh\nexit 0\n');
		await chmod(path, 0o755);
		return {dir, path};
	}

	it('finds a candidate on PATH', async () => {
		const {dir, path} = await dirWithExecutable('google-chrome');
		const found = await discoverChromeExecutable({
			env: {PATH: dir},
			platform: 'linux',
		});
		expect(found).toBe(path);
	});

	it('prefers the env override over anything on PATH', async () => {
		const onPath = await dirWithExecutable('google-chrome');
		const override = await dirWithExecutable('my-weird-chrome');
		const found = await discoverChromeExecutable({
			env: {PATH: onPath.dir, [REAL_CHROME_ENV]: override.path},
			platform: 'linux',
		});
		expect(found).toBe(override.path);
	});

	it('does NOT silently fall back when the env override does not exist', async () => {
		// A user who names a path and gets a DIFFERENT browser has been lied to; the
		// honest answer is "not found", which surfaces as the typed error naming the
		// env var.
		const onPath = await dirWithExecutable('google-chrome');
		const found = await discoverChromeExecutable({
			env: {PATH: onPath.dir, [REAL_CHROME_ENV]: '/nope/not/here'},
			platform: 'linux',
		});
		expect(found).toBeUndefined();
	});

	it('ignores a non-executable file of the right name', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'mbc-chrome-path-'));
		tempDirs.push(dir);
		await writeFile(join(dir, 'google-chrome'), 'not executable');
		const found = await discoverChromeExecutable({
			env: {PATH: dir},
			platform: 'linux',
		});
		expect(found).toBeUndefined();
	});

	it('returns undefined (not a throw) when nothing is installed', async () => {
		const found = await discoverChromeExecutable({
			env: {PATH: ''},
			platform: 'linux',
		});
		expect(found).toBeUndefined();
	});

	it('spawnRealChrome turns "nothing found" into the typed, actionable error', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'mbc-chrome-none-'));
		tempDirs.push(dir);
		const err = await spawnRealChrome({
			userDataDir: dir,
			env: {PATH: ''},
			platform: 'linux',
		}).then(
			() => {
				throw new Error('expected spawnRealChrome to reject');
			},
			(e: unknown) => e,
		);

		expect(err).toBeInstanceOf(RealChromeNotFoundError);
		expect((err as RealChromeNotFoundError).code).toBe('real-chrome-not-found');
		// It names what it looked for AND the escape hatch, so the user can fix it
		// without reading the source.
		expect((err as RealChromeNotFoundError).candidates).toContain(
			'google-chrome',
		);
		expect((err as RealChromeNotFoundError).message).toContain(REAL_CHROME_ENV);
	});
});
