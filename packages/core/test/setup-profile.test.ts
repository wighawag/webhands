import {existsSync} from 'node:fs';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	DEFAULT_HOME_DIRNAME,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	setupProfile,
	startFixtureServer,
	type FixtureServer,
} from '../src/index.js';

/**
 * `setup-profile` tests. They drive a REAL local Playwright (Chromium) browser
 * HEADED against the local fixture page (deterministic, never a third-party
 * site) and assert the AUTOMATABLE mechanics: the right profile dir is opened
 * headed, the actionable prompt is emitted, and state the headed session writes
 * persists to the profile dir and is visible to a SUBSEQUENT HEADLESS launch.
 *
 * The verb only OPENS the window; the real human login is NOT automated or
 * asserted here (that is the manual Kayak smoke). No credential is touched.
 *
 * Shared-write isolation: every run points its profile root at a per-test temp
 * dir; nothing here ever touches the real `~/.my-browser-controller`.
 */
describe('setupProfile (real headed browser, local fixture)', () => {
	let server: FixtureServer;
	const tempRoots: string[] = [];

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
	});

	/** A fresh isolated controller-home temp root for one test. */
	async function makeTempRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-setup-'));
		tempRoots.push(root);
		return root;
	}

	it('creates and opens the dedicated profile dir headed, and prompts', async () => {
		const root = await makeTempRoot();
		const loc = resolveProfileLocation('default', {root});
		// Pre-condition: the profile is NOT yet set up.
		expect(existsSync(loc.profileDir)).toBe(false);

		const prompts: string[] = [];
		const {session, location} = await setupProfile({
			profile: 'default',
			root,
			onPrompt: (m) => prompts.push(m),
		});
		try {
			// The dedicated profile dir was created (the profile is now "set up").
			expect(location.profileDir).toBe(loc.profileDir);
			expect((await stat(loc.profileDir)).isDirectory()).toBe(true);

			// The session is live and headed: it drives the fixture page.
			await session.page.navigate(server.url);
			const snap = await session.page.snapshot();
			expect(snap.content).toContain('Fixture Page');
		} finally {
			await session.close();
		}

		// A clear, actionable prompt was emitted, naming the profile and dir and
		// telling the user what to do.
		expect(prompts).toHaveLength(1);
		const prompt = prompts[0]!;
		expect(prompt).toContain('default');
		expect(prompt).toContain(loc.profileDir);
		expect(prompt).toMatch(/log in/i);
		expect(prompt).toMatch(/close/i);
	});

	it('persists session state to the profile dir for a later HEADLESS launch', async () => {
		const root = await makeTempRoot();

		// setup-profile (headed): the human's session writes state. We model the
		// "human logged in" effect by writing a cookie + localStorage during the
		// headed session — we do NOT automate a real third-party login.
		const {session} = await setupProfile({profile: 'persist', root});
		try {
			await session.page.navigate(server.url);
			await session.page.eval(
				`window.localStorage.setItem('mbc-login', 'set-up-while-headed')`,
			);
			await session.page.setCookies([
				{
					name: 'mbc_session',
					value: 'headed-login-cookie',
					domain: '127.0.0.1',
					path: '/',
					expires: Math.floor(Date.now() / 1000) + 3600,
				},
			]);
		} finally {
			// Closing the headed window flushes state to the profile dir.
			await session.close();
		}

		// A SUBSEQUENT HEADLESS launch against the SAME profile sees the state,
		// proving setup-profile's state persists for `launch --headless`.
		const transport = new PlaywrightLaunchTransport({root});
		const headless = await transport.open({mode: 'launch', profile: 'persist'});
		try {
			await headless.page.navigate(server.url);
			const login = await headless.page.eval(
				`window.localStorage.getItem('mbc-login')`,
			);
			expect(login).toBe('set-up-while-headed');

			const cookies = await headless.page.cookies();
			const cookie = cookies.find((c) => c.name === 'mbc_session');
			expect(cookie?.value).toBe('headed-login-cookie');
		} finally {
			await headless.close();
		}
	});

	it('opens HEADED via the launch transport (asserted with an injected transport)', async () => {
		const root = await makeTempRoot();
		const opened: Array<{mode: string; profile?: string; headed?: boolean}> =
			[];

		// A spy transport records the OpenTarget so we can assert setup-profile
		// asks for a HEADED launch of the right profile, without a second browser.
		const spy = {
			async open(target: {mode: string; profile?: string; headed?: boolean}) {
				opened.push({
					mode: target.mode,
					profile: target.profile,
					headed: target.headed,
				});
				return {
					page: {} as never,
					async close() {},
				};
			},
		};

		const {location} = await setupProfile({
			profile: 'spy-profile',
			root,
			transport: spy as never,
			onPrompt: () => {},
		});

		expect(opened).toEqual([
			{mode: 'launch', profile: 'spy-profile', headed: true},
		]);
		// The dir is still created even with an injected transport (creation is
		// setup-profile's job, not the transport's).
		expect((await stat(location.profileDir)).isDirectory()).toBe(true);
	});

	it('is idempotent: re-running against an already-set-up profile is fine', async () => {
		const root = await makeTempRoot();

		const first = await setupProfile({
			profile: 'again',
			root,
			onPrompt: () => {},
		});
		await first.session.close();

		// Second run against the now-existing dir must not throw.
		const second = await setupProfile({
			profile: 'again',
			root,
			onPrompt: () => {},
		});
		await second.session.close();

		expect(second.location.profileDir).toBe(first.location.profileDir);
	});

	it('leaves the real ~/.my-browser-controller location UNTOUCHED', async () => {
		const realHome = join(homedir(), DEFAULT_HOME_DIRNAME);
		const before = existsSync(realHome);

		const root = await makeTempRoot();
		const {session} = await setupProfile({
			profile: 'isolation',
			root,
			onPrompt: () => {},
		});
		await session.page.navigate(server.url);
		await session.close();

		const after = existsSync(realHome);
		expect(after).toBe(before);
		if (before) {
			const leaked = existsSync(join(realHome, 'profiles', 'isolation'));
			expect(leaked).toBe(false);
		}
	});
});
