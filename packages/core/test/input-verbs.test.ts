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
 * The Tier-2 rich INPUT verbs `press` / `hover` / `select` / `scroll` / `drag`
 * (prd `broaden-agent-verb-surface`, stories 8-12), exercised at the `core`
 * Driver/Transport seam against a REAL local Playwright (Chromium) browser
 * driving the LOCAL FIXTURE PAGES (deterministic, never a third-party site
 * whose DOM rots), per the prd "Testing Decisions".
 *
 * Elements are addressed by a RAW Playwright locator string (ADR-0004), passed
 * through `locator(...)` exactly as an agent would emit it. Each verb's EFFECT
 * is asserted against the controlled fixture (a recorded key event, the
 * hover-only affordance, the `<select>`'s live state, the scroll position /
 * visibility, the drop handler), not merely that the call did not throw. Keys
 * are strings, offsets are numbers, locators are strings, so nothing
 * Playwright-shaped crosses the seam (ADR-0003).
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.webhands`.
 */
describe('rich input verbs (real browser, local fixture, seam)', () => {
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

	/** Open a session on a named fixture page (isolated, set-up profile). */
	async function openOnFixture(
		page: string,
		profile: string,
	): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-input-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile});
		await session.page.navigate(`${server.url}/${page}`);
		return session;
	}

	describe('press', () => {
		it('sends a single key, a named key, and a chord at a locator (recorded)', async () => {
			const session = await openOnFixture('keyboard.html', 'press-locator');
			try {
				const input = locator(`page.locator('#focus-input')`);
				// A single character key.
				await session.page.press('a', input);
				// A named key.
				await session.page.press('Enter', input);
				await session.page.press('ArrowLeft', input);
				// A chord (Modifier+Key): the recorder logs the held modifier.
				await session.page.press('Control+a', input);

				const log = (await session.page.eval(
					`document.getElementById('keylog').textContent`,
				)) as string;
				const events = log.split(',');
				expect(events).toEqual(['a', 'Enter', 'ArrowLeft', 'Control+a']);
			} finally {
				await session.close();
			}
		});

		it('sends a key to the FOCUSED element when no locator is given', async () => {
			const session = await openOnFixture('keyboard.html', 'press-focused');
			try {
				// The fixture focuses #focus-input on load; a press with NO locator
				// must land there (the focused-element form).
				await session.page.press('x');
				const log = (await session.page.eval(
					`document.getElementById('keylog').textContent`,
				)) as string;
				expect(log).toBe('x');
			} finally {
				await session.close();
			}
		});

		it('drives a keyboard-controlled counter (ArrowUp/ArrowDown) at a locator', async () => {
			const session = await openOnFixture('keyboard.html', 'press-game');
			try {
				const game = locator(`page.locator('#game')`);
				await session.page.press('ArrowUp', game);
				await session.page.press('ArrowUp', game);
				await session.page.press('ArrowDown', game);
				expect(
					await session.page.eval(
						`document.getElementById('counter').textContent`,
					),
				).toBe('1');
			} finally {
				await session.close();
			}
		});
	});

	describe('hover', () => {
		it('triggers a hover-only affordance a click cannot surface', async () => {
			const session = await openOnFixture('hover.html', 'hover');
			try {
				// Precondition: the reveal-on-hover item is hidden and no enter fired.
				expect(
					await session.page.isVisible(locator(`page.locator('#menu-item')`)),
				).toBe(false);
				expect(
					await session.page.eval(
						`document.getElementById('hover-state').textContent`,
					),
				).toBe('idle');

				await session.page.hover(locator(`page.locator('#menu')`));

				// The hover affordance fired: the item is revealed AND the mouseenter
				// handler ran.
				expect(
					await session.page.isVisible(locator(`page.locator('#menu-item')`)),
				).toBe(true);
				expect(
					await session.page.eval(
						`document.getElementById('hover-state').textContent`,
					),
				).toBe('entered');
			} finally {
				await session.close();
			}
		});
	});

	describe('select', () => {
		it('sets a native <select> by VALUE, reflected in the live state', async () => {
			const session = await openOnFixture('select.html', 'select-value');
			try {
				await session.page.select(locator(`page.locator('#color')`), {
					value: 'g',
				});
				expect(
					await session.page.eval(`document.getElementById('color').value`),
				).toBe('g');
				// The change handler mirrored the value into #chosen.
				expect(
					await session.page.eval(
						`document.getElementById('chosen').textContent`,
					),
				).toBe('g');
			} finally {
				await session.close();
			}
		});

		it('sets a native <select> by LABEL, reflected in the live state', async () => {
			const session = await openOnFixture('select.html', 'select-label');
			try {
				// Label "Blue" maps to value "b" (value != label, so this proves the
				// label form, not the value form).
				await session.page.select(locator(`page.locator('#color')`), {
					label: 'Blue',
				});
				expect(
					await session.page.eval(`document.getElementById('color').value`),
				).toBe('b');
				expect(
					await session.page.eval(
						`document.getElementById('chosen').textContent`,
					),
				).toBe('b');
			} finally {
				await session.close();
			}
		});
	});

	describe('scroll', () => {
		it('--to brings an off-viewport element into view', async () => {
			const session = await openOnFixture('scroll.html', 'scroll-to');
			try {
				// Precondition: the page is at the top, so the far target (4000px down)
				// is off-viewport.
				const before = (await session.page.eval(`window.scrollY`)) as number;
				expect(before).toBe(0);

				await session.page.scroll({to: locator(`page.locator('#far-target')`)});

				const after = (await session.page.eval(`window.scrollY`)) as number;
				// Scrolling to the bottom element moved the viewport down, and the
				// target is now visible in the viewport.
				expect(after).toBeGreaterThan(before);
				expect(
					await session.page.isVisible(locator(`page.locator('#far-target')`)),
				).toBe(true);
			} finally {
				await session.close();
			}
		});

		it('--by scrolls the page by the given pixel delta', async () => {
			const session = await openOnFixture('scroll.html', 'scroll-by');
			try {
				expect(await session.page.eval(`window.scrollY`)).toBe(0);
				await session.page.scroll({by: {dx: 0, dy: 400}});
				// mouse.wheel dispatches the wheel event but the renderer applies the
				// scroll asynchronously; pace a beat (the `wait` verb) before reading
				// the settled position. The fixture has no smooth-scroll, so it settles
				// exactly to the requested delta.
				await session.page.wait({kind: 'timeout', ms: 100});
				const after = (await session.page.eval(`window.scrollY`)) as number;
				expect(after).toBe(400);
			} finally {
				await session.close();
			}
		});
	});

	describe('drag', () => {
		it('drags a source onto a target and runs the drop handler', async () => {
			const session = await openOnFixture('drag.html', 'drag');
			try {
				expect(
					await session.page.eval(
						`document.getElementById('drop-state').textContent`,
					),
				).toBe('idle');
				// Before the drop, the source is NOT a child of the target.
				expect(
					await session.page.eval(
						`document.getElementById('drop-target').contains(document.getElementById('drag-source'))`,
					),
				).toBe(false);

				await session.page.drag(
					locator(`page.locator('#drag-source')`),
					locator(`page.locator('#drop-target')`),
				);

				// The drop handler ran: state flipped and the source moved into the
				// target (the DOM order changed).
				expect(
					await session.page.eval(
						`document.getElementById('drop-state').textContent`,
					),
				).toBe('dropped');
				expect(
					await session.page.eval(
						`document.getElementById('drop-target').contains(document.getElementById('drag-source'))`,
					),
				).toBe(true);
			} finally {
				await session.close();
			}
		}, 15_000);
	});
});
