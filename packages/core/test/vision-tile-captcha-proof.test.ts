import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	locator,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	resolveScreenshotsDir,
	startFixtureServer,
	type BoundingBox,
	type FixtureServer,
	type Session,
} from '../src/index.js';

/**
 * The VISION/TILE captcha capability bar, proved with ONLY webhands verbs (prd
 * `broaden-agent-verb-surface`, R3, story 17; the
 * `vision-tile-captcha-end-to-end-proof` task). This is the vision/tile sibling
 * of the token-harvest proof: it shows the Tier-4 surface COMPOSES into the
 * harder captcha family the way the frame-aware `query` proved token-harvest.
 *
 * The loop uses ONLY verbs already on the seam (no new product surface, no
 * iamhuman, no solver):
 *
 *   1. cross-origin READ (`query`/`getAttribute`/`count`) of the tile grid +
 *      challenge state TWO CROSS-ORIGIN frames deep (the `frameLocator(...).
 *      frameLocator(...)` chain Playwright can cross);
 *   2. an element-clipped `screenshot` of the widget (what a vision model looks
 *      at) AND a VIEWPORT `screenshot` (the coordinate-matched shot);
 *   3. VIEWPORT-coordinate `mouse` clicks on the target tiles, where the
 *      coordinate is each tile's `bbox` (VIEWPORT CSS-pixels, so it maps directly
 *      to the viewport screenshot \u2014 the Tier-4 coordinate<->screenshot contract,
 *      HELD across the two cross-origin boundaries);
 *   4. the fixture's challenge REGISTERS the selection and ADVANCES (its
 *      `#challenge-state` flips `pending` -> `solved`), read back through the same
 *      cross-origin chain.
 *
 * The "which tiles" decision is DETERMINISTIC here (the fixture marks the target
 * tiles with `data-target="1"`); a real agent would read those from a vision
 * model. This proves the MECHANISM composes, NOT a solve rate \u2014 webhands ships
 * no vision model and no captcha service.
 *
 * The fixture is a local MULTI-ORIGIN nested-frame tree (three distinct
 * fixture-server origins == three distinct ports), mirroring the synthetic tree
 * in `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md`:
 * a host page embeds a cross-origin WAF-like frame that embeds a cross-origin
 * hCaptcha-like challenge frame, two boundaries deep.
 *
 * Shared-write isolation: every launch points its profile AND screenshots root
 * at a per-test temp dir; nothing here touches the real `~/.webhands`.
 */
describe('vision/tile captcha proof (real browser, multi-origin fixture, verbs only)', () => {
	// THREE distinct origins (distinct ports): host, the WAF level, and the
	// deepest captcha level \u2014 the doubly-nested cross-origin tree.
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

	/** The chained cross-origin frame locator prefix (two boundaries deep). */
	const DEEP = `page.frameLocator('#child-frame').frameLocator('#child-frame')`;

	/**
	 * Open a session on the host tile-captcha page. The host embeds the WAF
	 * origin, which embeds the captcha origin (the deepest, child-less level, the
	 * interactive challenge), composing the three distinct origins via the
	 * `?child=<url>` param. After load, both cross-origin boundaries are in place.
	 */
	async function openOnTree(
		profile: string,
	): Promise<{session: Session; root: string}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-tile-captcha-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile});

		const captchaUrl = `${captcha.url}/tile-captcha.html`;
		const wafUrl = `${waf.url}/tile-captcha.html?child=${encodeURIComponent(
			captchaUrl,
		)}`;
		const hostUrl = `${host.url}/tile-captcha.html?child=${encodeURIComponent(
			wafUrl,
		)}`;
		await session.page.navigate(hostUrl);
		// Wait for the deepest grid to be reachable through the two-frame chain, so
		// the cross-origin frames have finished loading before the loop starts.
		await session.page.wait({
			kind: 'locator',
			target: locator(`${DEEP}.locator('#submit')`),
		});
		return {session, root};
	}

	/**
	 * Read a tile's VIEWPORT-CSS-pixel centre via its `bbox` two cross-origin
	 * frames deep. `boundingBox()` for a cross-origin frame element is reported in
	 * the TOP page's viewport frame (Playwright accounts for the iframe offsets),
	 * which IS the `mouse` coordinate frame AND the viewport-screenshot pixel
	 * frame \u2014 the coordinate<->screenshot bridge the proof leans on.
	 */
	async function tileCentre(
		session: Session,
		tileIndex: number,
	): Promise<{x: number; y: number; bbox: BoundingBox}> {
		const rows = await session.page.query(
			locator(`${DEEP}.locator('#tile-${tileIndex}')`),
			{pw: ['bbox']},
		);
		const bbox = rows[0]?.pw?.bbox;
		if (!bbox) {
			throw new Error(`tile ${tileIndex} has no bbox (not rendered?)`);
		}
		return {x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2, bbox};
	}

	/** Read the deepest challenge state through the cross-origin chain. */
	async function challengeState(session: Session): Promise<string> {
		const rows = await session.page.query(
			locator(`${DEEP}.locator('#challenge-state')`),
			{props: ['innerText']},
		);
		return String(rows[0]?.props?.innerText ?? '');
	}

	it('drives the full vision/tile loop with verbs only and the challenge advances', async () => {
		const {session, root} = await openOnTree('tile-loop');
		try {
			// 1. cross-origin READ: discover the grid + challenge state two frames
			// deep. The challenge starts PENDING and there are nine tiles.
			expect(
				await session.page.count(locator(`${DEEP}.locator('.tile')`)),
			).toBe(9);
			expect(await challengeState(session)).toBe('pending');

			// The DETERMINISTIC target set (a real agent reads these from a vision
			// model; the fixture marks them so the proof needs NO solver). Read the
			// `data-target` attribute through the chain rather than hard-coding it.
			const targets: number[] = [];
			for (let i = 0; i < 9; i++) {
				const flag = await session.page.getAttribute(
					locator(`${DEEP}.locator('#tile-${i}')`),
					'data-target',
				);
				if (flag === '1') {
					targets.push(i);
				}
			}
			expect(targets.length).toBeGreaterThan(0);

			// 2. element-clipped `screenshot` of the WIDGET (what a vision model would
			// look at), captured of an element two cross-origin frames deep.
			const widgetShot = await session.page.screenshot({
				scope: 'element',
				locator: locator(`${DEEP}.locator('#grid')`),
			});
			expect(widgetShot.width).toBeGreaterThan(0);
			expect(widgetShot.height).toBeGreaterThan(0);
			expect(
				(await readFile(widgetShot.path)).subarray(0, 8).toString('hex'),
			).toBe('89504e470d0a1a0a');

			// The VIEWPORT screenshot is the coordinate-matched shot the look-then-
			// click loop uses. Its pixel space must contain the tile coordinates we
			// are about to click (allowing for device-pixel-ratio).
			const viewportShot = await session.page.screenshot({scope: 'viewport'});
			const dpr = (await session.page.eval(
				`window.devicePixelRatio`,
			)) as number;

			// 3. VIEWPORT-coordinate `mouse` clicks on the target tiles. The
			// coordinate is each tile's `bbox` centre, read THROUGH the cross-origin
			// chain in tileCentre() \u2014 the coordinate<->screenshot contract held two
			// boundaries deep.
			for (const index of targets) {
				const centre = await tileCentre(session, index);
				// The coordinate lives inside the VIEWPORT screenshot's pixel space,
				// making the look-then-click mapping explicit (a tile seen at (x,y) in
				// the viewport shot is clicked at mouse (x,y)).
				expect(centre.x * dpr).toBeLessThanOrEqual(viewportShot.width + 1);
				expect(centre.y * dpr).toBeLessThanOrEqual(viewportShot.height + 1);
				await session.page.mouse({action: 'click', x: centre.x, y: centre.y});
			}

			// The fixture REGISTERED the selection (read the recorded indices back
			// through the chain) \u2014 proving each coordinate click landed on its tile.
			const selection = await session.page.query(
				locator(`${DEEP}.locator('#selection')`),
				{props: ['innerText']},
			);
			expect(String(selection[0]?.props?.innerText)).toBe(targets.join(','));

			// 4. submit (a coordinate click on the Verify button two frames deep) and
			// the challenge ADVANCES: the state read back through the chain is solved.
			const submitRows = await session.page.query(
				locator(`${DEEP}.locator('#submit')`),
				{pw: ['bbox']},
			);
			const submitBox = submitRows[0]?.pw?.bbox;
			if (!submitBox) {
				throw new Error('submit button has no bbox');
			}
			await session.page.mouse({
				action: 'click',
				x: submitBox.x + submitBox.width / 2,
				y: submitBox.y + submitBox.height / 2,
			});

			expect(await challengeState(session)).toBe('solved');

			// Shared-write isolation: the screenshots were minted UNDER the per-test
			// managed dir, never the real `~/.webhands`.
			const managed = resolveScreenshotsDir({root});
			expect(widgetShot.path.startsWith(managed)).toBe(true);
			expect(viewportShot.path.startsWith(managed)).toBe(true);
			expect(widgetShot.path.startsWith(root)).toBe(true);
		} finally {
			await session.close();
		}
	}, 30_000);

	it('a coordinate that lands on the WRONG tile is observable (the contract is load-bearing)', async () => {
		// If the coordinate<->screenshot mapping were sloppy across the two
		// cross-origin boundaries, a click meant for a target tile would land on a
		// neighbour. This test PROVES the mapping is tight: clicking a NON-target
		// tile's coordinate selects THAT tile (not its neighbour), and submitting
		// the wrong set leaves the challenge UNSOLVED (state -> wrong), so a
		// mis-mapped coordinate could not pass the proof by accident.
		const {session} = await openOnTree('tile-wrong');
		try {
			// Pick a tile the challenge does NOT want.
			let nonTarget = -1;
			for (let i = 0; i < 9; i++) {
				const flag = await session.page.getAttribute(
					locator(`${DEEP}.locator('#tile-${i}')`),
					'data-target',
				);
				if (flag === '0') {
					nonTarget = i;
					break;
				}
			}
			expect(nonTarget).toBeGreaterThanOrEqual(0);

			const centre = await tileCentre(session, nonTarget);
			await session.page.mouse({action: 'click', x: centre.x, y: centre.y});

			// The click landed on EXACTLY the tile we aimed at (not a neighbour): the
			// selection records that one index.
			const selection = await session.page.query(
				locator(`${DEEP}.locator('#selection')`),
				{props: ['innerText']},
			);
			expect(String(selection[0]?.props?.innerText)).toBe(String(nonTarget));

			// Submitting the wrong set does NOT advance the challenge.
			const submitRows = await session.page.query(
				locator(`${DEEP}.locator('#submit')`),
				{pw: ['bbox']},
			);
			const submitBox = submitRows[0]!.pw!.bbox!;
			await session.page.mouse({
				action: 'click',
				x: submitBox.x + submitBox.width / 2,
				y: submitBox.y + submitBox.height / 2,
			});
			expect(await challengeState(session)).toBe('wrong');
		} finally {
			await session.close();
		}
	}, 30_000);

	it('the fixture really nests TWO cross-origin boundaries (origins differ at each hop)', async () => {
		// Make the "cross-origin" claim load-bearing, not an accident of a
		// same-origin chain that would also pass: the three levels live on three
		// DISTINCT ports == three DISTINCT origins, and the top origin is the host.
		const {session} = await openOnTree('tile-origins');
		try {
			expect(new URL(host.url).port).not.toBe(new URL(waf.url).port);
			expect(new URL(waf.url).port).not.toBe(new URL(captcha.url).port);
			expect(new URL(host.url).port).not.toBe(new URL(captcha.url).port);
			const topOrigin = (await session.page.eval(
				`window.location.origin`,
			)) as string;
			expect(topOrigin).toBe(new URL(host.url).origin);
			// And the grid genuinely lives two boundaries deep (reachable only via
			// the chained frameLocator, the cross-origin mechanism).
			expect(
				await session.page.exists(locator(`${DEEP}.locator('#grid')`)),
			).toBe(true);
		} finally {
			await session.close();
		}
	}, 20_000);
});
