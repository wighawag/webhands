import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium, type BrowserContext} from 'playwright';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	AttachNotChromiumError,
	isControllerError,
	locator,
	PlaywrightAttachTransport,
	spawnRealChrome,
	startFixtureServer,
	type FixtureServer,
	type Transport,
} from '../src/index.js';

/**
 * These tests drive a REAL local Chromium that the test starts with a remote
 * debugging port (standing in for the browser a USER already started with
 * `--remote-debugging-port`), then point the `attach` transport at its CDP
 * endpoint. They assert at the `core` Driver/Transport seam against the local
 * fixture page (deterministic, never a third-party site).
 *
 * The "user's running browser" is a SEPARATE OS PROCESS, spawned through the same
 * {@link spawnRealChrome} primitive `--real-chrome` uses, because that is what a
 * user's browser actually is. It used to be modelled with
 * `launchPersistentContext` IN THIS PROCESS, which was both less faithful and
 * quietly broken: `browser.close()` on a `connectOverCDP` connection whose target
 * was launched by Playwright in the SAME process blocks for 30s (measured: 30.2s,
 * versus 20ms against a separate process), so every case here paid ~30s and the
 * detach case, which closes twice, blew its 60s budget and FAILED on `main`. See
 * `work/notes/findings/attach-close-hangs-30s-against-an-in-process-launched-target.md`.
 */
describe('PlaywrightAttachTransport (real Chromium over CDP, local fixture)', () => {
	let server: FixtureServer;
	const cleanups: Array<() => Promise<void>> = [];

	beforeAll(async () => {
		server = await startFixtureServer();
	});

	afterAll(async () => {
		await server.close();
	});

	afterEach(async () => {
		while (cleanups.length > 0) {
			const fn = cleanups.pop()!;
			await fn().catch(() => {});
		}
	});

	/**
	 * Start a real local Chromium with remote debugging on an OS-assigned port,
	 * exactly as a user would with `--remote-debugging-port`. Returns the CDP
	 * HTTP endpoint plus the live context (so a test can seed/inspect the
	 * "existing" context the transport is expected to reuse). Registers teardown.
	 */
	async function startUserBrowser(): Promise<{
		endpoint: string;
		context: BrowserContext;
	}> {
		const userDataDir = await mkdtemp(join(tmpdir(), 'mbc-attach-'));
		// A separate PROCESS, like a real user's browser (and like `--real-chrome`).
		// Playwright's own bundled Chromium is the executable so the test needs no
		// system Chrome install.
		const chrome = await spawnRealChrome({
			userDataDir,
			executablePath: chromium.executablePath(),
			headless: true,
		});
		// A second, test-owned connection standing in for the USER'S live handle on
		// their own browser: it is how a test seeds/inspects the existing context the
		// attach transport must reuse, and it must survive the transport detaching.
		const userHandle = await chromium.connectOverCDP(chrome.endpoint);
		const context = userHandle.contexts()[0]!;
		cleanups.push(async () => {
			// The test-owned handle's close is BOUNDED for the same measured reason the
			// transport's is (Playwright's CDP close intermittently waits out a 30s
			// internal timeout; observed here as 30008ms / 30229ms on ~2 of 5 cases).
			// The browser is terminated on the next line regardless, so waiting longer
			// would only slow the suite down.
			await Promise.race([
				userHandle.close().catch(() => {}),
				new Promise((resolve) => setTimeout(resolve, 2_000)),
			]);
			await chrome.close();
			await rm(userDataDir, {recursive: true, force: true});
		});
		return {endpoint: chrome.endpoint, context};
	}

	it('attaches over CDP, reuses the existing context, and drives the fixture through the seam', async () => {
		const {endpoint, context} = await startUserBrowser();

		// Seed an "authenticated" marker on the EXISTING context BEFORE attaching.
		// If attach reuses contexts()[0], the controller sees this cookie; if it
		// opened a fresh newContext(), it would not.
		await context.addCookies([
			{
				name: 'mbc_live_session',
				value: 'existing-context',
				domain: '127.0.0.1',
				path: '/',
				expires: Math.floor(Date.now() / 1000) + 3600,
			},
		]);

		// Address the seam at its interface type.
		const driver: Transport = new PlaywrightAttachTransport();
		const session = await driver.open({mode: 'attach', endpoint});
		try {
			// Drives the local fixture page through the seam verbs.
			await session.page.navigate(server.url);
			const snap = await session.page.snapshot();
			expect(snap.url).toBe(`${server.url}/`);
			expect(snap.content).toContain('Fixture Page');

			const result = await session.page.eval('1 + 41');
			expect(result).toBe(42);

			// The reused context carries the marker seeded before attach: proof the
			// existing authenticated context was reused, not a fresh one.
			const cookies = await session.page.cookies();
			const marker = cookies.find((c) => c.name === 'mbc_live_session');
			expect(marker?.value).toBe('existing-context');
		} finally {
			await session.close();
		}
	});

	it('reuses contexts()[0] without ever opening a new context', async () => {
		const {endpoint, context} = await startUserBrowser();
		const contextsBefore = context.browser()?.contexts().length ?? 1;

		const transport = new PlaywrightAttachTransport();
		const session = await transport.open({mode: 'attach', endpoint});
		try {
			await session.page.navigate(server.url);
			// The user's side still sees exactly the one original context: attach
			// did not fork a new one.
			const contextsAfter = context.browser()?.contexts().length ?? 1;
			expect(contextsAfter).toBe(contextsBefore);
		} finally {
			await session.close();
		}
	});

	it('closing the attached session detaches WITHOUT killing the user browser', async () => {
		const {endpoint, context} = await startUserBrowser();

		const transport = new PlaywrightAttachTransport();
		const session = await transport.open({mode: 'attach', endpoint});
		await session.page.navigate(server.url);
		await session.close();

		// The user's browser is still alive after the controller detached: a fresh
		// attach against the SAME endpoint still works.
		const session2 = await transport.open({mode: 'attach', endpoint});
		try {
			const snap = await session2.page.snapshot();
			expect(snap.url).toBeDefined();
			// Sanity: the user's live context is still usable.
			expect(context.pages().length).toBeGreaterThanOrEqual(1);
		} finally {
			await session2.close();
		}
	});

	it('rejects verbs after the session is closed (lifetime contract)', async () => {
		const {endpoint} = await startUserBrowser();
		const transport = new PlaywrightAttachTransport();
		const session = await transport.open({mode: 'attach', endpoint});
		await session.close();
		await expect(session.page.navigate(server.url)).rejects.toThrow(
			'session is closed',
		);
	});

	it('drives the fixture via a raw Playwright locator (type then read back)', async () => {
		const {endpoint} = await startUserBrowser();
		const transport = new PlaywrightAttachTransport();
		const session = await transport.open({mode: 'attach', endpoint});
		try {
			await session.page.navigate(server.url);
			await session.page.type(locator(`page.getByLabel('Query')`), 'flights');
			const value = await session.page.eval(
				`document.getElementById('query').value`,
			);
			expect(value).toBe('flights');
		} finally {
			await session.close();
		}
	});

	it('only handles attach; launch is owned by the launch transport', async () => {
		const transport = new PlaywrightAttachTransport();
		await expect(
			transport.open({mode: 'launch', profile: 'default'}),
		).rejects.toThrow(/only handles 'attach'/);
	});
});

describe('AttachNotChromiumError (Chromium-only constraint, typed shape)', () => {
	it('is an identifiable controller error naming the non-Chromium engine', () => {
		const err = new AttachNotChromiumError('firefox');
		expect(err).toBeInstanceOf(AttachNotChromiumError);
		expect(isControllerError(err)).toBe(true);
		expect(err.code).toBe('attach-not-chromium');
		expect(err.browser).toBe('firefox');
		expect(err.message).toMatch(/Chromium-only/i);
	});
});

// (The local DevToolsActivePort poller this file used to carry is gone: the port
// read lives in `src/devtools-port.ts` and is reached through `spawnRealChrome`,
// so there is ONE implementation rather than a test copy that can drift.)
