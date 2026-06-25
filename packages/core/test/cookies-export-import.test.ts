import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	COOKIES_EXPORT_VERSION,
	deserializeCookies,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	serializeCookies,
	startFixtureServer,
	type Cookie,
	type FixtureServer,
} from '../src/index.js';

/**
 * The `cookies export` / `cookies import` round-trip (PRD story 11), asserted at
 * the `core` Driver/Transport seam against the local fixture page (deterministic,
 * never a third-party site). The verb is built on the seam's existing
 * `cookies()` (export source) and `setCookies()` (import sink); this test drives
 * a REAL local Chromium and proves the round-trip: export the active context's
 * cookies, write them to the TEST'S OWN temp dir, then import them into a FRESH
 * context and observe them restored.
 *
 * Shared-write isolation: every profile root AND every export file lives under a
 * per-test temp dir; nothing here touches the real `~/.my-browser-controller`
 * or any shared/global location.
 */
describe('cookies export/import round-trip (real browser, local fixture)', () => {
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

	/** Make an isolated controller-home temp root and a set-up profile in it. */
	async function makeSetUpProfile(
		name: string,
	): Promise<{root: string; transport: PlaywrightLaunchTransport}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-cookies-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		return {root, transport: new PlaywrightLaunchTransport({root})};
	}

	it('exports the active context cookies and re-imports them into a fresh context', async () => {
		// A throwaway dir the EXPORT FILE lives in (its own temp dir, never a
		// shared/global location).
		const exportDir = await mkdtemp(join(tmpdir(), 'mbc-cookies-file-'));
		tempRoots.push(exportDir);
		const exportFile = join(exportDir, 'session.json');

		// --- Context A: visit the fixture (which SETS cookies) and EXPORT. ---
		const {transport: a} = await makeSetUpProfile('source');
		const source = await a.open({mode: 'launch', profile: 'source'});
		let exported: readonly Cookie[];
		try {
			await source.page.navigate(`${server.url}/cookies.html`);
			// `cookies export`: read the active context's cookies through the seam.
			exported = await source.page.cookies();
			// The fixture set two cookies via document.cookie; export sees them.
			const names = exported.map((c) => c.name).sort();
			expect(names).toEqual(['mbc_pref', 'mbc_session']);

			// Write the export file (the verb's serialization) into the test's dir.
			await writeFile(exportFile, serializeCookies(exported), 'utf8');
		} finally {
			await source.close();
		}

		// The export file is the documented, self-describing envelope.
		const onDisk = JSON.parse(await readFile(exportFile, 'utf8')) as {
			version: number;
		};
		expect(onDisk.version).toBe(COOKIES_EXPORT_VERSION);

		// --- Context B: a FRESH, separate profile with NO cookies yet. ---
		const {transport: b} = await makeSetUpProfile('target');
		const fresh = await b.open({mode: 'launch', profile: 'target'});
		try {
			// Visit a non-cookie page so the fresh context shares the fixture origin
			// but has none of the source's cookies of its own.
			await fresh.page.navigate(`${server.url}/index.html`);
			const before = await fresh.page.cookies();
			expect(before.map((c) => c.name)).not.toContain('mbc_session');

			// `cookies import`: read the export file back and load into this context.
			const toImport = deserializeCookies(await readFile(exportFile, 'utf8'));
			await fresh.page.setCookies(toImport);

			// The round-trip is restored: the fresh context now has both cookies.
			const after = await fresh.page.cookies();
			const session = after.find((c) => c.name === 'mbc_session');
			const pref = after.find((c) => c.name === 'mbc_pref');
			expect(session?.value).toBe('session-value-123');
			expect(pref?.value).toBe('dark-mode');
		} finally {
			await fresh.close();
		}
	});

	it('rejects an export file with an unknown version (clear import error)', () => {
		const bad = JSON.stringify({version: 999, cookies: []});
		expect(() => deserializeCookies(bad)).toThrow(/unsupported export version/);
	});

	it('rejects a non-envelope export file rather than importing nothing silently', () => {
		// Not JSON at all.
		expect(() => deserializeCookies('not json')).toThrow(/not valid JSON/);
		// JSON, but not an object (a bare primitive).
		expect(() => deserializeCookies('42')).toThrow(
			/not a cookies export envelope/,
		);
		// Right version, but no cookies array.
		expect(() => deserializeCookies(JSON.stringify({version: 1}))).toThrow(
			/no cookies array/,
		);
	});

	it('round-trips the cookie fields through serialize -> deserialize', () => {
		const cookies: readonly Cookie[] = [
			{
				name: 'sid',
				value: 'abc',
				domain: '127.0.0.1',
				path: '/',
				expires: 1_900_000_000,
				httpOnly: true,
				secure: false,
				sameSite: 'Lax',
			},
		];
		const restored = deserializeCookies(serializeCookies(cookies));
		expect(restored).toEqual(cookies);
	});
});
