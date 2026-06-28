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
 * The opt-in durable `query` `ref` (prd `broaden-agent-verb-surface`, R4; task
 * `query-durable-ref-handle`; mechanism settled by the finding
 * `query-ref-mint-mechanism-attribute-beats-weakmap`), exercised at the `core`
 * Driver/Transport seam against a REAL local Playwright (Chromium) browser
 * driving the LOCAL `ref-list.html` FIXTURE (deterministic; never a third-party
 * DOM that rots).
 *
 * The fixture reproduces the exact reconciliation shapes the React/Svelte spike
 * measured, via plain DOM mutations: a prepend (INDEX DRIFT) a positional
 * `.nth(i)` gets wrong; a NODE REPLACEMENT (stale, resolve-to-zero); and a CLONE
 * (ambiguous, resolve-to-many). The tests lock down: the LADDER (reuse a stable
 * unique attribute; verify uniqueness; mint only as fallback); the OPT-IN
 * contract (default `query` writes nothing and returns no ref); `click`/`type`
 * acting on the RIGHT element through a ref after a drift; and the LOUD-stale /
 * LOUD-ambiguous typed `StaleRefError`.
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.webhands`.
 */
describe('query durable ref (real browser, local fixture, seam)', () => {
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

	/** Open a session on the ref-list fixture (isolated, set-up profile). */
	async function openOnFixture(name = 'ref'): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-ref-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/ref-list.html`);
		return session;
	}

	/** The clicklog the fixture appends each clicked row's label to. */
	async function clicklog(session: Session): Promise<string> {
		return (await session.page.eval(
			"document.getElementById('clicklog').textContent",
		)) as string;
	}

	describe('the preference ladder', () => {
		it('REUSES a stable unique attribute (id) as the ref, with ZERO DOM mutation', async () => {
			const session = await openOnFixture('ref-reuse-id');
			try {
				const rows = await session.page.query(
					locator(`page.locator('#buy-charlie')`),
					{refs: true},
				);
				expect(rows).toHaveLength(1);
				// The ref is the element's OWN id wrapped as a locator expression, not
				// a minted attribute.
				expect(rows[0]?.ref).toBe(`p.locator("#buy-charlie")`);
				// ZERO DOM mutation: ladder step 1 never stamps data-webhands-ref.
				const minted = await session.page.eval(
					"document.querySelectorAll('[data-webhands-ref]').length",
				);
				expect(minted).toBe(0);
			} finally {
				await session.close();
			}
		});

		it('MINTS a namespaced data-webhands-ref only for an anonymous element', async () => {
			const session = await openOnFixture('ref-mint-anon');
			try {
				// The Alpha/Bravo/Delta buy buttons are anonymous (no id/testid/name).
				const rows = await session.page.query(
					locator(`page.locator('.result .buy')`),
					{refs: true},
				);
				expect(rows).toHaveLength(4);
				// Charlie's button (3rd) reuses its id; the other three mint.
				const refs = rows.map((r) => r.ref);
				expect(refs[2]).toBe(`p.locator("#buy-charlie")`);
				for (const i of [0, 1, 3]) {
					expect(refs[i]).toMatch(
						/^p\.locator\("\[data-webhands-ref=\\"wr\d+\\"\]"\)$/,
					);
				}
				// Exactly three mints were stamped (one per anonymous element).
				const minted = await session.page.eval(
					"document.querySelectorAll('[data-webhands-ref]').length",
				);
				expect(minted).toBe(3);
			} finally {
				await session.close();
			}
		});

		it('VERIFIES uniqueness: a duplicate data-testid falls through to a mint', async () => {
			const session = await openOnFixture('ref-dupe');
			try {
				// Both #dupes rows carry data-testid="dupe" (NON-unique), so the ref
				// must NOT reuse it — it falls through to a mint.
				const rows = await session.page.query(
					locator(`page.locator('.dupe-row')`),
					{refs: true},
				);
				expect(rows).toHaveLength(2);
				for (const row of rows) {
					expect(row.ref).not.toContain('data-testid');
					expect(row.ref).toMatch(/data-webhands-ref/);
				}
			} finally {
				await session.close();
			}
		});
	});

	describe('opt-in: default query is a pure read', () => {
		it('returns NO ref and writes NOTHING when refs is not requested', async () => {
			const session = await openOnFixture('ref-optin');
			try {
				const rows = await session.page.query(
					locator(`page.locator('.result .buy')`),
					{attrs: ['class']},
				);
				expect(rows).toHaveLength(4);
				for (const row of rows) {
					expect(row.ref).toBeUndefined();
				}
				// No DOM write at all on the default path.
				const minted = await session.page.eval(
					"document.querySelectorAll('[data-webhands-ref]').length",
				);
				expect(minted).toBe(0);
			} finally {
				await session.close();
			}
		});

		it('a fresh refs query SWEEPS the prior query mints (single-query-scoped)', async () => {
			const session = await openOnFixture('ref-sweep');
			try {
				await session.page.query(locator(`page.locator('.result .buy')`), {
					refs: true,
				});
				const afterFirst = (await session.page.eval(
					"document.querySelectorAll('[data-webhands-ref]').length",
				)) as number;
				expect(afterFirst).toBe(3);
				// A second refs query over a SINGLE anonymous element must sweep the
				// prior three mints first, leaving exactly one.
				await session.page.query(
					locator(`page.locator('.result .buy').first()`),
					{
						refs: true,
					},
				);
				const afterSecond = (await session.page.eval(
					"document.querySelectorAll('[data-webhands-ref]').length",
				)) as number;
				expect(afterSecond).toBe(1);
			} finally {
				await session.close();
			}
		});
	});

	describe('acting on a ref survives a drift a .nth() gets wrong', () => {
		it('click --by-ref hits the right row after a prepend reorders the list', async () => {
			const session = await openOnFixture('ref-drift-click');
			try {
				// Read the buy BUTTONS with refs; Charlie's button is at index 2 and
				// reuses its stable id (#buy-charlie).
				const rows = await session.page.query(
					locator(`page.locator('.result .buy')`),
					{refs: true},
				);
				const charlieRef = rows[2]!.ref!;
				expect(charlieRef).toBe(`p.locator("#buy-charlie")`);
				// A NEW row is prepended (index drift): the button now at the old
				// positional index 2 is Bravo's, so a positional .nth(2) would click the
				// WRONG row. The ref must still hit Charlie.
				await session.page.eval('window.__prepend()');
				const atOldIndex = await session.page.eval(
					"document.querySelectorAll('.result')[2].getAttribute('data-name')",
				);
				expect(atOldIndex).toBe('Bravo');
				// Act on the durable ref by-ref -> still Charlie's button.
				await session.page.click(locator(charlieRef), {byRef: true});
				expect(await clicklog(session)).toBe('Charlie;');
			} finally {
				await session.close();
			}
		});

		it('a MINTED ref (anonymous row) survives the same drift', async () => {
			const session = await openOnFixture('ref-drift-mint');
			try {
				// An anonymous Bravo buy button gets a MINTED ref. After a prepend the
				// ref must STILL resolve to Bravo's button, not a positionally-shifted
				// one — the mint rides with the kept node (the spike's move case).
				const rows = await session.page.query(
					locator(`page.locator('.result .buy')`),
					{refs: true},
				);
				// Index 1 is Bravo's anonymous buy button -> a minted ref.
				const bravoRef = rows[1]!.ref!;
				expect(bravoRef).toMatch(/data-webhands-ref/);
				await session.page.eval('window.__prepend()');
				// click --by-ref: the mint resolves to exactly one (Bravo's button) and
				// acts, even though Bravo is no longer at positional index 1.
				await session.page.click(locator(bravoRef), {byRef: true});
				expect(await clicklog(session)).toBe('Bravo;');
			} finally {
				await session.close();
			}
		});
	});

	describe('loud-stale / loud-ambiguous via byRef', () => {
		it('a removed/replaced element fails with a typed StaleRefError (resolve-to-zero)', async () => {
			const session = await openOnFixture('ref-stale-zero');
			try {
				const rows = await session.page.query(
					locator(`page.locator('#buy-charlie')`),
					{refs: true},
				);
				const ref = rows[0]!.ref!;
				// NODE REPLACEMENT: Charlie's row (and its #buy-charlie) is replaced by
				// a fresh node lacking it. The ref now resolves to ZERO.
				await session.page.eval('window.__replaceCharlie()');
				await expect(
					session.page.click(locator(ref), {byRef: true}),
				).rejects.toMatchObject({code: 'stale-ref', matched: 0, verb: 'click'});
			} finally {
				await session.close();
			}
		});

		it('an ambiguous ref (matches >1) fails with a typed StaleRefError (resolve-to-many)', async () => {
			const session = await openOnFixture('ref-stale-many');
			try {
				// Mint a ref on an anonymous Alpha button, then CLONE that minted node
				// so the ref now matches TWO elements.
				const rows = await session.page.query(
					locator(`page.locator('.result').first().locator('button.buy')`),
					{refs: true},
				);
				const ref = rows[0]!.ref!;
				const id = /wr\d+/.exec(ref)?.[0];
				expect(id).toBeDefined();
				const cloned = await session.page.eval(
					`window.__cloneByAttr('data-webhands-ref', '${id}')`,
				);
				expect(cloned).toBe(true);
				let caught: unknown;
				try {
					await session.page.type(locator(ref), 'x', {byRef: true});
				} catch (e) {
					caught = e;
				}
				expect(isControllerError(caught)).toBe(true);
				expect(caught).toBeInstanceOf(StaleRefError);
				expect((caught as StaleRefError).code).toBe('stale-ref');
				expect((caught as StaleRefError).matched).toBe(2);
				expect((caught as StaleRefError).verb).toBe('type');
			} finally {
				await session.close();
			}
		});

		it('byRef on a fresh, still-unique ref acts normally (the happy path)', async () => {
			const session = await openOnFixture('ref-happy');
			try {
				const rows = await session.page.query(
					locator(`page.locator('#buy-charlie')`),
					{refs: true},
				);
				const ref = rows[0]!.ref!;
				// No mutation: the ref still resolves to exactly one -> click acts.
				await session.page.click(locator(ref), {byRef: true});
				expect(await clicklog(session)).toBe('Charlie;');
			} finally {
				await session.close();
			}
		});

		it('a plain locator (no byRef) is UNCHANGED: no stale check is added', async () => {
			const session = await openOnFixture('ref-plain');
			try {
				// byRef is OPT-IN: a plain single-match click still just works, with no
				// ref machinery involved.
				await session.page.click(locator(`page.locator('#buy-charlie')`));
				expect(await clicklog(session)).toBe('Charlie;');
				// And a plain MULTI-match click keeps Playwright's OWN strict-mode error
				// (not our StaleRefError): byRef adds the exactly-one contract, a plain
				// locator's contract is untouched.
				let caught: unknown;
				try {
					await session.page.click(locator(`page.locator('.result .buy')`));
				} catch (e) {
					caught = e;
				}
				expect(caught).toBeInstanceOf(Error);
				expect(isControllerError(caught)).toBe(false);
				expect(String((caught as Error).message)).toContain('strict mode');
			} finally {
				await session.close();
			}
		});
	});
});
