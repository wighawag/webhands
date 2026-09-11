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
 * The `--dom` ESCAPE and `click`'s `via` reporting, against real controls HIDDEN
 * BEHIND STYLED LABELS (finding
 * `real-sites-hide-form-controls-behind-styled-labels`; ADR-0015).
 *
 * The problem these close: real sites hide radios/checkboxes behind styled labels
 * constantly. Playwright is RIGHT to refuse to act on what a user could not act
 * on, so an actionability-checked verb waits out its timeout. `click` already had a
 * fallback, but SILENTLY (the caller could not tell a real click from a dispatched
 * event at an invisible node, which on a hostile form may be a honeypot), and the
 * sibling verbs had no escape at all and burned Playwright's 30s default.
 *
 * So two things are asserted here, both against the fixture's own recorded effects
 * rather than "the call did not throw":
 *
 * 1. `--dom` makes each verb fire what the page actually listens for.
 * 2. `click` REPORTS which path it took (`via: 'click' | 'dispatch'`).
 *
 * Real browser, local fixture, per-test temp profile root (the real `~/.webhands`
 * is never touched).
 */
describe('dom escape + click via (real browser, label-hidden controls)', () => {
	let server: FixtureServer;
	const tempRoots: string[] = [];
	const opened: Session[] = [];

	beforeAll(async () => {
		server = await startFixtureServer();
	});

	afterAll(async () => {
		await server.close();
	});

	afterEach(async () => {
		// Close sessions the helper opened, so a failed assertion cannot leak a browser
		// (the helper registers them the moment they exist, before the caller's
		// try/finally can).
		while (opened.length > 0) {
			await opened
				.pop()!
				.close()
				.catch(() => {});
		}
		while (tempRoots.length > 0) {
			// Retried: a just-closed Chromium can still be flushing its profile, and a
			// teardown ENOTEMPTY would read as a test failure.
			await rm(tempRoots.pop()!, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
		}
	});

	/** Open a session on the label-hidden-controls fixture. */
	async function openFixture(name: string): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-dom-escape-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		// Registered BEFORE the navigate: if that throws, the caller never receives the
		// session and its own try/finally cannot close it, so teardown must own it.
		opened.push(session);
		await session.page.navigate(`${server.url}/label-hidden-controls.html`);
		return session;
	}

	/** Read a fixture state paragraph. */
	async function state(session: Session, id: string): Promise<unknown> {
		return session.page.eval(
			`document.getElementById(${JSON.stringify(id)}).textContent`,
		);
	}

	describe('click reports HOW it clicked', () => {
		it('reports via "click" for a normal visible button', async () => {
			const session = await openFixture('via-click');
			try {
				await session.page.navigate(`${server.url}/click-type.html`);
				const result = await session.page.click(
					locator(`page.getByRole('button', { name: 'Search' })`),
				);
				// A real, actionability-checked click: the caller can trust that a human
				// could have done this.
				expect(result).toEqual({via: 'click'});
				expect(await state(session, 'status')).toBe('clicked');
			} finally {
				await session.close();
			}
		});

		it('reports via "dispatch" when it fell back on a label-hidden radio', async () => {
			const session = await openFixture('via-dispatch');
			try {
				const result = await session.page.click(
					locator(`page.locator('#seat-window')`),
				);
				// The escape engaged, and SAYS SO: an agent that asked to click a control
				// and learns it was only dispatched can decide whether that is acceptable
				// (it is, for a styled radio; it is not, for a honeypot field).
				expect(result).toEqual({via: 'dispatch'});
				// The radio really changed (the CHANGE event fired, i.e. the activation
				// behaviour ran, not just a listener).
				expect(await state(session, 'seat-state')).toBe('window');
			} finally {
				await session.close();
			}
		});

		it('with dom:true goes STRAIGHT to the dispatch (no actionability wait)', async () => {
			const session = await openFixture('via-dom-explicit');
			try {
				const started = Date.now();
				const result = await session.page.click(
					locator(`page.locator('#terms')`),
					{dom: true},
				);
				const elapsed = Date.now() - started;

				expect(result).toEqual({via: 'dispatch'});
				expect(await state(session, 'terms-state')).toBe('checked');
				// It skipped the actionability budget entirely: the caller already knew the
				// control is hidden, so there was nothing to wait for. The bound excludes
				// both alternatives (the 1s fallback and Playwright's 30s default) with room
				// to spare: a tighter 900ms sat right beside the 1000ms value it
				// discriminates from, which on a loaded machine is a flake that reads as a
				// real failure.
				expect(elapsed).toBeLessThan(3_000);
			} finally {
				await session.close();
			}
		});

		it('still fails LOUD, and FAST, with dom:true when the locator matches nothing', async () => {
			const session = await openFixture('dom-bad-locator');
			try {
				// The escape skips ACTIONABILITY, not EXISTENCE: a typo must not look
				// like a successful click on nothing.
				const started = Date.now();
				await expect(
					session.page.click(locator(`page.locator('#no-such-control')`), {
						dom: true,
					}),
				).rejects.toThrow();
				// And fast. This guards a FIXED bug: the dispatch used to receive its
				// bound as an event FIELD rather than an option
				// (`dispatchEvent('click', {timeout})`), so Playwright's 30s default
				// applied and a bad locator hung for 30s while the code comment claimed
				// it failed quickly.
				expect(Date.now() - started).toBeLessThan(10_000);
			} finally {
				await session.close();
			}
		});
	});

	describe('the sibling verbs get the same opt-in escape', () => {
		it('type --dom sets the value and fires input on a hidden field', async () => {
			const session = await openFixture('dom-type');
			try {
				await session.page.type(
					locator(`page.locator('#hidden-note')`),
					'window please',
					{dom: true},
				);
				expect(await state(session, 'note-state')).toBe('note=window please');
			} finally {
				await session.close();
			}
		});

		it('select --dom chooses by value AND by label on a hidden <select>', async () => {
			const session = await openFixture('dom-select');
			try {
				await session.page.select(
					locator(`page.locator('#hidden-qty')`),
					{value: '2'},
					{dom: true},
				);
				expect(await state(session, 'qty-state')).toBe('qty=2');

				// The label form resolves against the option's visible text.
				await session.page.select(
					locator(`page.locator('#hidden-qty')`),
					{label: 'One seat'},
					{dom: true},
				);
				expect(await state(session, 'qty-state')).toBe('qty=1');
			} finally {
				await session.close();
			}
		});

		it('select --dom fails LOUD when no option matches (never a silent no-op)', async () => {
			const session = await openFixture('dom-select-miss');
			try {
				await expect(
					session.page.select(
						locator(`page.locator('#hidden-qty')`),
						{label: 'Three seats'},
						{dom: true},
					),
				).rejects.toThrow(/no <option> matched/i);
				// Nothing was selected, so the page state is untouched.
				expect(await state(session, 'qty-state')).toBe('qty-unset');
			} finally {
				await session.close();
			}
		});

		it('press --dom fires the key handler of a hidden element', async () => {
			const session = await openFixture('dom-press');
			try {
				await session.page.press(
					'Enter',
					locator(`page.locator('#hidden-hotkey')`),
					{dom: true},
				);
				expect(await state(session, 'hotkey-state')).toBe('key=Enter');
			} finally {
				await session.close();
			}
		});

		it('hover --dom fires the mouseover handler of a hidden trigger', async () => {
			const session = await openFixture('dom-hover');
			try {
				await session.page.hover(
					locator(`page.locator('#hidden-menu-trigger')`),
					{dom: true},
				);
				expect(await state(session, 'menu-state')).toBe('menu-open');
			} finally {
				await session.close();
			}
		});
	});

	describe('the default stays fail-loud (the escape is opt-in)', () => {
		it('type on a hidden field FAILS rather than silently setting the value', async () => {
			const session = await openFixture('no-dom-type');
			try {
				// With a short --timeout so the test does not sit through Playwright's
				// 30s default; the POINT is that it refuses, not how long it waits.
				await expect(
					session.page.type(locator(`page.locator('#hidden-note')`), 'sneaky', {
						timeoutMs: 700,
					}),
				).rejects.toThrow();
				// Crucially the page was NOT modified: an invisible field could be a
				// honeypot, and filling it by default is what we refuse to do.
				expect(await state(session, 'note-state')).toBe('note-empty');
			} finally {
				await session.close();
			}
		});

		it('timeoutMs bounds the wait without changing the action', async () => {
			const session = await openFixture('timeout-bound');
			try {
				const started = Date.now();
				await expect(
					session.page.hover(locator(`page.locator('#hidden-menu-trigger')`), {
						timeoutMs: 500,
					}),
				).rejects.toThrow();
				const elapsed = Date.now() - started;
				// Nowhere near Playwright's 30s default: the caller chose the budget.
				expect(elapsed).toBeLessThan(5_000);
				expect(await state(session, 'menu-state')).toBe('menu-closed');
			} finally {
				await session.close();
			}
		});
	});
});
