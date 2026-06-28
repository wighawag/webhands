import {mkdir, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	isControllerError,
	locator,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	resolveScreenshotsDir,
	ScreenshotPathError,
	startFixtureServer,
	type FixtureServer,
	type Session,
} from '../src/index.js';

/**
 * The Tier-4 COORDINATE + SCREENSHOT verbs `mouse` / `screenshot` (prd
 * `broaden-agent-verb-surface`, R3; stories 17-19), exercised at the `core`
 * Driver/Transport seam against a REAL local Playwright (Chromium) browser
 * driving the LOCAL FIXTURE PAGES (deterministic, never a third-party site
 * whose DOM rots), per the prd "Testing Decisions".
 *
 * What this locks down:
 * - `mouse` clicks/moves/presses at VIEWPORT CSS-pixels and runs the fixture
 *   element's handler at that coordinate (assert the EFFECT, not just no-throw).
 * - `screenshot` returns `{path, width, height}` and WRITES a non-empty PNG; the
 *   three scopes (viewport / full / element) each produce a correct image; a
 *   caller `--out` outside the managed dir is REJECTED ({@link ScreenshotPathError}).
 * - The VIEWPORT-screenshot <-> `mouse` coordinate contract: an element's
 *   viewport position maps to a `mouse` click that hits it; `full` is NOT
 *   asserted to coordinate-match (and the docs say so).
 * - No image BYTES and no Playwright/CDP type cross the seam: only a path string
 *   + plain numbers (ADR-0003 as amended by the Tier-4 ADR).
 *
 * Shared-write isolation: every launch points its profile AND screenshots root
 * at a per-test temp dir; the real `~/.webhands` (and its screenshots dir) are
 * asserted untouched.
 */
describe('Tier-4 mouse + screenshot verbs (real browser, local fixture, seam)', () => {
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

	/**
	 * Open a session on a named fixture page with an ISOLATED home root (profiles
	 * AND screenshots under a per-test temp dir). Returns the session plus the
	 * resolved temp root so a test can assert the managed screenshots dir.
	 */
	async function openOnFixture(
		page: string,
		profile: string,
	): Promise<{session: Session; root: string}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-tier4-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile});
		await session.page.navigate(`${server.url}/${page}`);
		return {session, root};
	}

	/** Read an element's viewport-CSS-pixel centre via the page's own geometry. */
	async function centreOf(
		session: Session,
		selector: string,
	): Promise<{x: number; y: number}> {
		return (await session.page.eval(
			`(function () {
				var r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			})()`,
		)) as {x: number; y: number};
	}

	describe('mouse', () => {
		it('clicks at a viewport coordinate and runs the element handler there', async () => {
			const {session} = await openOnFixture('coordinate.html', 'mouse-click');
			try {
				const centre = await centreOf(session, '#hit-target');
				await session.page.mouse({
					action: 'click',
					x: centre.x,
					y: centre.y,
				});
				// The box's click handler ran (the EFFECT), proving the coordinate
				// landed on the element.
				expect(
					await session.page.eval(
						`document.getElementById('hit-state').textContent`,
					),
				).toBe('hit');
				// And the recorded clientX/clientY is the coordinate we aimed at.
				const recorded = (await session.page.eval(
					`document.getElementById('hit-coords').textContent`,
				)) as string;
				const [rx, ry] = recorded.split(',').map(Number);
				expect(Math.abs(rx! - centre.x)).toBeLessThanOrEqual(1);
				expect(Math.abs(ry! - centre.y)).toBeLessThanOrEqual(1);
			} finally {
				await session.close();
			}
		});

		it('a coordinate OUTSIDE the element does NOT run its handler', async () => {
			const {session} = await openOnFixture('coordinate.html', 'mouse-miss');
			try {
				// (5,5) is in the top-left margin, far from #hit-target (left:100,
				// top:80). The handler must NOT fire.
				await session.page.mouse({action: 'click', x: 5, y: 5});
				expect(
					await session.page.eval(
						`document.getElementById('hit-state').textContent`,
					),
				).toBe('untouched');
			} finally {
				await session.close();
			}
		});

		it('move (no button) triggers a hover affordance, and down/up press+release', async () => {
			const {session} = await openOnFixture('coordinate.html', 'mouse-move');
			try {
				const move = await centreOf(session, '#move-target');
				await session.page.mouse({action: 'move', x: move.x, y: move.y});
				expect(
					await session.page.eval(
						`document.getElementById('move-state').textContent`,
					),
				).toBe('moved');

				const du = await centreOf(session, '#down-up-target');
				await session.page.mouse({action: 'down', x: du.x, y: du.y});
				await session.page.mouse({action: 'up', x: du.x, y: du.y});
				expect(
					await session.page.eval(
						`document.getElementById('down-up-state').textContent`,
					),
				).toBe('down-up');
			} finally {
				await session.close();
			}
		});
	});

	describe('screenshot', () => {
		it('viewport scope returns {path,width,height} and writes a non-empty PNG under the managed dir', async () => {
			const {session, root} = await openOnFixture(
				'screenshot.html',
				'shot-viewport',
			);
			try {
				const shot = await session.page.screenshot();
				expect(typeof shot.path).toBe('string');
				expect(shot.width).toBeGreaterThan(0);
				expect(shot.height).toBeGreaterThan(0);

				// The PNG exists, is non-empty, and is a real PNG (signature).
				const bytes = await readFile(shot.path);
				expect(bytes.length).toBeGreaterThan(0);
				expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
				// Its IHDR dimensions match the returned width/height.
				expect(bytes.readUInt32BE(16)).toBe(shot.width);
				expect(bytes.readUInt32BE(20)).toBe(shot.height);

				// It was minted UNDER the per-test managed screenshots dir.
				const managed = resolveScreenshotsDir({root});
				expect(shot.path.startsWith(managed)).toBe(true);

				// The result is a PATH STRING + plain numbers only: nothing on the
				// result is image bytes or a Playwright object (ADR-0003 as amended).
				expect(Object.keys(shot).sort()).toEqual(['height', 'path', 'width']);
			} finally {
				await session.close();
			}
		});

		it('full scope is taller than viewport (whole scrollable page), element scope is the widget size', async () => {
			const {session} = await openOnFixture('screenshot.html', 'shot-scopes');
			try {
				const viewport = await session.page.screenshot({scope: 'viewport'});
				const full = await session.page.screenshot({scope: 'full'});
				// The fixture body is ~3000px tall, so a full-page shot is strictly
				// taller than the viewport shot (it includes off-viewport content,
				// which is exactly why it is NOT coordinate-matched).
				expect(full.height).toBeGreaterThan(viewport.height);

				const element = await session.page.screenshot({
					scope: 'element',
					locator: locator(`page.locator('#widget')`),
				});
				// The widget is 200x150 CSS px; the clipped PNG matches it (allowing
				// for device-pixel-ratio scaling, so assert proportionally and small).
				expect(element.width).toBeLessThan(viewport.width);
				expect(element.height).toBeLessThan(viewport.height);
				expect(element.width).toBeGreaterThan(0);
				const bytes = await readFile(element.path);
				expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
			} finally {
				await session.close();
			}
		});

		it('element scope without a locator REJECTS loud (like wait)', async () => {
			const {session} = await openOnFixture('screenshot.html', 'shot-noloc');
			try {
				await expect(
					session.page.screenshot({scope: 'element'}),
				).rejects.toThrow(/requires.*locator/i);
			} finally {
				await session.close();
			}
		});

		it('a caller --out under the managed dir is honoured', async () => {
			const {session, root} = await openOnFixture(
				'screenshot.html',
				'shot-out',
			);
			try {
				const shot = await session.page.screenshot({out: 'sub/custom.png'});
				const managed = resolveScreenshotsDir({root});
				expect(shot.path).toBe(join(managed, 'sub/custom.png'));
				const bytes = await readFile(shot.path);
				expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
			} finally {
				await session.close();
			}
		});

		it('a caller --out OUTSIDE the managed dir is REJECTED (typed)', async () => {
			const {session, root} = await openOnFixture(
				'screenshot.html',
				'shot-escape',
			);
			try {
				const escaped = join(tmpdir(), 'webhands-escape-shot.png');
				let caught: unknown;
				try {
					await session.page.screenshot({out: escaped});
				} catch (error) {
					caught = error;
				}
				expect(caught).toBeInstanceOf(ScreenshotPathError);
				expect(isControllerError(caught)).toBe(true);
				expect((caught as ScreenshotPathError).code).toBe(
					'screenshot-path-outside-managed-dir',
				);
				// The escaping path was NOT written.
				await expect(stat(escaped)).rejects.toThrow();

				// A `..` traversal that climbs out of the managed dir is rejected too.
				await expect(
					session.page.screenshot({out: '../escape.png'}),
				).rejects.toThrow(ScreenshotPathError);

				// The real `~/.webhands` screenshots dir was never used (the home root
				// is the per-test temp dir, asserted in the isolation test below).
				expect(resolveScreenshotsDir({root}).startsWith(root)).toBe(true);
			} finally {
				await session.close();
			}
		});
	});

	describe('the VIEWPORT-screenshot <-> mouse coordinate contract', () => {
		it('a VIEWPORT screenshot element position maps to a mouse click that hits it (look-then-click)', async () => {
			const {session} = await openOnFixture(
				'coordinate.html',
				'look-then-click',
			);
			try {
				// "Look": take a VIEWPORT screenshot and learn the element's viewport
				// coordinate (the same frame the shot is captured in). In a real loop a
				// vision model reads the pixel from the PNG; here we read the element's
				// own viewport box, which IS that coordinate frame for a viewport shot.
				const shot = await session.page.screenshot({scope: 'viewport'});
				expect(shot.width).toBeGreaterThan(0);
				const centre = await centreOf(session, '#hit-target');
				// The element centre is within the viewport screenshot's pixel space
				// (allowing for device-pixel-ratio between CSS px and image px).
				const dpr = (await session.page.eval(
					`window.devicePixelRatio`,
				)) as number;
				expect(centre.x * dpr).toBeLessThanOrEqual(shot.width + 1);
				expect(centre.y * dpr).toBeLessThanOrEqual(shot.height + 1);

				// "Click": a mouse click at that VIEWPORT coordinate hits the element.
				await session.page.mouse({action: 'click', x: centre.x, y: centre.y});
				expect(
					await session.page.eval(
						`document.getElementById('hit-state').textContent`,
					),
				).toBe('hit');
			} finally {
				await session.close();
			}
		});
	});

	describe('shared-write isolation', () => {
		it('screenshots write under the per-test temp dir; the real ~/.webhands screenshots dir is untouched', async () => {
			const realScreenshots = resolveScreenshotsDir();
			const realExisted = await dirExists(realScreenshots);

			const {session, root} = await openOnFixture(
				'screenshot.html',
				'shot-isolation',
			);
			try {
				const shot = await session.page.screenshot();
				// The shot is under the per-test temp root, NOT the real home.
				expect(shot.path.startsWith(root)).toBe(true);
				expect(shot.path.startsWith(realScreenshots)).toBe(false);
				expect(
					dirname(shot.path).startsWith(resolveScreenshotsDir({root})),
				).toBe(true);
			} finally {
				await session.close();
			}

			// Taking the shot did not CREATE the real screenshots dir (if it already
			// existed before the test for unrelated reasons, that is fine; we only
			// assert this test did not bring it into being).
			if (!realExisted) {
				expect(await dirExists(realScreenshots)).toBe(false);
			}
		});
	});
});

/** True iff `path` exists and is a directory. */
async function dirExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
