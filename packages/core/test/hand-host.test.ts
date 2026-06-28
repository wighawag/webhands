import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	BUILT_IN_HANDS,
	composeBuiltInPage,
	composePage,
	type Hand,
	type HandContext,
} from '../src/hand-host.js';
import {
	locator,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
	type WebHandsPage,
	type Session,
} from '../src/index.js';

/**
 * The hand-host primitive (Phase 1 of the "hands" prd). Two layers of coverage:
 *
 * 1. The COMPOSITION primitive in isolation (`composePage`): a hand contributes
 *    named verbs (+ optional dispose) over a {@link HandContext}; the host
 *    merges verbs, validates the page is complete, and disposes hands LIFO. This
 *    exercises the new internal behaviour without a browser (a fake context is
 *    enough because composition never touches the live page).
 *
 * 2. The BUILT-IN-HANDS path end-to-end at the SAME `Driver`/`Transport` seam
 *    the existing verb tests use: a real local Chromium driving the local
 *    fixture, proving all eight built-in verbs route through the composed
 *    hand-host and behave as before. This is the self-application proof.
 *
 * No new PUBLIC surface is tested (there is none in Phase 1): the host and
 * `Hand`/`HandContext` are imported from `../src/hand-host.js` (package-internal),
 * NOT from the package entry point.
 *
 * Shared-write isolation: every session points its profile root at a per-test
 * temp dir; nothing here touches the real `~/.webhands`.
 */
describe('hand-host composition primitive (no browser)', () => {
	/**
	 * A fake hand-context. `composePage` only stores these references and hands
	 * them to each hand; it never dereferences `pwPage`/`context`, so opaque
	 * stand-ins are sufficient to test composition mechanics.
	 */
	function fakeContext(): HandContext {
		return {
			pwPage: {} as HandContext['pwPage'],
			context: {} as HandContext['context'],
			ensureOpen: () => {},
		};
	}

	it('merges the verbs every hand contributes into one page', async () => {
		const calls: string[] = [];
		const navHand: Hand = () => ({
			verbs: {
				async navigate() {
					calls.push('navigate');
				},
			},
		});
		// A single hand may contribute SEVERAL verbs (it is not one-verb-per-hand).
		const pairHand: Hand = () => ({
			verbs: {
				async click() {
					calls.push('click');
				},
				async type() {
					calls.push('type');
				},
			},
		});

		// Fill the rest FIRST so the page is complete; the real hands come after so
		// their verbs win the merge (later contributions override, like the page
		// object literal's last-wins property assignment).
		const {page} = composePage(fakeContext(), [
			restOfVerbsHand(),
			navHand,
			pairHand,
		]);

		await page.navigate('about:blank');
		await page.click(locator(`page.locator('#x')`));
		await page.type(locator(`page.locator('#x')`), 'hi');
		expect(calls).toEqual(['navigate', 'click', 'type']);
	});

	it('passes the SAME hand-context to every hand (live page access only)', () => {
		const ctx = fakeContext();
		const seen: HandContext[] = [];
		const spy: Hand = (received) => {
			seen.push(received);
			return {verbs: {}};
		};
		composePage(ctx, [spy, spy, restOfVerbsHand()]);
		// Every hand got the exact same context object (one live page, shared).
		expect(seen[0]).toBe(ctx);
		expect(seen[1]).toBe(ctx);
	});

	it('rejects a composition that is missing a required verb', () => {
		const onlyNavigate: Hand = () => ({
			verbs: {
				async navigate() {},
			},
		});
		expect(() => composePage(fakeContext(), [onlyNavigate])).toThrow(
			/missing verb/i,
		);
	});

	it('disposes hands in REVERSE registration order (LIFO)', async () => {
		const order: number[] = [];
		const disposing = (n: number): Hand => {
			return () => ({
				verbs: {},
				dispose() {
					order.push(n);
				},
			});
		};
		const {dispose} = composePage(fakeContext(), [
			disposing(1),
			disposing(2),
			disposing(3),
			restOfVerbsHand(),
		]);
		await dispose();
		// Registered 1,2,3 → disposed 3,2,1.
		expect(order).toEqual([3, 2, 1]);
	});

	it('disposes every hand even when one disposer rejects', async () => {
		const disposed: string[] = [];
		const ok =
			(name: string): Hand =>
			() => ({
				verbs: {},
				dispose() {
					disposed.push(name);
				},
			});
		const boom: Hand = () => ({
			verbs: {},
			dispose() {
				throw new Error('dispose boom');
			},
		});
		const {dispose} = composePage(fakeContext(), [
			ok('first'),
			boom,
			ok('last'),
			restOfVerbsHand(),
		]);

		await expect(dispose()).rejects.toThrow('dispose boom');
		// Both non-failing hands were still disposed despite the middle failure.
		expect(disposed).toContain('first');
		expect(disposed).toContain('last');
	});

	it('built-in composition yields a complete page (all built-in verbs)', () => {
		const {page} = composeBuiltInPage(fakeContext());
		const verbNames: ReadonlyArray<keyof WebHandsPage> = [
			'navigate',
			'snapshot',
			'click',
			'type',
			'eval',
			'wait',
			'cookies',
			'setCookies',
			'query',
			'count',
			'exists',
			'isVisible',
			'getAttribute',
		];
		for (const name of verbNames) {
			expect(typeof page[name]).toBe('function');
		}
		// BUILT_IN_HANDS is the shared set both transports compose.
		expect(BUILT_IN_HANDS.length).toBeGreaterThan(0);
	});
});

/**
 * A throwaway hand that contributes every verb NOT otherwise supplied by a test,
 * so `composePage`'s completeness check passes while the test asserts on the
 * verb(s) it actually cares about.
 */
function restOfVerbsHand(): Hand {
	return () => ({
		verbs: {
			async navigate() {},
			async snapshot() {
				return {url: '', view: 'accessibility', content: ''};
			},
			async click() {},
			async type() {},
			async eval() {
				return undefined;
			},
			async wait() {},
			async cookies() {
				return [];
			},
			async setCookies() {},
			async query() {
				return [];
			},
			async count() {
				return 0;
			},
			async exists() {
				return false;
			},
			async isVisible() {
				return false;
			},
			async getAttribute() {
				return null;
			},
		},
	});
}

describe('built-in hands at the Driver/Transport seam (real browser, fixture)', () => {
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

	/** Open a session on the click/type fixture (isolated, set-up profile). */
	async function openOnFixture(name: string): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-hands-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/click-type.html`);
		return session;
	}

	it('routes the page-level built-in verbs through the composed host', async () => {
		const session = await openOnFixture('hands-page');
		try {
			// snapshot (snapshotHand)
			const snap = await session.page.snapshot();
			expect(snap.url).toBe(`${server.url}/click-type.html`);
			expect(snap.view).toBe('accessibility');

			// type + click (interactionHand), eval (evalHand)
			await session.page.type(locator(`page.getByLabel('Query')`), 'composed');
			expect(
				await session.page.eval(`document.getElementById('query').value`),
			).toBe('composed');

			await session.page.click(
				locator(`page.getByRole('button', { name: 'Search' })`),
			);
			expect(
				await session.page.eval(
					`document.getElementById('status').textContent`,
				),
			).toBe('clicked');

			// wait (waitHand): a fixed pace delay completes without error.
			await session.page.wait({kind: 'timeout', ms: 1});
		} finally {
			await session.close();
		}
	});

	it('routes the context-level cookies built-in (proves the context is needed)', async () => {
		const session = await openOnFixture('hands-cookies');
		try {
			// cookies/setCookies live on the cookiesHand, which reaches the live
			// BrowserContext from the hand-context (not the page).
			await session.page.setCookies([
				{
					name: 'mbc_hand',
					value: 'via-host',
					domain: '127.0.0.1',
					path: '/',
				},
			]);
			const cookies = await session.page.cookies();
			expect(cookies.find((c) => c.name === 'mbc_hand')?.value).toBe(
				'via-host',
			);
		} finally {
			await session.close();
		}
	});

	it('honours the closed-session lifetime contract through the host', async () => {
		const session = await openOnFixture('hands-closed');
		await session.close();
		// ensureOpen() flows from the per-transport session wiring into every
		// built-in hand's verb, so a verb after close rejects.
		await expect(session.page.snapshot()).rejects.toThrow('session is closed');
	});
});
