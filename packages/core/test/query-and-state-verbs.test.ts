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
	type QueryRow,
	type Session,
} from '../src/index.js';

/**
 * The Tier-1 `query` extraction verb and the state shorthands
 * `exists`/`count`/`isVisible`/`getAttribute` (prd
 * `broaden-agent-verb-surface`, R2), exercised at the `core` Driver/Transport
 * seam against a REAL local Playwright (Chromium) browser driving the LOCAL
 * structured-list FIXTURE PAGE (deterministic, never a third-party site whose
 * DOM rots), per the prd "Testing Decisions".
 *
 * Elements are addressed by a RAW Playwright locator string (ADR-0004), passed
 * through `locator(...)` exactly as an agent would emit it. The tests lock down
 * the R2 contract: one row per match carrying EXACTLY the requested fields; the
 * LOUD `attrs` (markup) vs `props` (live JS) split (proved by a checkbox whose
 * attribute and live property DIFFER); `pw:['visible']` actionability-grade
 * visibility (a hidden element reads `false`); `pw:['bbox']` a viewport-pixel
 * box; `limit` bounding the rows; and the absent-element cases for the state
 * verbs (`exists=false`, `count=0`). Values cross by structured clone, the same
 * contract `eval` holds (ADR-0003: no Playwright/CDP type leak).
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.webhands`.
 */
describe('query + state verbs (real browser, local fixture, seam)', () => {
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

	/** Open a session on the query-list fixture (isolated, set-up profile). */
	async function openOnFixture(name = 'query'): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-query-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/query-list.html`);
		return session;
	}

	describe('query', () => {
		it('returns one row per matched element carrying exactly the requested attrs/props', async () => {
			const session = await openOnFixture('query-rows');
			try {
				const rows = await session.page.query(
					locator(`page.locator('.result')`),
					{attrs: ['data-asin'], props: ['innerText']},
				);
				expect(rows).toHaveLength(3);
				// Each row carries ONLY attrs + props (no pw), exactly what was asked.
				expect(rows.map((r) => r.attrs?.['data-asin'])).toEqual([
					'A001',
					'B002',
					'C003',
				]);
				// `innerText` is a LIVE property: it carries the composed text of the
				// row's children (title + price), not a markup attribute.
				expect(rows[0]?.props?.['innerText']).toContain('Alpha Widget');
				expect(rows[0]?.props?.['innerText']).toContain('$10.00');
				// No field beyond the two requested families is present.
				for (const row of rows) {
					expect(Object.keys(row).sort()).toEqual(['attrs', 'props']);
					expect(Object.keys(row.attrs ?? {})).toEqual(['data-asin']);
					expect(Object.keys(row.props ?? {})).toEqual(['innerText']);
					expect(row.pw).toBeUndefined();
				}
			} finally {
				await session.close();
			}
		});

		it('reads an attribute (href) off a nested anchor by locator', async () => {
			const session = await openOnFixture('query-href');
			try {
				const rows = await session.page.query(
					locator(`page.locator('.result .link')`),
					{attrs: ['href']},
				);
				// `href` reflects to the absolute URL on the live property, but as a
				// DOM ATTRIBUTE getAttribute returns the markup value verbatim.
				expect(rows.map((r) => r.attrs?.['href'])).toEqual([
					'/item/A001',
					'/item/B002',
					'/item/C003',
				]);
			} finally {
				await session.close();
			}
		});

		it('attrs reads the markup attribute, props reads the live property (they DIFFER)', async () => {
			const session = await openOnFixture('query-divergence');
			try {
				// The checkbox has NO `checked` attribute in the markup, but a script
				// set the live `checked` property to true after load. The LOUD split
				// must return DIFFERENT values for the same name.
				const rows = await session.page.query(
					locator(`page.locator('#optin')`),
					{attrs: ['checked', 'value'], props: ['checked', 'value', 'type']},
				);
				expect(rows).toHaveLength(1);
				const row = rows[0]!;
				// attrs:['checked'] -> the markup attribute is ABSENT -> null.
				expect(row.attrs?.['checked']).toBeNull();
				// props:['checked'] -> the LIVE property -> true.
				expect(row.props?.['checked']).toBe(true);
				// A present markup attribute reads its string; the live property of the
				// same name agrees here (value="on"), but `type` is a live property.
				expect(row.attrs?.['value']).toBe('on');
				expect(row.props?.['value']).toBe('on');
				expect(row.props?.['type']).toBe('checkbox');
			} finally {
				await session.close();
			}
		});

		it('pw:[visible] is actionability-grade (a hidden element reads not-visible)', async () => {
			const session = await openOnFixture('query-visible');
			try {
				const rows = await session.page.query(
					locator(`page.locator('.sitekey')`),
					{attrs: ['data-sitekey'], pw: ['visible']},
				);
				expect(rows).toHaveLength(2);
				// The hidden element (display:none) reads not-visible; the shown one
				// reads visible. The attribute is readable on BOTH (read != visible).
				const byKey = new Map(
					rows.map((r) => [r.attrs?.['data-sitekey'], r.pw?.visible]),
				);
				expect(byKey.get('sk-hidden-123')).toBe(false);
				expect(byKey.get('sk-shown-456')).toBe(true);
			} finally {
				await session.close();
			}
		});

		it('pw:[bbox] returns a viewport-pixel box {x,y,width,height}', async () => {
			const session = await openOnFixture('query-bbox');
			try {
				const rows = await session.page.query(
					locator(`page.locator('#shown-row')`),
					{pw: ['bbox']},
				);
				expect(rows).toHaveLength(1);
				const bbox = rows[0]?.pw?.bbox;
				expect(bbox).not.toBeNull();
				expect(typeof bbox?.x).toBe('number');
				expect(typeof bbox?.y).toBe('number');
				expect(bbox?.width).toBeGreaterThan(0);
				expect(bbox?.height).toBeGreaterThan(0);
			} finally {
				await session.close();
			}
		});

		it('limit bounds the row count', async () => {
			const session = await openOnFixture('query-limit');
			try {
				const rows = await session.page.query(
					locator(`page.locator('.result')`),
					{attrs: ['data-asin'], limit: 2},
				);
				expect(rows.map((r) => r.attrs?.['data-asin'])).toEqual([
					'A001',
					'B002',
				]);
			} finally {
				await session.close();
			}
		});

		it('with no fields requested, returns one EMPTY row per match', async () => {
			const session = await openOnFixture('query-empty');
			try {
				const rows = await session.page.query(
					locator(`page.locator('.result')`),
				);
				expect(rows).toHaveLength(3);
				for (const row of rows) {
					expect(row).toEqual({});
				}
			} finally {
				await session.close();
			}
		});

		it('returns [] for a locator that matches no element', async () => {
			const session = await openOnFixture('query-absent');
			try {
				const rows: QueryRow[] = await session.page.query(
					locator(`page.locator('.absent')`),
					{attrs: ['data-asin']},
				);
				expect(rows).toEqual([]);
			} finally {
				await session.close();
			}
		});
	});

	describe('count + exists', () => {
		it('count returns the match-set size; exists is count > 0', async () => {
			const session = await openOnFixture('query-count');
			try {
				expect(
					await session.page.count(locator(`page.locator('.result')`)),
				).toBe(3);
				expect(
					await session.page.exists(locator(`page.locator('.result')`)),
				).toBe(true);
			} finally {
				await session.close();
			}
		});

		it('count=0 and exists=false for an absent element', async () => {
			const session = await openOnFixture('query-count-absent');
			try {
				expect(
					await session.page.count(locator(`page.locator('.absent')`)),
				).toBe(0);
				expect(
					await session.page.exists(locator(`page.locator('.absent')`)),
				).toBe(false);
			} finally {
				await session.close();
			}
		});
	});

	describe('isVisible', () => {
		it('is true for a visible element and false for a present-but-hidden one', async () => {
			const session = await openOnFixture('query-isvisible');
			try {
				expect(
					await session.page.isVisible(locator(`page.locator('#shown-row')`)),
				).toBe(true);
				expect(
					await session.page.isVisible(locator(`page.locator('#hidden-row')`)),
				).toBe(false);
			} finally {
				await session.close();
			}
		});

		it('is false for an absent element (no match cannot be visible)', async () => {
			const session = await openOnFixture('query-isvisible-absent');
			try {
				expect(
					await session.page.isVisible(locator(`page.locator('.absent')`)),
				).toBe(false);
			} finally {
				await session.close();
			}
		});
	});

	describe('getAttribute', () => {
		it("reads the first match's attribute, including a hidden element's", async () => {
			const session = await openOnFixture('query-getattr');
			try {
				// `.result` first match is row A001.
				expect(
					await session.page.getAttribute(
						locator(`page.locator('.result')`),
						'data-asin',
					),
				).toBe('A001');
				// A hidden element's attribute is still readable (read != visibility).
				expect(
					await session.page.getAttribute(
						locator(`page.locator('#hidden-row')`),
						'data-sitekey',
					),
				).toBe('sk-hidden-123');
			} finally {
				await session.close();
			}
		});

		it('returns null for an absent attribute and for an absent element', async () => {
			const session = await openOnFixture('query-getattr-absent');
			try {
				// Present element, absent attribute -> null.
				expect(
					await session.page.getAttribute(
						locator(`page.locator('#shown-row')`),
						'data-nope',
					),
				).toBeNull();
				// Absent element -> null (there is no attribute value to read).
				expect(
					await session.page.getAttribute(
						locator(`page.locator('.absent')`),
						'data-asin',
					),
				).toBeNull();
			} finally {
				await session.close();
			}
		});
	});
});
