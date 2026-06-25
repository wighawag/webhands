import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	locator,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
	type Session,
} from '../src/index.js';

/**
 * The `goto` (navigate) and `wait` verbs, exercised at the `core`
 * Driver/Transport seam against a REAL local Playwright (Chromium) browser
 * driving the LOCAL FIXTURE PAGES (deterministic, never a third-party site
 * whose DOM rots), per the PRD "Testing Decisions".
 *
 * `goto`: navigates and SETTLES on the `load` event before returning, so a
 * subsequent read sees the rendered page. `wait`: the three forms (selector,
 * navigation, timeout) each return once their condition holds. The
 * delayed/redirecting fixtures render/transition AFTER `load` so the wait forms
 * actually have something to block on (a `load`-settled `goto` returns first).
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.my-browser-controller`.
 */
describe('goto + wait verbs (real browser, local fixture, seam)', () => {
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

	/** Open a session against an isolated, set-up profile (not yet navigated). */
	async function openSession(name = 'verbs'): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-verbs-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		return transport.open({mode: 'launch', profile: name});
	}

	describe('goto', () => {
		it('navigates the active page to the URL and settles before returning', async () => {
			const session = await openSession('goto-basic');
			try {
				await session.page.navigate(server.url);

				// After goto returns, the page IS at the URL and HAS settled: a read
				// (snapshot) sees the rendered content, no extra wait needed.
				const snap = await session.page.snapshot();
				expect(snap.url).toBe(`${server.url}/`);
				expect(snap.content).toContain('Fixture Page');

				// `document.readyState` is at least 'complete' (the `load` event has
				// fired) by the time goto resolved.
				const readyState = await session.page.eval('document.readyState');
				expect(readyState).toBe('complete');
			} finally {
				await session.close();
			}
		});

		it('navigates between pages (a second goto replaces the first)', async () => {
			const session = await openSession('goto-twice');
			try {
				await session.page.navigate(`${server.url}/delayed.html`);
				expect((await session.page.snapshot()).url).toBe(
					`${server.url}/delayed.html`,
				);

				await session.page.navigate(`${server.url}/index.html`);
				const snap = await session.page.snapshot();
				expect(snap.url).toBe(`${server.url}/index.html`);
				expect(snap.content).toContain('Fixture Page');
			} finally {
				await session.close();
			}
		});
	});

	describe('wait', () => {
		it('selector form: blocks until a late, script-rendered element appears', async () => {
			const session = await openSession('wait-selector');
			try {
				await session.page.navigate(`${server.url}/delayed.html`);

				// goto settled on `load`, but the late content is injected ~150ms
				// AFTER load, so right now it is not there yet.
				const before = await session.page.eval(
					`document.getElementById('late') === null`,
				);
				expect(before).toBe(true);

				// wait-for-selector blocks until the script renders it.
				await session.page.wait({
					kind: 'locator',
					target: locator(`page.getByLabel('Late Content')`),
				});

				const text = await session.page.eval(
					`document.getElementById('late').textContent`,
				);
				expect(text).toBe('late content rendered');
			} finally {
				await session.close();
			}
		});

		it('navigation form: blocks until the pending JS redirect settles', async () => {
			const session = await openSession('wait-nav');
			try {
				await session.page.navigate(`${server.url}/redirecting.html`);

				// goto settled on the redirecting page's `load`; the redirect to
				// index.html fires ~150ms later, so we are still on it for now.
				expect((await session.page.snapshot()).url).toBe(
					`${server.url}/redirecting.html`,
				);

				// wait-for-navigation blocks until that next navigation settles.
				await session.page.wait({kind: 'navigation'});

				const snap = await session.page.snapshot();
				expect(snap.url).toBe(`${server.url}/index.html`);
				expect(snap.content).toContain('Fixture Page');
			} finally {
				await session.close();
			}
		});

		it('timeout form: returns after at least the requested delay', async () => {
			const session = await openSession('wait-timeout');
			try {
				await session.page.navigate(server.url);

				const start = Date.now();
				await session.page.wait({kind: 'timeout', ms: 120});
				const elapsed = Date.now() - start;

				// It waited (allow a small scheduler slack below the nominal 120ms).
				expect(elapsed).toBeGreaterThanOrEqual(100);
			} finally {
				await session.close();
			}
		});
	});
});
