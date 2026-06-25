import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	CONTROLLER_HOME_ENV,
	DEFAULT_HOME_DIRNAME,
	isControllerError,
	locator,
	MissingBrowserBinaryError,
	MissingProfileError,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
	type Transport,
} from '../src/index.js';

/**
 * These tests drive a REAL local Playwright (Chromium) browser against the
 * local fixture page (deterministic, never a third-party site) and assert at
 * the `core` Driver/Transport seam.
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.my-browser-controller`.
 */
describe('PlaywrightLaunchTransport (real browser, local fixture)', () => {
	let server: FixtureServer;
	const tempRoots: string[] = [];

	beforeAll(async () => {
		server = await startFixtureServer();
	});

	afterAll(async () => {
		await server.close();
	});

	afterEach(async () => {
		// Tear down every scratch profile root this test made.
		while (tempRoots.length > 0) {
			const dir = tempRoots.pop()!;
			await rm(dir, {recursive: true, force: true});
		}
	});

	/** Make an isolated controller-home temp root and a set-up profile in it. */
	async function makeSetUpProfile(
		name = 'default',
	): Promise<{root: string; transport: PlaywrightLaunchTransport}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-launch-'));
		tempRoots.push(root);
		// `setup-profile` (a later task) creates the dir; for this transport's
		// tests we pre-create it so `launch` sees a "set up" profile.
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		return {root, transport: new PlaywrightLaunchTransport({root})};
	}

	it('launches headless against the dedicated profile and drives the fixture', async () => {
		const {transport} = await makeSetUpProfile();
		// Address the seam at its interface type.
		const driver: Transport = transport;

		const session = await driver.open({mode: 'launch', profile: 'default'});
		try {
			await session.page.navigate(server.url);
			const snap = await session.page.snapshot();
			expect(snap.url).toBe(`${server.url}/`);
			expect(snap.content).toContain('Fixture Page');

			const result = await session.page.eval('1 + 41');
			expect(result).toBe(42);
		} finally {
			await session.close();
		}
	});

	it('supports headed launch (selectable via OpenTarget.headed)', async () => {
		const {transport} = await makeSetUpProfile('headed-profile');
		const session = await transport.open({
			mode: 'launch',
			profile: 'headed-profile',
			headed: true,
		});
		try {
			await session.page.navigate(server.url);
			const snap = await session.page.snapshot();
			expect(snap.content).toContain('Fixture Page');
		} finally {
			await session.close();
		}
	});

	it('persists state across a relaunch against the same profile dir', async () => {
		const {transport} = await makeSetUpProfile('persist');

		// Run 1: write state (a cookie + localStorage) on the fixture origin.
		const s1 = await transport.open({mode: 'launch', profile: 'persist'});
		try {
			await s1.page.navigate(server.url);
			await s1.page.eval(
				`window.localStorage.setItem('mbc-token', 'kept-across-relaunch')`,
			);
			await s1.page.setCookies([
				{
					name: 'mbc_session',
					value: 'persisted-cookie',
					domain: '127.0.0.1',
					path: '/',
					// A persistent (non-session) cookie: an explicit future expiry is
					// what makes it survive the context close, like a real login cookie.
					expires: Math.floor(Date.now() / 1000) + 3600,
				},
			]);
		} finally {
			await s1.close();
		}

		// Run 2: a FRESH launch against the SAME profile dir sees the state.
		const s2 = await transport.open({mode: 'launch', profile: 'persist'});
		try {
			await s2.page.navigate(server.url);
			const token = await s2.page.eval(
				`window.localStorage.getItem('mbc-token')`,
			);
			expect(token).toBe('kept-across-relaunch');

			const cookies = await s2.page.cookies();
			const session = cookies.find((c) => c.name === 'mbc_session');
			expect(session?.value).toBe('persisted-cookie');
		} finally {
			await s2.close();
		}
	});

	it('rejects verbs after the session is closed (lifetime contract)', async () => {
		const {transport} = await makeSetUpProfile('closed');
		const session = await transport.open({mode: 'launch', profile: 'closed'});
		await session.close();
		await expect(session.page.navigate(server.url)).rejects.toThrow(
			'session is closed',
		);
	});

	it('surfaces a not-set-up profile as a typed MissingProfileError', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mbc-missing-'));
		tempRoots.push(root);
		// Note: no profile dir created.
		const transport = new PlaywrightLaunchTransport({root});

		const err = await transport
			.open({mode: 'launch', profile: 'never-set-up'})
			.then(
				() => {
					throw new Error('expected open to reject');
				},
				(e: unknown) => e,
			);

		expect(err).toBeInstanceOf(MissingProfileError);
		expect(isControllerError(err)).toBe(true);
		expect((err as MissingProfileError).code).toBe('missing-profile');
		expect((err as MissingProfileError).profile).toBe('never-set-up');
		expect((err as MissingProfileError).profileDir).toContain('never-set-up');
	});

	it('reads the profile root from the env override too', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mbc-env-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation('env-profile', {root});
		await mkdir(loc.profileDir, {recursive: true});

		const prev = process.env[CONTROLLER_HOME_ENV];
		process.env[CONTROLLER_HOME_ENV] = root;
		try {
			// No explicit root: the transport resolves it from the env var.
			const transport = new PlaywrightLaunchTransport();
			const session = await transport.open({
				mode: 'launch',
				profile: 'env-profile',
			});
			await session.close();
		} finally {
			if (prev === undefined) delete process.env[CONTROLLER_HOME_ENV];
			else process.env[CONTROLLER_HOME_ENV] = prev;
		}
	});

	it('only handles launch; attach is owned by the attach transport', async () => {
		const {transport} = await makeSetUpProfile('any');
		await expect(
			transport.open({mode: 'attach', endpoint: 'ws://localhost:9222'}),
		).rejects.toThrow(/only handles 'launch'/);
	});

	it('leaves the real ~/.my-browser-controller location UNTOUCHED', async () => {
		const realHome = join(homedir(), DEFAULT_HOME_DIRNAME);
		const before = existsSync(realHome);

		const {transport} = await makeSetUpProfile('isolation');
		const session = await transport.open({
			mode: 'launch',
			profile: 'isolation',
		});
		await session.page.navigate(server.url);
		await session.close();

		// The real shared location must be exactly as before (not created by us;
		// if it pre-existed, not mutated into existence of a new profile).
		const after = existsSync(realHome);
		expect(after).toBe(before);
		if (before) {
			// If it already existed for unrelated reasons, our isolation profile
			// must not have leaked into it.
			const leaked = existsSync(join(realHome, 'profiles', 'isolation'));
			expect(leaked).toBe(false);
		}
	});
});

describe('MissingBrowserBinaryError (typed condition shape)', () => {
	it('is an identifiable controller error with the missing-binary code', () => {
		const err = new MissingBrowserBinaryError('chromium');
		expect(err).toBeInstanceOf(MissingBrowserBinaryError);
		expect(isControllerError(err)).toBe(true);
		expect(err.code).toBe('missing-browser-binary');
		expect(err.browser).toBe('chromium');
	});
});
