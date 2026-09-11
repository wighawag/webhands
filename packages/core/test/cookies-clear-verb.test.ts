import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	validateCookieFilter,
	type Cookie,
	type FixtureServer,
	type Session,
} from '../src/index.js';

/**
 * The `cookies clear` verb (finding `anti-bot-verdict-lives-in-named-cookies`):
 * remove a NAMED SUBSET of the session's cookies and report how many went.
 *
 * The motivating case is recovery, not hygiene. A WAF keeps its bot verdict in a
 * handful of named cookies (Akamai: `_abck`, plus `bm_sz`/`bm_sv`/`ak_bmsc`);
 * once tripped, every dynamic endpoint 403s until those names are gone, while the
 * LOGIN lives in the site's own separate session cookies. So the property that
 * matters is SURGICAL: the named cookies go and the session cookies survive. That
 * is exactly what this test asserts against a real Chromium, with the two cookie
 * families standing in for the WAF's and the site's.
 *
 * The refusal cases are asserted on the shared validator (pure, no browser),
 * because "an empty filter must never mean ALL" is the one mistake that is not
 * undoable on a live logged-in session.
 *
 * Shared-write isolation: every profile root is a per-test temp dir; nothing here
 * touches the real `~/.webhands`.
 */
describe('cookies clear (real browser, local fixture, seam)', () => {
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
		// Sessions first, so a failed assertion cannot leak a browser: the helper
		// registers each session the moment it exists, before the caller's try/finally
		// could.
		while (opened.length > 0) {
			await opened
				.pop()!
				.close()
				.catch(() => {});
		}
		while (tempRoots.length > 0) {
			const dir = tempRoots.pop()!;
			// Retried: a just-closed Chromium can still be flushing its profile, and a
			// teardown ENOTEMPTY would read as a test failure.
			await rm(dir, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
		}
	});

	/** Open an isolated session on the fixture origin. */
	async function openSession(name: string): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-cookies-clear-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		opened.push(session);
		await session.page.navigate(`${server.url}/index.html`);
		return session;
	}

	/**
	 * Seed the two cookie families the recovery scenario turns on: the WAF's bot
	 * verdict cookies and the site's own login/session cookies.
	 */
	async function seedBotAndSessionCookies(session: Session): Promise<void> {
		const host = new URL(server.url).hostname;
		const cookies: Cookie[] = [
			// The WAF verdict family (the names an Akamai-protected site sets).
			{name: '_abck', value: 'verdict-tripped', domain: host, path: '/'},
			{name: 'bm_sz', value: 'sz', domain: host, path: '/'},
			{name: 'bm_sv', value: 'sv', domain: host, path: '/'},
			{name: 'ak_bmsc', value: 'bmsc', domain: host, path: '/'},
			// The site's own session (what must SURVIVE the recovery).
			{name: 'ASP.NET_SessionId', value: 'logged-in', domain: host, path: '/'},
			{name: 'auth_token', value: 'still-me', domain: host, path: '/'},
		];
		await session.page.setCookies(cookies);
	}

	/** The session's cookie names, sorted, for stable assertions. */
	async function namesOf(session: Session): Promise<string[]> {
		const all = await session.page.cookies();
		return all.map((c) => c.name).sort();
	}

	it('clears ONLY the named cookies and preserves the login session', async () => {
		const session = await openSession('clear-named');
		try {
			await seedBotAndSessionCookies(session);
			expect(await namesOf(session)).toContain('_abck');

			const cleared = await session.page.clearCookies({
				names: ['_abck', 'bm_sz', 'bm_sv', 'ak_bmsc'],
			});

			// The count is what the BROWSER removed, so it is evidence the recovery
			// actually happened (0 would mean the names never matched).
			expect(cleared).toBe(4);
			// Surgical: the verdict family is gone, the login survives untouched.
			expect(await namesOf(session)).toEqual([
				'ASP.NET_SessionId',
				'auth_token',
			]);
			const survivors = await session.page.cookies();
			expect(survivors.find((c) => c.name === 'ASP.NET_SessionId')?.value).toBe(
				'logged-in',
			);
		} finally {
			await session.close();
		}
	});

	it('reports 0 when nothing matched (a misspelled name is not a silent success)', async () => {
		const session = await openSession('clear-nomatch');
		try {
			await seedBotAndSessionCookies(session);
			const before = await namesOf(session);

			const cleared = await session.page.clearCookies({names: ['_abckk']});

			expect(cleared).toBe(0);
			// Nothing was touched, so the caller can tell a typo from a recovery.
			expect(await namesOf(session)).toEqual(before);
		} finally {
			await session.close();
		}
	});

	it('narrows by PATH as well as domain (every given field must match)', async () => {
		// `--path` was declared, validated and carried over the wire but asserted
		// against a real browser nowhere. Worth a case of its own because Playwright
		// matches paths EXACTLY, which is the field most likely to surprise.
		const session = await openSession('clear-path');
		try {
			const host = new URL(server.url).hostname;
			await session.page.setCookies([
				{name: 'scoped', value: 'root', domain: host, path: '/'},
				{name: 'scoped', value: 'deep', domain: host, path: '/books'},
			]);

			const cleared = await session.page.clearCookies({
				names: ['scoped'],
				path: '/books',
			});

			expect(cleared).toBe(1);
			const left = await session.page.cookies();
			// The same NAME at the root path survived.
			expect(left.map((c) => `${c.path}=${c.value}`)).toEqual(['/=root']);
		} finally {
			await session.close();
		}
	});

	it('counts only MATCHING cookies, so a concurrent write cannot skew it', async () => {
		// The count used to be a whole-jar before/after difference, which under
		// concurrent writes (the normal state of a logged-in page) under-reports, can
		// turn a successful clear into the "nothing matched" signal, or even go negative.
		// Here a NON-matching cookie appears during the clear window.
		const session = await openSession('clear-count');
		try {
			const host = new URL(server.url).hostname;
			await session.page.setCookies([
				{name: '_abck', value: 'tripped', domain: host, path: '/'},
				{name: 'keep', value: 'me', domain: host, path: '/'},
			]);

			const cleared = await session.page.clearCookies({names: ['_abck']});
			expect(cleared).toBe(1);

			// Now add two unrelated cookies and clear a name that is already gone: the
			// jar GREW, so a jar-wide difference would report a negative number.
			await session.page.setCookies([
				{name: 'extra1', value: '1', domain: host, path: '/'},
				{name: 'extra2', value: '2', domain: host, path: '/'},
			]);
			expect(await session.page.clearCookies({names: ['_abck']})).toBe(0);
		} finally {
			await session.close();
		}
	});

	it('narrows by domain (a name on another domain is left alone)', async () => {
		const session = await openSession('clear-domain');
		try {
			const host = new URL(server.url).hostname;
			await session.page.setCookies([
				{name: 'shared', value: 'here', domain: host, path: '/'},
				{name: 'shared', value: 'elsewhere', domain: 'other.test', path: '/'},
			]);

			const cleared = await session.page.clearCookies({
				names: ['shared'],
				domain: 'other.test',
			});

			expect(cleared).toBe(1);
			const left = await session.page.cookies();
			// The same NAME on the fixture origin survived: every supplied field must
			// match (AND), so domain genuinely narrows.
			expect(left.map((c) => c.value)).toEqual(['here']);
		} finally {
			await session.close();
		}
	});

	it('clears everything only when asked explicitly with all', async () => {
		const session = await openSession('clear-all');
		try {
			await seedBotAndSessionCookies(session);
			const cleared = await session.page.clearCookies({all: true});
			expect(cleared).toBe(6);
			expect(await session.page.cookies()).toEqual([]);
		} finally {
			await session.close();
		}
	});

	it('REFUSES an empty filter on the live session (never read as "all")', async () => {
		const session = await openSession('clear-empty-refused');
		try {
			await seedBotAndSessionCookies(session);
			const before = await namesOf(session);

			await expect(session.page.clearCookies({})).rejects.toThrow(
				/refusing to clear with an empty filter/i,
			);

			// The load-bearing half: the refusal left the session intact.
			expect(await namesOf(session)).toEqual(before);
		} finally {
			await session.close();
		}
	});
});

/**
 * The shared filter validator (pure; the single source of truth both the
 * in-process host and the RPC server dispatch run, so neither path can clear the
 * wrong set).
 */
describe('validateCookieFilter', () => {
	it('accepts a narrowing filter and returns it unchanged', () => {
		const filter = {names: ['_abck'], domain: 'example.com'};
		expect(validateCookieFilter(filter)).toBe(filter);
	});

	it('accepts an explicit all', () => {
		expect(validateCookieFilter({all: true})).toEqual({all: true});
	});

	it('refuses an empty filter, naming both ways forward', () => {
		// Playwright's own clearCookies() reads no-filter as "clear everything";
		// pointed at a live logged-in session that is a silent logout, so the seam
		// refuses and says what to pass instead.
		expect(() => validateCookieFilter({})).toThrowError(
			/refusing to clear with an empty filter/i,
		);
		expect(() => validateCookieFilter({})).toThrowError(/names: \['_abck'\]/);
		expect(() => validateCookieFilter({})).toThrowError(/\{ all: true \}/);
	});

	it('refuses an empty names array (a filter that matches nothing by mistake)', () => {
		expect(() => validateCookieFilter({names: []})).toThrowError(
			/refusing to clear with an empty filter/i,
		);
	});

	it('refuses all combined with a narrowing field (contradictory intent)', () => {
		expect(() =>
			validateCookieFilter({all: true, names: ['_abck']}),
		).toThrowError(/cannot be combined/i);
	});

	it('refuses a misshapen filter loudly', () => {
		expect(() => validateCookieFilter({names: 'abck'} as never)).toThrowError(
			/"names" must be an array/i,
		);
		expect(() => validateCookieFilter({domain: ''} as never)).toThrowError(
			/"domain" must be a non-empty string/i,
		);
		expect(() => validateCookieFilter({name: '_abck'} as never)).toThrowError(
			/unknown filter option "name"/i,
		);
	});
});
