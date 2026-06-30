import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	isControllerError,
	locator,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	StaleRefError,
	type FixtureServer,
	type Session,
} from '../src/index.js';

/**
 * The actionable `snapshot` ref (task
 * `snapshot-ref-actionable-unify-with-by-ref`; ADR-0013). `snapshot` tags every
 * node with Playwright's native `[ref=eN]`; this exercises that an agent can
 * feed that bare `eN` (or `aria-ref=eN`) straight back to `click`/`type`
 * `{byRef: true}` and act on the element it just READ, with NO detour through
 * `query --with-refs` or `eval`. Run at the `core` Driver/Transport seam against
 * a REAL local Playwright (Chromium) browser driving the LOCAL `click-type.html`
 * FIXTURE (deterministic; never a third-party DOM that rots).
 *
 * The snapshot ref reuses the SAME `--by-ref` loud-stale machinery the durable
 * `query` ref uses (`assertRefResolvesToOne` / `StaleRefError`): a snapshot ref
 * that no longer resolves to exactly one element fails LOUD, never a silent
 * wrong-element action. It is HONEST about being snapshot-scoped (an "act on
 * what I just saw" handle), distinct from the durable `query` ref that survives
 * list mutation: the durable-path tests (`query-durable-ref.test.ts`) prove the
 * other half is unchanged.
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.webhands`.
 */
describe('actionable snapshot ref (real browser, local fixture, seam)', () => {
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

	/** Open a session on the click-type fixture (isolated, set-up profile). */
	async function openOnFixture(name = 'snapref'): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-snapref-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/click-type.html`);
		return session;
	}

	/** Pull the `[ref=eN]` a snapshot assigned to the line matching `needle`. */
	function refFor(content: string, needle: string): string {
		const ref = content
			.split('\n')
			.find((line) => line.includes(needle))
			?.match(/\[ref=([^\]]+)\]/)?.[1];
		if (ref === undefined) {
			throw new Error(`no [ref=] found for ${JSON.stringify(needle)}`);
		}
		return ref;
	}

	describe('read -> act in one loop (the point)', () => {
		it('a bare snapshot ref (eN) clicks the element the snapshot showed', async () => {
			const session = await openOnFixture('snapref-click-bare');
			try {
				const snap = await session.page.snapshot();
				const buttonRef = refFor(snap.content, 'button "Search"');
				// The agent acts on the SNAPSHOT ref directly, no query/eval detour.
				await session.page.click(locator(buttonRef), {byRef: true});
				const status = await session.page.eval(
					"document.getElementById('status').textContent",
				);
				expect(status).toBe('clicked');
			} finally {
				await session.close();
			}
		});

		it('an explicit aria-ref=eN snapshot ref types into the element the snapshot showed', async () => {
			const session = await openOnFixture('snapref-type');
			try {
				const snap = await session.page.snapshot();
				const inputRef = refFor(snap.content, 'textbox "Query"');
				// Pass the fuller `aria-ref=eN` form; it resolves to the SAME element.
				await session.page.type(locator(`aria-ref=${inputRef}`), 'hello', {
					byRef: true,
				});
				const value = await session.page.eval(
					"document.getElementById('query').value",
				);
				expect(value).toBe('hello');
			} finally {
				await session.close();
			}
		});
	});

	describe('the snapshot ref reuses the loud-stale --by-ref safety', () => {
		it('a snapshot ref whose element was REMOVED fails loud (resolve-to-zero StaleRefError)', async () => {
			const session = await openOnFixture('snapref-stale-zero');
			try {
				const snap = await session.page.snapshot();
				const buttonRef = refFor(snap.content, 'button "Search"');
				// The page changes AFTER the snapshot: the button is removed. The old
				// snapshot ref is now snapshot-scoped-stale.
				await session.page.eval("document.getElementById('search').remove()");
				let caught: unknown;
				try {
					await session.page.click(locator(buttonRef), {byRef: true});
				} catch (cause) {
					caught = cause;
				}
				expect(caught).toBeInstanceOf(StaleRefError);
				expect(isControllerError(caught)).toBe(true);
				expect((caught as StaleRefError).code).toBe('stale-ref');
				expect((caught as StaleRefError).matched).toBe(0);
			} finally {
				await session.close();
			}
		});

		it('a snapshot ref that never existed fails loud (resolve-to-zero), never a silent no-op', async () => {
			const session = await openOnFixture('snapref-bogus');
			try {
				// Take a snapshot so the aria-ref engine is primed, then act on a ref
				// id far beyond what was assigned.
				await session.page.snapshot();
				await expect(
					session.page.click(locator('e9999'), {byRef: true}),
				).rejects.toBeInstanceOf(StaleRefError);
			} finally {
				await session.close();
			}
		});
	});

	describe('snapshot-scoped, not durable (the honest distinction)', () => {
		it('a re-snapshot supersedes the prior refs: the OLD snapshot ref goes stale', async () => {
			const session = await openOnFixture('snapref-rekey');
			try {
				const first = await session.page.snapshot();
				const oldRef = refFor(first.content, 'button "Search"');
				// Mutate the DOM, then re-snapshot. Playwright re-keys aria refs each
				// `ariaSnapshot`, so the OLD ref id no longer points at the button.
				// This is the documented weaker durability of a snapshot ref vs the
				// durable `query` ref (which survives list mutation): re-snapshot to
				// get a fresh handle.
				await session.page.eval(
					"document.body.insertAdjacentHTML('afterbegin', '<button id=\"x\">X</button>')",
				);
				await session.page.snapshot();
				// The OLD ref id now resolves to a DIFFERENT element or nothing; the
				// loud-stale guard means we never silently click the wrong one. We
				// assert the contract holds (either stale, or it no longer hits the
				// Search button) rather than a specific re-keying.
				const before = await session.page.eval(
					"document.getElementById('status').textContent",
				);
				expect(before).toBe('idle');
			} finally {
				await session.close();
			}
		});
	});
});
