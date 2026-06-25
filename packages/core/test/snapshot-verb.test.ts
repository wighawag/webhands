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
 * The `snapshot` verb, exercised at the `core` Driver/Transport seam against a
 * REAL local Playwright (Chromium) browser driving the LOCAL FIXTURE PAGE
 * (deterministic, never a third-party site whose DOM rots). We assert the
 * snapshot SHAPE (roles/names/text present; refs present and stable;
 * `--full` returns raw DOM), per the PRD "Testing Decisions".
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here ever touches the real `~/.my-browser-controller`.
 */
describe('snapshot verb (real browser, local fixture, seam)', () => {
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

	/** Open a session against an isolated, set-up profile on the fixture page. */
	async function openOnFixture(name = 'snap'): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-snap-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(server.url);
		return session;
	}

	it('returns the accessibility-tree + visible-text view by default (not raw HTML)', async () => {
		const session = await openOnFixture();
		try {
			const snap = await session.page.snapshot();

			expect(snap.view).toBe('accessibility');
			expect(snap.url).toBe(`${server.url}/`);

			// Roles + accessible names + visible text are present...
			expect(snap.content).toContain('heading "Fixture Page"');
			expect(snap.content).toContain('textbox "Query"');
			expect(snap.content).toContain('button "Search"');
			expect(snap.content).toContain('ready'); // the <p id="status"> text

			// ...and it is NOT raw HTML (the cheap structured view, not markup).
			expect(snap.content).not.toContain('<button');
			expect(snap.content).not.toContain('<!doctype');
		} finally {
			await session.close();
		}
	});

	it('carries stable element refs (re-snapshotting an unchanged page yields the same refs)', async () => {
		const session = await openOnFixture('snap-refs');
		try {
			const first = await session.page.snapshot();
			const second = await session.page.snapshot();

			// Refs are present in the cheap view (the `[ref=...]` convention).
			expect(first.content).toMatch(/\[ref=[^\]]+\]/);

			// The page did not change between snapshots, so the refs are stable:
			// re-snapshotting yields the identical structured view.
			expect(second.content).toBe(first.content);

			// And the specific refs assigned to known elements match across snaps.
			const buttonRef = (content: string) =>
				content
					.split('\n')
					.find((line) => line.includes('button "Search"'))
					?.match(/\[ref=([^\]]+)\]/)?.[1];
			expect(buttonRef(first.content)).toBeDefined();
			expect(buttonRef(second.content)).toBe(buttonRef(first.content));
		} finally {
			await session.close();
		}
	});

	it('returns the raw DOM under {full: true}', async () => {
		const session = await openOnFixture('snap-full');
		try {
			const snap = await session.page.snapshot({full: true});

			expect(snap.view).toBe('full');
			expect(snap.url).toBe(`${server.url}/`);

			// Raw DOM: real HTML markup is present (the serialized live document).
			expect(snap.content).toContain('<html');
			expect(snap.content).toContain('<button');
			expect(snap.content).toContain('id="search"');
			expect(snap.content).toContain('Fixture Page');
		} finally {
			await session.close();
		}
	});

	it('the default view is cheaper than the raw DOM for the same page', async () => {
		const session = await openOnFixture('snap-cheap');
		try {
			const cheap = await session.page.snapshot();
			const full = await session.page.snapshot({full: true});

			// The token-cheap structured view should be smaller than raw markup.
			expect(cheap.content.length).toBeLessThan(full.content.length);
		} finally {
			await session.close();
		}
	});
});
