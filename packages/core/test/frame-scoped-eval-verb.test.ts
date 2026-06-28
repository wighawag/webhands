import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	CrossOriginFrameError,
	isControllerError,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
	type Session,
} from '../src/index.js';

/**
 * The Tier-3 FRAME-SCOPED `eval` (prd `broaden-agent-verb-surface`, story 13),
 * exercised at the `core` Driver/Transport seam against a REAL local Playwright
 * (Chromium) browser driving the LOCAL FIXTURE PAGES (deterministic, never a
 * third-party site whose DOM rots), per the prd "Testing Decisions".
 *
 * `eval` gains an optional `frame` SELECTOR (the ONE `frame?` qualifier on the
 * surface, R1): with it, the expression runs inside a NAMED SAME-ORIGIN child
 * frame and returns its value by the SAME structured-clone contract `eval`
 * already has; without it, `eval` is exactly its top-document self (backward
 * compatible). A CROSS-ORIGIN frame selector fails LOUD with a typed
 * {@link CrossOriginFrameError} (page-world JS cannot cross a security boundary)
 * rather than a silent empty.
 *
 * The cross-origin half needs a SECOND origin: a same-origin parent embeds a
 * same-origin `#main-iframe` child (the fixture pages), and the test points a
 * second iframe at a SEPARATE fixture server (a different port == a different
 * origin) to exercise the loud cross-origin error.
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.webhands`.
 */
describe('frame-scoped eval verb (real browser, local fixture, seam)', () => {
	let server: FixtureServer;
	// A SECOND fixture server on a different port => a different origin, so an
	// iframe pointed here is cross-origin relative to `server`.
	let crossServer: FixtureServer;
	const tempRoots: string[] = [];

	beforeAll(async () => {
		server = await startFixtureServer();
		crossServer = await startFixtureServer();
	});

	afterAll(async () => {
		await server.close();
		await crossServer.close();
	});

	afterEach(async () => {
		while (tempRoots.length > 0) {
			const dir = tempRoots.pop()!;
			await rm(dir, {recursive: true, force: true});
		}
	});

	/** Open a session on the frame-parent fixture (isolated, set-up profile). */
	async function openOnFixture(name = 'frame-eval'): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-frame-eval-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/frame-parent.html`);
		return session;
	}

	it('with no frame behaves exactly as the top-document eval (backward compatible)', async () => {
		const session = await openOnFixture('frame-eval-default');
		try {
			// The top document carries `#top-marker` but NOT `#child-marker` (that
			// lives only in the child frame), so the top-frame default reads the top
			// value and `null` for the child-only element.
			expect(
				await session.page.eval(
					`document.getElementById('top-marker').textContent`,
				),
			).toBe('top-only-value');
			expect(
				await session.page.eval(`document.getElementById('child-marker')`),
			).toBeNull();
			// And a bare arithmetic expression is unchanged.
			expect(await session.page.eval('1 + 2')).toBe(3);
		} finally {
			await session.close();
		}
	});

	it('with a same-origin frame evaluates IN the child frame and returns by value', async () => {
		const session = await openOnFixture('frame-eval-same');
		try {
			// Reads a value present ONLY in the child document (the top frame's
			// `#child-marker` is null, asserted above), proving the expression ran
			// in the child, not the top document.
			expect(
				await session.page.eval(
					`document.getElementById('child-marker').textContent`,
					{frame: '#main-iframe'},
				),
			).toBe('child-only-value');

			// Reads a RUNTIME-ONLY JS value the top page world cannot reach.
			expect(
				await session.page.eval('window.__childValue', {
					frame: '#main-iframe',
				}),
			).toBe('runtime-only-child-value');
		} finally {
			await session.close();
		}
	});

	it('fires a child-frame callback and the effect is observable in the child', async () => {
		const session = await openOnFixture('frame-eval-callback');
		try {
			// Before: the child callback has not fired.
			expect(
				await session.page.eval('window.__callbackFired', {
					frame: '#main-iframe',
				}),
			).toBe(false);

			// Fire the child-frame callback (the captcha `data-callback` case): the
			// expression returns the callback's value by structured clone.
			expect(
				await session.page.eval('window.fireCallback()', {
					frame: '#main-iframe',
				}),
			).toBe('callback-result');

			// After: the effect is OBSERVABLE inside the child frame.
			expect(
				await session.page.eval('window.__callbackFired', {
					frame: '#main-iframe',
				}),
			).toBe(true);
			expect(
				await session.page.eval(
					`document.getElementById('callback-state').textContent`,
					{frame: '#main-iframe'},
				),
			).toBe('fired');
			// ...and NOT in the top document (the top `#callback-state` does not exist).
			expect(
				await session.page.eval(`document.getElementById('callback-state')`),
			).toBeNull();
		} finally {
			await session.close();
		}
	});

	it('preserves the structured-clone contract for a frame-scoped object result', async () => {
		const session = await openOnFixture('frame-eval-clone');
		try {
			// The child-frame result crosses by VALUE, the same richer-than-JSON
			// clone the top-document `eval` documents (object graph round-trips).
			expect(
				await session.page.eval(
					`({ marker: document.getElementById('child-marker').textContent, n: 1 / 0 })`,
					{frame: '#main-iframe'},
				),
			).toEqual({marker: 'child-only-value', n: Infinity});
		} finally {
			await session.close();
		}
	});

	it('rejects a CROSS-ORIGIN frame with a typed, loud error (never a silent empty)', async () => {
		const session = await openOnFixture('frame-eval-cross');
		try {
			// Inject an iframe pointed at the SECOND fixture server (a different
			// origin), then wait for it to load, so the selector resolves to a
			// genuinely cross-origin frame.
			await session.page.eval(
				`(function () {
					return new Promise(function (resolve) {
						var f = document.createElement('iframe');
						f.id = 'cross-iframe';
						f.src = ${JSON.stringify(`${crossServer.url}/frame-child.html`)};
						f.addEventListener('load', function () { resolve('loaded'); });
						document.body.appendChild(f);
					});
				})()`,
			);

			// A frame-scoped eval into the cross-origin frame fails LOUD, not silent.
			await expect(
				session.page.eval(
					`document.getElementById('child-marker').textContent`,
					{frame: '#cross-iframe'},
				),
			).rejects.toThrow(CrossOriginFrameError);

			// The typed error is identifiable (machine-readable code), not just a
			// message: an in-process caller can branch on it.
			let caught: unknown;
			try {
				await session.page.eval('1 + 1', {frame: '#cross-iframe'});
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(CrossOriginFrameError);
			expect(isControllerError(caught)).toBe(true);
			expect((caught as CrossOriginFrameError).code).toBe('cross-origin-frame');
			expect((caught as CrossOriginFrameError).message).toMatch(
				/cross-origin/i,
			);
		} finally {
			await session.close();
		}
	});

	it('rejects when the frame selector matches no iframe element', async () => {
		const session = await openOnFixture('frame-eval-missing');
		try {
			await expect(
				session.page.eval('1 + 1', {frame: '#no-such-frame'}),
			).rejects.toThrow(/no iframe element matched/i);
		} finally {
			await session.close();
		}
	});

	it('still rejects a page-side throw inside a same-origin frame', async () => {
		const session = await openOnFixture('frame-eval-throws');
		try {
			await expect(
				session.page.eval(
					`(function () { throw new Error('child-boom'); })()`,
					{frame: '#main-iframe'},
				),
			).rejects.toThrow('child-boom');
		} finally {
			await session.close();
		}
	});
});
