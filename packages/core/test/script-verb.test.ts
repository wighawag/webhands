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
 * The `script` verb (idea `webhands-execute-script-verb`, ADR-0012), exercised
 * at the `core` Driver/Transport seam against a REAL local Playwright (Chromium)
 * browser driving the LOCAL FIXTURE PAGE (deterministic, never a third-party
 * site whose DOM rots), mirroring the `eval` verb test.
 *
 * `script` is the DRIVER-CONTEXT batch escape hatch: unlike `eval` (a single
 * page-world EXPRESSION via `page.evaluate`), it runs the caller's JS IN-PROCESS
 * and hands it the FULL Playwright `page`, so ONE call can locate + act +
 * auto-wait + read a whole sub-flow. The result is asserted against the
 * fixture's own controlled state, not third-party DOM. The edge cases lock down
 * the seam contract (see `WebHandsPage.script`): the script's RETURN crosses the
 * seam by structured clone (seam-clean: no Playwright type), and a throwing
 * script REJECTS with a plain `Error` (a clean structured error, never a crash).
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.webhands`.
 */
describe('script verb (real browser, local fixture, seam)', () => {
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
	async function openOnFixture(
		name: string,
		page = 'click-type',
	): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-script-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/${page}.html`);
		return session;
	}

	it('drives the page in ONE call: locate + act + read returns a known result', async () => {
		const session = await openOnFixture('script-batch');
		try {
			// The DRIVER-CONTEXT flow the baseline writes by hand: type into the
			// input, click the search button (whose handler writes `clicked` into
			// #status), then READ both the live input value and the resulting status
			// back as a structured result. Real locators + actions + auto-waiting,
			// not a page-world expression.
			const result = await session.page.script(
				`async (page) => {
					await page.fill('#query', 'flights to BOM');
					await page.click('#search');
					return {
						typed: await page.locator('#query').inputValue(),
						status: await page.locator('#status').innerText(),
					};
				}`,
			);
			expect(result).toEqual({
				typed: 'flights to BOM',
				status: 'clicked',
			});
		} finally {
			await session.close();
		}
	});

	it('accepts a sync function of the page and awaits its result', async () => {
		const session = await openOnFixture('script-sync');
		try {
			// A non-async arrow works too: its return is awaited harmlessly.
			expect(await session.page.script(`(page) => page.title()`)).toBe(
				'click + type fixture',
			);
		} finally {
			await session.close();
		}
	});

	it('returns a seam-clean serializable value (no Playwright type leaks)', async () => {
		const session = await openOnFixture('script-seam-clean');
		try {
			// A script that READS through real locators must still return a plain,
			// structured-cloneable value: the load-bearing ADR-0003 boundary on the
			// RETURN (the live `page`/`locator` it drove never crosses).
			const result = await session.page.script(
				`async (page) => {
					const count = await page.locator('button').count();
					return {buttons: count, heading: await page.locator('h1').innerText()};
				}`,
			);
			expect(result).toEqual({buttons: 1, heading: 'Click + Type Fixture'});
			// Proof the value is wire-safe: a Playwright handle would throw here.
			expect(() => structuredClone(result)).not.toThrow();
		} finally {
			await session.close();
		}
	});

	it('rejects with a clean error when the script itself throws', async () => {
		const session = await openOnFixture('script-throws');
		try {
			// A throw inside the driver-context body REJECTS faithfully (the message
			// crosses), never a crash, exactly as `eval` does.
			await expect(
				session.page.script(
					`async (page) => { await page.title(); throw new Error('flow boom'); }`,
				),
			).rejects.toThrow('flow boom');
		} finally {
			await session.close();
		}
	});

	it('rejects loud when the source is not a function of the page', async () => {
		const session = await openOnFixture('script-not-a-fn');
		try {
			// A bare value (not a function) is a caller mistake surfaced loud, not a
			// silent no-op (the repo's loud-over-silent style).
			await expect(session.page.script(`42`)).rejects.toThrow(
				/must evaluate to a function of the page/i,
			);
			// A syntax error in the source is surfaced loud too.
			await expect(session.page.script(`async (page) => {`)).rejects.toThrow(
				/must be JS that evaluates to a function of the page/i,
			);
		} finally {
			await session.close();
		}
	});

	it('runs against the live page in-process (driver context, full Playwright)', async () => {
		const session = await openOnFixture('script-driver-context');
		try {
			// Auto-waiting is the DRIVER-context tell: the delayed fixture renders
			// #late ~150ms after load, so a `waitFor` inside the script blocks until
			// it appears (a page-world `eval` could not auto-wait like this). Proves
			// the script holds the real Playwright `page`, not a page-world handle.
			const session2 = session;
			await session2.page.navigate(`${server.url}/delayed.html`);
			const text = await session2.page.script(
				`async (page) => {
					const late = page.locator('#late');
					await late.waitFor();
					return late.innerText();
				}`,
			);
			expect(text).toBe('late content rendered');
		} finally {
			await session.close();
		}
	});
});
