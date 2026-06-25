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
 * The `click` and `type` verbs (PRD story 8), exercised at the `core`
 * Driver/Transport seam against a REAL local Playwright (Chromium) browser
 * driving the LOCAL FIXTURE PAGE (deterministic, never a third-party site whose
 * DOM rots), per the PRD "Testing Decisions".
 *
 * Elements are addressed by a RAW Playwright locator string (ADR-0004), passed
 * through `locator(...)` exactly as an agent would emit it (`getByRole(...)`,
 * `getByLabel(...)`, `locator('#id')`) — not a reduced subset, not structured
 * JSON. Each verb's EFFECT is asserted against the controlled fixture: `click`
 * runs the element's handler (incl. the hidden-input dispatch path where a
 * normal click would time out), `type` fills the addressed input.
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.my-browser-controller`.
 */
describe('click + type verbs (real browser, local fixture, seam)', () => {
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
	async function openOnFixture(name = 'click-type'): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-click-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/click-type.html`);
		return session;
	}

	describe('click', () => {
		it('resolves a raw Playwright locator string and runs the element handler', async () => {
			const session = await openOnFixture('click-visible');
			try {
				// Precondition: the button has not been clicked yet.
				expect(
					await session.page.eval(
						`document.getElementById('status').textContent`,
					),
				).toBe('idle');

				// Address by a RAW Playwright locator string (ADR-0004), as an agent
				// would emit it — resolved by the active transport, no reduced subset.
				await session.page.click(
					locator(`page.getByRole('button', { name: 'Search' })`),
				);

				// The element's own click handler ran (effect asserted on the fixture,
				// not on the click call merely not throwing).
				expect(
					await session.page.eval(
						`document.getElementById('status').textContent`,
					),
				).toBe('clicked');
			} finally {
				await session.close();
			}
		});

		// This case deliberately drives the SLOW path: the normal click must
		// auto-wait out its actionability timeout before the dispatch fallback
		// runs, so it needs more than the default 5s test budget (browser launch +
		// the intentional click-timeout wait). The latency itself is asserted by
		// the effect below, not the wall-clock.
		it('dispatches a click on a HIDDEN custom input where a normal click would time out', async () => {
			const session = await openOnFixture('click-hidden');
			try {
				// The hidden custom control starts un-toggled. A normal,
				// actionability-checked click can NEVER fire it (it is `display:none`
				// and never becomes visible) — only the verb's dispatch escape path
				// reaches it.
				expect(
					await session.page.eval(
						`document.getElementById('hidden-state').textContent`,
					),
				).toBe('untoggled');

				// Address the hidden element by a CSS/id locator. A role/name locator
				// (`getByRole`) would resolve to ZERO matches here, because a
				// `display:none` element is excluded from the accessibility tree — so
				// the dispatch escape path is reachable only via a locator that does
				// not depend on the a11y tree (the realistic way an agent addresses a
				// hidden custom input). See the task's ## Decisions note.
				await session.page.click(locator(`page.locator('#hidden-toggle')`));

				// The dispatched click fired the hidden element's handler.
				expect(
					await session.page.eval(
						`document.getElementById('hidden-state').textContent`,
					),
				).toBe('toggled');
			} finally {
				await session.close();
			}
		}, 15_000);
	});

	describe('type', () => {
		it('fills the input addressed by a raw Playwright locator string', async () => {
			const session = await openOnFixture('type-fill');
			try {
				expect(
					await session.page.eval(`document.getElementById('query').value`),
				).toBe('');

				await session.page.type(
					locator(`page.getByLabel('Query')`),
					'hello world',
				);

				expect(
					await session.page.eval(`document.getElementById('query').value`),
				).toBe('hello world');
			} finally {
				await session.close();
			}
		});

		it('replaces existing input content (fill semantics) on a second type', async () => {
			const session = await openOnFixture('type-replace');
			try {
				await session.page.type(locator(`page.locator('#query')`), 'first');
				expect(
					await session.page.eval(`document.getElementById('query').value`),
				).toBe('first');

				await session.page.type(locator(`page.locator('#query')`), 'second');
				expect(
					await session.page.eval(`document.getElementById('query').value`),
				).toBe('second');
			} finally {
				await session.close();
			}
		});
	});
});
