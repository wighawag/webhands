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
 * The TOKEN-HARVEST captcha capability bar, proved with ONLY webhands verbs (prd
 * `broaden-agent-verb-surface`, stories 6-7; the
 * `frame-aware-query-token-harvest-captcha-proof` task). This is the same-origin
 * sibling of the vision/tile proof: it shows the EXISTING verb surface is rich
 * enough for an agent with its OWN (here test-faked) 2captcha key to get past a
 * same-origin captcha just by poking the page, with NO pre-built solver and NO
 * iamhuman.
 *
 * The full loop uses ONLY verbs already on the seam:
 *
 *   1. `query` READS the page-readable sitekey from the captcha widget, which
 *      lives one SAME-ORIGIN frame down (`#main-iframe`), addressed via a
 *      `frameLocator('#main-iframe').locator('.h-captcha')` hop in the locator
 *      string + `attrs:['data-sitekey']`. This is the one frame-aware READ the
 *      spike (`work/notes/findings/click-and-type-already-frame-scoped-via-
 *      framelocator.md`) found missing; `query` closes it through the SAME single
 *      resolver `click`/`type` already use (no `--frame` flag, no parallel
 *      addressing scheme, R1).
 *   2. The agent obtains a token OUT OF BAND. webhands ships no solver and no
 *      key, so the proof FAKES the provider: a pure local function maps the
 *      sitekey to a token with NO real network and NO real key.
 *   3. `type` WRITES the token into the same-origin response-sink `<textarea>`,
 *      addressed via the SAME frame hop (the delivery half the spike proved
 *      already works).
 *   4. `eval` (with the Tier-3 same-origin `frame` selector) FIRES the page
 *      callback, and the fixture page ADVANCES: `#captcha-state` flips
 *      `pending` -> `verified` and the protected content is revealed, read back
 *      through the same frame hop.
 *
 * The fixture is a LOCAL same-origin nested-frame page (sitekey + sink + callback
 * in a child `#main-iframe`), mirroring the reachable Imperva `#main-iframe`
 * structure in `work/notes/findings/playwright-cross-origin-frame-captcha-
 * mechanics.md`. The TILES (the vision family) are cross-origin and out of scope
 * here (that is Tier-4, the `vision-tile-captcha-proof`).
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.webhands`.
 */
describe('token-harvest captcha proof (real browser, same-origin frame fixture, verbs only)', () => {
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
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
	});

	/** The same-origin frame hop the sitekey + sink live behind. */
	const FRAME = `page.frameLocator('#main-iframe')`;

	/**
	 * Open a session on the token-harvest captcha host. The host embeds the
	 * captcha widget as a SAME-ORIGIN `#main-iframe` child (sitekey + sink +
	 * callback all one frame down). The profile root points at a per-test temp
	 * dir, so the real `~/.webhands` is untouched.
	 */
	async function openOnFixture(
		profile: string,
	): Promise<{session: Session; root: string}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-token-captcha-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile});
		await session.page.navigate(`${server.url}/token-captcha-parent.html`);
		// Wait for the same-origin child frame to have loaded its widget, so the
		// loop reads a settled frame. The frame's heading is a reliably VISIBLE
		// element (the `.h-captcha` div itself is an empty, zero-size sink marker, so
		// `waitFor`'s default visible state is not a safe gate on it).
		await session.page.wait({
			kind: 'locator',
			target: locator(`${FRAME}.locator('#captcha-heading')`),
		});
		return {session, root};
	}

	/**
	 * A TEST FAKE of the agent's out-of-band token provider (e.g. 2captcha).
	 * webhands ships NO solver and NO key; this stands in for the network call an
	 * agent would make with its OWN key. It runs entirely in-process: no real
	 * network, no real key, deterministic. The token is derived from the sitekey
	 * so the proof can assert the read fed the token.
	 */
	function fakeProviderToken(sitekey: string): string {
		return `fake-token-for-${sitekey}`;
	}

	/** Read the child-frame captcha state through the same-origin frame hop. */
	async function captchaState(session: Session): Promise<string> {
		const rows = await session.page.query(
			locator(`${FRAME}.locator('#captcha-state')`),
			{props: ['innerText']},
		);
		return String(rows[0]?.props?.innerText ?? '');
	}

	it('drives the full token-harvest loop with verbs only and the page advances', async () => {
		const {session} = await openOnFixture('token-loop');
		try {
			// The widget genuinely lives in the child frame: a TOP-document query for
			// the sitekey is empty (it is one same-origin frame down).
			expect(
				await session.page.count(locator(`page.locator('.h-captcha')`)),
			).toBe(0);

			// 1. `query` READS the page-readable sitekey from the SAME-ORIGIN child
			// frame via a `frameLocator(...)` hop + attrs:['data-sitekey']. This is
			// the frame-aware read the spike found missing, through the one resolver.
			const sitekeyRows = await session.page.query(
				locator(`${FRAME}.locator('.h-captcha')`),
				{attrs: ['data-sitekey', 'data-callback']},
			);
			expect(sitekeyRows).toHaveLength(1);
			const sitekey = sitekeyRows[0]?.attrs?.['data-sitekey'];
			expect(sitekey).toBe('sk-token-harvest-abc123');
			// The widget also names its callback (what the real markup carries), read
			// through the same hop.
			expect(sitekeyRows[0]?.attrs?.['data-callback']).toBe(
				'onCaptchaFinished',
			);

			// The challenge starts PENDING and the protected content is hidden.
			expect(await captchaState(session)).toBe('pending');

			// 2. The agent gets a token OUT OF BAND from its OWN provider. webhands
			// ships none; the proof FAKES it (no real network, no real key).
			const token = fakeProviderToken(sitekey!);

			// 3. `type` WRITES the token into the same-origin response sink, addressed
			// via the SAME frame hop (the delivery half that already worked).
			await session.page.type(
				locator(`${FRAME}.locator('#h-captcha-response')`),
				token,
			);
			// The sink now holds the token (read back through the hop as a live prop).
			const sinkRows = await session.page.query(
				locator(`${FRAME}.locator('#h-captcha-response')`),
				{props: ['value']},
			);
			expect(sinkRows[0]?.props?.value).toBe(token);

			// 4. FIRE the page callback in the SAME-ORIGIN child frame (Tier-3
			// frame-scoped `eval`), passing the token the way the real widget's
			// `data-callback` would. The callback ACCEPTS it only because it matches
			// the token already written into the sink (so the token genuinely
			// travelled read -> provider -> sink -> callback).
			const result = await session.page.eval(
				`window.onCaptchaFinished(document.getElementById('h-captcha-response').value)`,
				{frame: '#main-iframe'},
			);
			expect(result).toBe('verified');

			// The page ADVANCED: the state flips to verified, the solved flag is set,
			// and the protected content is now visible, all read back through the
			// frame hop with verbs.
			expect(await captchaState(session)).toBe('verified');
			expect(
				await session.page.eval('window.__captchaSolved', {
					frame: '#main-iframe',
				}),
			).toBe(true);
			expect(
				await session.page.isVisible(
					locator(`${FRAME}.locator('#protected-content')`),
				),
			).toBe(true);
		} finally {
			await session.close();
		}
	}, 30_000);

	it('does NOT advance when the token never reaches the sink (the loop is load-bearing)', async () => {
		// If the proof could pass without the read -> sink -> callback chain, the
		// capability claim would be hollow. This makes the chain load-bearing:
		// firing the callback WITHOUT first typing the token into the sink is
		// rejected and the page stays pending (an empty sink != the token).
		const {session} = await openOnFixture('token-no-sink');
		try {
			expect(await captchaState(session)).toBe('pending');

			// Fire the callback with a token while the sink is still EMPTY: the
			// callback compares against the (empty) sink value and rejects.
			const result = await session.page.eval(
				`window.onCaptchaFinished('fake-token-for-sk-token-harvest-abc123')`,
				{frame: '#main-iframe'},
			);
			expect(result).toBe('rejected');
			expect(await captchaState(session)).toBe('rejected');
			expect(
				await session.page.eval('window.__captchaSolved', {
					frame: '#main-iframe',
				}),
			).toBe(false);
			expect(
				await session.page.isVisible(
					locator(`${FRAME}.locator('#protected-content')`),
				),
			).toBe(false);
		} finally {
			await session.close();
		}
	}, 30_000);

	it('the captcha widget genuinely lives one SAME-ORIGIN frame down (not the top document)', async () => {
		// Make the "frame-aware read" claim load-bearing, not an accident of a
		// flat page that a top-document query would also satisfy: the sitekey is
		// reachable ONLY through the frame hop, and the child frame is SAME-ORIGIN
		// with the top (so the hop is the same-origin token-harvest path, not the
		// cross-origin tile family).
		const {session} = await openOnFixture('token-frame-shape');
		try {
			// Reachable through the hop, empty at the top.
			expect(
				await session.page.exists(locator(`${FRAME}.locator('.h-captcha')`)),
			).toBe(true);
			expect(
				await session.page.exists(locator(`page.locator('.h-captcha')`)),
			).toBe(false);

			// The child frame is SAME-ORIGIN with the top (a frame-scoped `eval`
			// reaching it does NOT raise the cross-origin error: page-world JS can
			// only cross into a same-origin frame).
			const topOrigin = (await session.page.eval(
				`window.location.origin`,
			)) as string;
			const frameOrigin = (await session.page.eval(`window.location.origin`, {
				frame: '#main-iframe',
			})) as string;
			expect(frameOrigin).toBe(topOrigin);
		} finally {
			await session.close();
		}
	}, 20_000);
});
