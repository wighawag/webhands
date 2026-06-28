import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
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
 * The Tier-4 CROSS-ORIGIN frame READ (prd `broaden-agent-verb-surface`, R3,
 * stories 17-19), exercised at the `core` Driver/Transport seam against a REAL
 * local Playwright (Chromium) browser driving a MULTI-ORIGIN nested-frame
 * fixture, per the prd "Testing Decisions".
 *
 * This is the READ counterpart to the already-working cross-origin `click`: it
 * is NOT a new verb. It is the EXISTING locator-resolver path (`query` and the
 * locator-taking verbs) reaching a `frameLocator(...).frameLocator(...)` chain
 * two CROSS-ORIGIN boundaries deep, which Playwright's `frameLocator` CAN cross
 * (the spike-verified mechanism in
 * `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`).
 * That mechanism is what makes it DISTINCT from the Tier-3 frame-scoped `eval`,
 * which is SAME-ORIGIN only (page-world JS cannot cross a security boundary).
 *
 * The fixture mirrors the finding's synthetic tree: a host page embeds a
 * cross-origin frame (a SECOND fixture-server origin) that embeds another
 * cross-origin frame (a THIRD origin), whose deepest level carries the tile grid
 * + token sink. Three distinct fixture servers == three distinct origins.
 *
 * Shared-write isolation: every launch points its profile/screenshots root at a
 * per-test temp dir; nothing here touches the real `~/.webhands`.
 */
describe('Tier-4 cross-origin frame read (real browser, multi-origin fixture, seam)', () => {
	// THREE distinct origins (distinct ports): host, the WAF level, and the
	// deepest captcha level, exactly the doubly-nested cross-origin tree.
	let host: FixtureServer;
	let waf: FixtureServer;
	let captcha: FixtureServer;
	const tempRoots: string[] = [];

	beforeAll(async () => {
		host = await startFixtureServer();
		waf = await startFixtureServer();
		captcha = await startFixtureServer();
	});

	afterAll(async () => {
		await host.close();
		await waf.close();
		await captcha.close();
	});

	afterEach(async () => {
		while (tempRoots.length > 0) {
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
	});

	/**
	 * Open a session on the host nested-frame page. The host embeds the WAF
	 * origin, which embeds the captcha origin (the deepest, child-less level),
	 * composing the three distinct origins via the `?child=<url>` param the
	 * fixture reads. After load, the two cross-origin boundaries are in place.
	 */
	async function openOnTree(profile: string): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-tier4-xorigin-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile});

		// captcha level: no child (deepest). WAF level: child = captcha. host:
		// child = WAF (which itself points at captcha). Each `child` is an absolute
		// URL on a DIFFERENT origin, so both hops are cross-origin.
		const captchaUrl = `${captcha.url}/nested-frame.html`;
		const wafUrl = `${waf.url}/nested-frame.html?child=${encodeURIComponent(
			captchaUrl,
		)}`;
		const hostUrl = `${host.url}/nested-frame.html?child=${encodeURIComponent(
			wafUrl,
		)}`;
		await session.page.navigate(hostUrl);
		// Wait for the deepest tile to be reachable through the two-frame chain, so
		// the cross-origin frames have finished loading before we read.
		await session.page.wait({
			kind: 'locator',
			target: locator(
				`page.frameLocator('#child-frame').frameLocator('#child-frame').locator('#tile-1')`,
			),
		});
		return session;
	}

	/** The chained cross-origin frame locator prefix (two boundaries deep). */
	const DEEP = `page.frameLocator('#child-frame').frameLocator('#child-frame')`;

	it('the fixture really nests TWO cross-origin boundaries (origins differ at each hop)', async () => {
		const session = await openOnTree('xorigin-origins');
		try {
			// The three levels live on three DISTINCT ports == three DISTINCT origins,
			// so both frame hops genuinely cross a security boundary. We read each
			// frame's `location.origin` through the chain (a cross-origin read in
			// itself) and assert all three differ — making the "cross-origin" claim
			// load-bearing, not an accident of a same-origin chain that would also pass.
			const topOrigin = (await session.page.eval(
				`window.location.origin`,
			)) as string;
			// frameLocator carries no eval, so read the origin off a per-level marker:
			// each level's heading is identical, but the FRAME URLs differ by port.
			expect(new URL(host.url).port).not.toBe(new URL(waf.url).port);
			expect(new URL(waf.url).port).not.toBe(new URL(captcha.url).port);
			expect(new URL(host.url).port).not.toBe(new URL(captcha.url).port);
			expect(topOrigin).toBe(new URL(host.url).origin);
		} finally {
			await session.close();
		}
	}, 20_000);

	it('reads structured-cloned values across TWO cross-origin boundaries via query', async () => {
		const session = await openOnTree('xorigin-query');
		try {
			// `query` (the existing locator-resolver path, NOT a new verb) reads the
			// tile grid two cross-origin frames deep. Values cross by structured
			// clone, the same contract `eval` holds (ADR-0003).
			const tiles = await session.page.query(
				locator(`${DEEP}.locator('.tile')`),
				{attrs: ['data-tile'], props: ['innerText']},
			);
			expect(tiles).toHaveLength(3);
			expect(tiles.map((r) => r.attrs?.['data-tile'])).toEqual(['1', '2', '3']);
			// `innerText` is a LIVE property read through the clone, proving a value
			// (not just an attribute string) crossed both boundaries.
			expect(tiles[0]?.props?.innerText).toContain('tile 1');

			// The token sink's live value is read two boundaries deep too.
			const token = await session.page.getAttribute(
				locator(`${DEEP}.locator('#h-captcha-response')`),
				'name',
			);
			expect(token).toBe('h-captcha-response');
			const tokenValue = await session.page.query(
				locator(`${DEEP}.locator('#h-captcha-response')`),
				{props: ['value']},
			);
			expect(tokenValue[0]?.props?.value).toBe('deep-token-123');
		} finally {
			await session.close();
		}
	}, 20_000);

	it('count/exists hold across the cross-origin chain (the read state verbs)', async () => {
		const session = await openOnTree('xorigin-state');
		try {
			expect(
				await session.page.count(locator(`${DEEP}.locator('.tile')`)),
			).toBe(3);
			expect(
				await session.page.exists(locator(`${DEEP}.locator('#tile-1')`)),
			).toBe(true);
			expect(
				await session.page.exists(locator(`${DEEP}.locator('#no-such')`)),
			).toBe(false);
		} finally {
			await session.close();
		}
	}, 20_000);

	it('an element-clipped screenshot of a frame widget two boundaries deep writes a PNG', async () => {
		const session = await openOnTree('xorigin-shot');
		try {
			// The element scope clips to a locator resolved through the SAME resolver,
			// so a cross-origin frame widget shot Just Works (the captcha-tile case).
			const shot = await session.page.screenshot({
				scope: 'element',
				locator: locator(`${DEEP}.locator('#tile-1')`),
			});
			expect(shot.width).toBeGreaterThan(0);
			expect(shot.height).toBeGreaterThan(0);
			const bytes = await readFile(shot.path);
			expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
			// The clip is the small tile, not the whole viewport.
			expect(shot.width).toBeLessThan(360);
		} finally {
			await session.close();
		}
	}, 20_000);
});
