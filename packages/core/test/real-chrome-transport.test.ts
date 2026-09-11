import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	isLiveDevToolsEndpoint,
	locator,
	ProxyAuthUnsupportedError,
	RealChromeReuseConflictError,
	RealChromeTransport,
	resolveProfileLocation,
	spawnRealChrome,
	startFixtureServer,
	type FixtureServer,
	type RealChrome,
	type Session,
	type SpawnRealChromeOptions,
} from '../src/index.js';
import {
	CI_SANDBOX_ARGS,
	spawnTestChrome,
	testChromeExecutable,
} from './spawn-test-chrome.js';

/**
 * The `real-chrome` transport: spawn the USER'S OWN Chrome on a dedicated profile
 * dir and ATTACH to it (ADR-0014), the one-command form of the recipe that
 * empirically gets through a serious bot manager where every Playwright-LAUNCHED
 * variant was blocked.
 *
 * These drive a REAL spawned browser against the LOCAL FIXTURE (deterministic,
 * never a third-party site), using Playwright's own bundled Chromium as the
 * "system Chrome" via `executablePath`, so the suite needs no Google Chrome
 * install. What is asserted is what only THIS transport owns: the profile dir it
 * spawns against, the verb surface being the unchanged attach one, and above all
 * the BROWSER LIFETIME (we started it, so we stop it, unless told to keep it).
 *
 * Isolation: every profile root is a per-test temp dir, and every test terminates
 * the browser it started even on failure. The real `~/.webhands` is never touched.
 */
describe('RealChromeTransport (spawn the user\u2019s own Chrome, then attach)', () => {
	let server: FixtureServer;
	const sessions: Session[] = [];
	const strays: RealChrome[] = [];
	const tempRoots: string[] = [];

	beforeAll(async () => {
		server = await startFixtureServer();
	});

	afterAll(async () => {
		await server.close();
	});

	afterEach(async () => {
		while (sessions.length > 0) {
			await sessions
				.pop()!
				.close()
				.catch(() => {});
		}
		while (strays.length > 0) {
			// `.catch` matters: without it one rejecting close aborts the whole teardown,
			// stranding the REMAINING browsers (each holding a profile dir) and every
			// temp root for the rest of the run.
			await strays
				.pop()!
				.close()
				.catch(() => {});
		}
		while (tempRoots.length > 0) {
			// A just-terminated Chrome may still be flushing its profile; retry so a
			// teardown race cannot masquerade as a test failure.
			await rm(tempRoots.pop()!, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
		}
	});

	async function tempRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-real-chrome-tx-'));
		tempRoots.push(root);
		return root;
	}

	/**
	 * A transport that spawns Playwright's bundled Chromium HEADLESS as the stand-in
	 * system Chrome, and records each spawn so a test can prove a second open REUSED
	 * a running browser instead of starting another.
	 */
	function makeTransport(
		root: string,
		options: {keepBrowser?: boolean} = {},
	): {transport: RealChromeTransport; spawns: RealChrome[]} {
		const spawns: RealChrome[] = [];
		const transport = new RealChromeTransport({root}, [], {
			...options,
			headless: true,
			executablePath: testChromeExecutable(),
			// CI cannot sandbox a plainly-spawned Chrome (see spawn-test-chrome.ts).
			args: CI_SANDBOX_ARGS,
			spawn: async (o: SpawnRealChromeOptions) => {
				const chrome = await spawnRealChrome(o);
				spawns.push(chrome);
				// Registered as a potential stray: if a test's assertion fails before
				// the session closes, teardown still stops the browser.
				strays.push(chrome);
				return chrome;
			},
		});
		return {transport, spawns};
	}

	it('spawns a real Chrome for the profile and drives the page through the SAME verbs', async () => {
		const root = await tempRoot();
		const {transport, spawns} = makeTransport(root);

		const session = await transport.open({mode: 'launch', profile: 'default'});
		sessions.push(session);

		// The verb surface is the attach transport's, unchanged: a read, an act and
		// a read-back all work against the browser we spawned.
		await session.page.navigate(`${server.url}/click-type.html`);
		await session.page.type(locator(`page.getByLabel('Query')`), 'tokyo');
		expect(
			await session.page.eval(`document.getElementById('query').value`),
		).toBe('tokyo');

		// It spawned against the DEDICATED profile dir for that name, not some
		// scratch dir and certainly not the user's daily profile.
		expect(spawns).toHaveLength(1);
		const loc = resolveProfileLocation('default', {root});
		const res = await fetch(`${spawns[0]!.endpoint}/json/version`);
		expect(res.ok).toBe(true);
		expect(loc.profileDir.startsWith(root)).toBe(true);
	});

	it('CREATES the profile dir ITSELF, before the browser is started', async () => {
		// Two things, and the first is easy to get wrong. The launch transport refuses a
		// missing profile so a typo cannot spawn a blank one; that rule must NOT apply
		// here, because the human logs in with their own hands in the window this opens,
		// so demanding `setup-profile` first would demand a setup step for a mode whose
		// first run IS the setup.
		//
		// The second is why this asserts at SPAWN TIME. Chrome creates a missing
		// user-data dir itself, so checking after the fact proves nothing about OUR
		// mkdir: deleting it from the transport would leave such a test green. The
		// injected spawn therefore records whether the dir already existed when it was
		// called, which only our mkdir can be responsible for.
		const root = await tempRoot();
		const loc = resolveProfileLocation('fresh', {root});
		expect(existsSync(loc.profileDir)).toBe(false);

		let dirExistedAtSpawn: boolean | undefined;
		let spawnedWithDir: string | undefined;
		const transport = new RealChromeTransport({root}, [], {
			headless: true,
			executablePath: testChromeExecutable(),
			args: CI_SANDBOX_ARGS,
			spawn: async (o) => {
				dirExistedAtSpawn = existsSync(o.userDataDir);
				spawnedWithDir = o.userDataDir;
				const chrome = await spawnRealChrome(o);
				strays.push(chrome);
				return chrome;
			},
		});

		const session = await transport.open({mode: 'launch', profile: 'fresh'});
		sessions.push(session);
		await session.page.navigate(server.url);

		// The transport created the dedicated dir before starting anything...
		expect(dirExistedAtSpawn).toBe(true);
		// ...and it is the named profile's dir under the isolated root, not a scratch
		// dir and emphatically not the user's daily profile.
		expect(spawnedWithDir).toBe(loc.profileDir);
		// The browser really adopted it (its own port file is in there).
		expect(existsSync(join(loc.profileDir, 'DevToolsActivePort'))).toBe(true);
	});

	it('TERMINATES the browser it spawned when the session closes (default)', async () => {
		// The lifetime asymmetry that matters: plain attach must NOT kill the user's
		// browser, but here WEBHANDS started it, so `stop` must not leave a stray
		// Chrome holding the profile dir (which would also break the next run).
		const root = await tempRoot();
		const {transport, spawns} = makeTransport(root);

		const session = await transport.open({mode: 'launch', profile: 'default'});
		await session.page.navigate(server.url);
		const endpoint = spawns[0]!.endpoint;
		expect(await isLiveDevToolsEndpoint(endpoint)).toBe(true);

		await session.close();

		expect(await isLiveDevToolsEndpoint(endpoint)).toBe(false);
	});

	it('with keepBrowser, the browser SURVIVES the session and the next open REUSES it', async () => {
		const root = await tempRoot();
		const {transport, spawns} = makeTransport(root, {keepBrowser: true});

		const first = await transport.open({mode: 'launch', profile: 'default'});
		await first.page.navigate(server.url);
		const endpoint = spawns[0]!.endpoint;
		await first.close();

		// Survived the close: the user's tabs outlive `stop`.
		expect(await isLiveDevToolsEndpoint(endpoint)).toBe(true);

		// And the next open ATTACHES to it rather than spawning a second browser,
		// which is what keeps `--keep-browser` usable: a second spawn on the same
		// user-data dir cannot work, so without reuse the next run would fail.
		const second = await transport.open({mode: 'launch', profile: 'default'});
		sessions.push(second);
		await second.page.navigate(`${server.url}/click-type.html`);
		expect(spawns).toHaveLength(1);
	});

	it('REFUSES to reuse a running browser when spawn-only options were asked for', async () => {
		// The dangerous case, found in review: a browser already live on the profile
		// cannot retroactively acquire a --proxy (it is a command-line fact of a process
		// already up). Reusing anyway would egress through the REAL IP while the user
		// believed they were tunnelled. So it must refuse, naming the option.
		const root = await tempRoot();
		const loc = resolveProfileLocation('conflict', {root});
		await mkdir(loc.profileDir, {recursive: true});

		// A browser already running on that profile dir (stands in for a previous
		// --keep-browser session, or a controller that died without tearing down).
		const existing = await spawnTestChrome({userDataDir: loc.profileDir});
		strays.push(existing);

		let spawnCalls = 0;
		const transport = new RealChromeTransport({root}, [], {
			headless: true,
			executablePath: testChromeExecutable(),
			args: CI_SANDBOX_ARGS,
			proxy: 'socks5h://127.0.0.1:1080',
			spawn: async (o) => {
				spawnCalls++;
				const chrome = await spawnRealChrome(o);
				strays.push(chrome);
				return chrome;
			},
		});

		const err = await transport
			.open({mode: 'launch', profile: 'conflict'})
			.then(
				() => {
					throw new Error('expected open to refuse');
				},
				(e: unknown) => e,
			);

		expect(err).toBeInstanceOf(RealChromeReuseConflictError);
		const conflict = err as RealChromeReuseConflictError;
		// It names WHICH option could not be honoured, and where the running browser is.
		expect(conflict.unhonourableOptions).toContain('proxy');
		expect(conflict.endpoint).toBe(existing.endpoint);
		expect(conflict.message).toMatch(/already running against/i);
		// It did not start a second browser, and it did not kill the existing one.
		expect(spawnCalls).toBe(0);
		expect(await isLiveDevToolsEndpoint(existing.endpoint)).toBe(true);
	});

	it('REFUSES a credentialled proxy even on the reuse path (no silent unproxied session)', async () => {
		// Chrome cannot use proxy credentials at all, so they are refused. The refusal
		// used to live only in the arg builder, which the reuse path never reaches, so a
		// second run silently ran with NO proxy: exactly the outcome the typed error
		// exists to prevent. Validation now happens before anything can short-circuit.
		const root = await tempRoot();
		const loc = resolveProfileLocation('creds', {root});
		await mkdir(loc.profileDir, {recursive: true});
		const existing = await spawnTestChrome({userDataDir: loc.profileDir});
		strays.push(existing);

		const transport = new RealChromeTransport({root}, [], {
			headless: true,
			executablePath: testChromeExecutable(),
			args: CI_SANDBOX_ARGS,
			proxy: 'socks5h://user:secret@127.0.0.1:1080',
		});

		await expect(
			transport.open({mode: 'launch', profile: 'creds'}),
		).rejects.toBeInstanceOf(ProxyAuthUnsupportedError);
	});

	it('does NOT kill a browser it merely REUSED, even without keepBrowser', async () => {
		// The lifetime rule is about OWNERSHIP, not about the flag: webhands kills what
		// webhands started. A browser it FOUND running belongs to whoever started it, so
		// a default (non-keepBrowser) session must leave it alive on close. Pinned
		// because the neighbouring test asserts the opposite for a SPAWNED browser, and
		// that asymmetry is the whole design.
		const root = await tempRoot();
		const loc = resolveProfileLocation('reused', {root});
		await mkdir(loc.profileDir, {recursive: true});
		const existing = await spawnTestChrome({userDataDir: loc.profileDir});
		strays.push(existing);

		let spawnCalls = 0;
		// No spawn-only options, so reuse is exactly what was asked for.
		const transport = new RealChromeTransport({root}, [], {
			spawn: async (o) => {
				spawnCalls++;
				const chrome = await spawnRealChrome(o);
				strays.push(chrome);
				return chrome;
			},
		});

		const session = await transport.open({mode: 'launch', profile: 'reused'});
		await session.page.navigate(server.url);
		await session.close();

		expect(spawnCalls).toBe(0);
		expect(await isLiveDevToolsEndpoint(existing.endpoint)).toBe(true);
	});

	it('spawns VISIBLE by default, ignoring target.headed (the mode is for a human)', async () => {
		// The documented decision this pins: a real-Chrome session exists so a human can
		// watch, log in and take over, and a headless Chrome is both useless for that and
		// a fingerprint tell. Every other test here forces headless, so without this the
		// default AND the ignore-target.headed rule are asserted nowhere. Hermetic: the
		// spawn is recorded, never performed.
		const root = await tempRoot();
		const seen: Array<boolean | undefined> = [];
		const transport = new RealChromeTransport({root}, [], {
			spawn: async (o) => {
				seen.push(o.headless);
				throw new Error('stop here: the recorded options are the assertion');
			},
		});

		await expect(
			transport.open({mode: 'launch', profile: 'visible', headed: false}),
		).rejects.toThrow(/stop here/);

		// `headed: false` on the target is deliberately NOT consulted.
		expect(seen).toEqual([false]);
	});

	it('refuses an attach target (that is the attach transport\u2019s job)', async () => {
		const {transport} = makeTransport(await tempRoot());
		await expect(
			transport.open({mode: 'attach', endpoint: 'http://127.0.0.1:9222'}),
		).rejects.toThrow(/only handles 'launch'/);
	});

	it('does not pretend to hide automation: navigator.webdriver is still true', async () => {
		// Deliberately pinned so nobody reads the mode as a cloak. Chrome sets
		// navigator.webdriver whenever a remote-debugging port is enabled, verified
		// BEFORE any client attaches, so this mode's measured advantage over a
		// Playwright launch is NOT a missing automation bit: it is the absence of
		// launch-hardening flags plus a real profile, window, history and IP. If this
		// ever flips to false, the docs' honesty section needs revisiting, not a
		// celebration.
		const root = await tempRoot();
		const {transport} = makeTransport(root);
		const session = await transport.open({mode: 'launch', profile: 'default'});
		sessions.push(session);
		await session.page.navigate(server.url);
		expect(await session.page.eval('navigator.webdriver')).toBe(true);
	});

	it('leaves no browser behind when the attach half fails', async () => {
		// If we spawned a browser and then could not drive it, the browser must not
		// outlive the failed open: a stray Chrome would hold the profile dir and
		// block every later run.
		const root = await tempRoot();
		const loc = resolveProfileLocation('default', {root});
		await mkdir(loc.profileDir, {recursive: true});

		let spawnedChrome: RealChrome | undefined;
		const transport = new RealChromeTransport({root}, [], {
			headless: true,
			executablePath: testChromeExecutable(),
			args: CI_SANDBOX_ARGS,
			spawn: async (o: SpawnRealChromeOptions) => {
				const chrome = await spawnRealChrome(o);
				spawnedChrome = chrome;
				// Hand back an endpoint that cannot be attached to, so the attach half
				// fails AFTER a real browser was spawned. The FIXTURE server's URL is a
				// live HTTP server that is not a DevTools endpoint, so the failure is
				// immediate and specific (a dead port would instead sit out the connect
				// timeout and tell us nothing more).
				return {...chrome, endpoint: server.url};
			},
		});

		await expect(
			transport.open({mode: 'launch', profile: 'default'}),
		).rejects.toThrow();

		expect(spawnedChrome).toBeDefined();
		expect(await isLiveDevToolsEndpoint(spawnedChrome!.endpoint)).toBe(false);
	});
});
