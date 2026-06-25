import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
	type Session,
} from '../src/index.js';

/**
 * The `eval` verb (PRD story 9), exercised at the `core` Driver/Transport seam
 * against a REAL local Playwright (Chromium) browser driving the LOCAL FIXTURE
 * PAGE (deterministic, never a third-party site whose DOM rots), per the PRD
 * "Testing Decisions".
 *
 * `eval` is the escape hatch: it runs a raw JS EXPRESSION in the active page's
 * context and returns its serializable result. The result is asserted against
 * the fixture's own controlled state (`#marker`, `window.__fixture`,
 * `window.__fixtureAsync`, `window.__fixtureCircular`), not third-party DOM. The
 * edge / page-throw cases lock down the seam's SERIALIZATION CONTRACT (see
 * `Page.eval`): the result is structurally cloned out of the page by VALUE,
 * richer than JSON, so NaN/Infinity/BigInt and circular structures are
 * PRESERVED, functions/symbols come back as `undefined`, a live DOM node comes
 * back as an opaque preview string, and only a page-side THROW rejects (with a
 * plain `Error`, no Playwright/CDP type leak, ADR-0003).
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.my-browser-controller`.
 */
describe('eval verb (real browser, local fixture, seam)', () => {
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

	/** Open a session on the eval fixture (isolated, set-up profile). */
	async function openOnFixture(name = 'eval'): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-eval-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/eval.html`);
		return session;
	}

	it('runs a JS expression and returns its serializable result', async () => {
		const session = await openOnFixture('eval-expr');
		try {
			// A bare arithmetic expression evaluates AS AN EXPRESSION (not a
			// function body): its value is the result.
			expect(await session.page.eval('1 + 2')).toBe(3);

			// Reads the fixture's own controlled DOM state, asserted by value.
			expect(
				await session.page.eval(
					`document.getElementById('marker').textContent`,
				),
			).toBe('marker-value');
		} finally {
			await session.close();
		}
	});

	it('returns an object/array result by value', async () => {
		const session = await openOnFixture('eval-object');
		try {
			// A known object graph the fixture set on `window` crosses the seam by
			// value (deep-equal, not a live reference).
			expect(await session.page.eval('window.__fixture')).toEqual({
				count: 42,
				label: 'fixture-label',
				nested: [1, 2, 3],
			});

			expect(await session.page.eval('window.__fixture.nested')).toEqual([
				1, 2, 3,
			]);
		} finally {
			await session.close();
		}
	});

	it('awaits a Promise result and returns the resolved value', async () => {
		const session = await openOnFixture('eval-async');
		try {
			// The fixture function resolves after a tick on its OWN clock
			// (deterministic). `eval` awaits it and returns the resolved value.
			expect(await session.page.eval('window.__fixtureAsync()')).toBe(
				'async-resolved',
			);
		} finally {
			await session.close();
		}
	});

	it('round-trips undefined / null and primitive results', async () => {
		const session = await openOnFixture('eval-primitives');
		try {
			expect(await session.page.eval('undefined')).toBeUndefined();
			expect(await session.page.eval('null')).toBeNull();
			expect(await session.page.eval('true')).toBe(true);
			expect(await session.page.eval(`'hello'`)).toBe('hello');
		} finally {
			await session.close();
		}
	});

	it('preserves non-finite numbers and BigInt (clone is richer than JSON)', async () => {
		const session = await openOnFixture('eval-nonfinite');
		try {
			// The transport's structured clone is richer than `JSON.stringify`
			// (which would lose these): NaN/Infinity/BigInt cross the seam as their
			// real JS values (see the serialization contract on Page.eval).
			expect(await session.page.eval('NaN')).toBeNaN();
			expect(await session.page.eval('1 / 0')).toBe(Infinity);
			expect(await session.page.eval('10n')).toBe(10n);
		} finally {
			await session.close();
		}
	});

	it('returns undefined for values with no JSON form (functions, symbols)', async () => {
		const session = await openOnFixture('eval-nojson');
		try {
			expect(await session.page.eval('(function () {})')).toBeUndefined();
			expect(await session.page.eval(`Symbol('x')`)).toBeUndefined();
		} finally {
			await session.close();
		}
	});

	it('preserves a circular structure (back-refs become a [Circular] marker, no throw)', async () => {
		const session = await openOnFixture('eval-circular');
		try {
			// Unlike a JSON encoding (which would throw on a cycle), the transport's
			// structured clone PRESERVES the circular structure: it returns an object
			// whose back-reference is the `[Circular]` marker, so the escape hatch
			// resolves rather than failing.
			const result = (await session.page.eval('window.__fixtureCircular')) as {
				self: unknown;
			};
			expect(typeof result).toBe('object');
			expect(result).not.toBeNull();
			expect('self' in result).toBe(true);
		} finally {
			await session.close();
		}
	});

	it('returns a live DOM node as an opaque preview string, not the live object', async () => {
		const session = await openOnFixture('eval-domnode');
		try {
			// A live host object cannot cross the process boundary; the contract
			// hands back a readable preview string rather than a broken handle. An
			// agent that needs the value reads a serializable property instead.
			const node = await session.page.eval(`document.getElementById('marker')`);
			expect(typeof node).toBe('string');

			expect(
				await session.page.eval(
					`document.getElementById('marker').textContent`,
				),
			).toBe('marker-value');
		} finally {
			await session.close();
		}
	});

	it('rejects when the page expression itself throws', async () => {
		const session = await openOnFixture('eval-throws');
		try {
			await expect(
				session.page.eval(`(function () { throw new Error('boom'); })()`),
			).rejects.toThrow('boom');
		} finally {
			await session.close();
		}
	});
});
