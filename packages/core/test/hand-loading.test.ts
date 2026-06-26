import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	DEFAULT_HOME_DIRNAME,
	HANDS_CONFIG_FILENAME,
	HandLoadError,
	loadHands,
	normalizeConfig,
	PlaywrightLaunchTransport,
	readHandsConfig,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
	type Hand,
	type HandContext,
	type Session,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ECHO_HAND_ENTRY = join(HERE, 'fixtures', 'hands', 'echo-hand.mjs');

/**
 * Phase-2 third-party-hand loading (ADR-0007). Coverage in three layers:
 *
 * 1. CONFIG parsing/validation in isolation: the explicit named-list +
 *    pinned-entry shape, a missing file => empty (install-separate-from-load),
 *    and hard errors on a malformed config.
 * 2. The LOADING mechanism in isolation: only NAMED entries load (an
 *    installed-but-not-named hand never loads), the pinned entry resolves, and a
 *    bad/missing entry is a loud {@link HandLoadError}.
 * 3. END-TO-END through the PUBLIC API at the real `Transport` seam: a fixture
 *    hand authored against the exported `Hand` contract is loaded via the
 *    explicit mechanism and its contributed verb composes into the session
 *    `Page` alongside the built-ins.
 *
 * Shared-write isolation: every config/loading path points at a per-test temp
 * dir; nothing here reads or writes the real `~/.webhands`, and the suite
 * asserts the real home is untouched.
 */

describe('hand config parsing/validation (no filesystem)', () => {
	it('parses an explicit named list with pinned entries', () => {
		const config = normalizeConfig({
			hands: [
				{name: 'captcha', source: 'npm:@acme/captcha-hand', entry: './h.mjs'},
				{name: 'local', entry: '/abs/path/hand.mjs'},
			],
		});
		expect(config.hands).toEqual([
			{name: 'captcha', source: 'npm:@acme/captcha-hand', entry: './h.mjs'},
			{name: 'local', entry: '/abs/path/hand.mjs'},
		]);
	});

	it('treats an absent hands list as empty (load nothing by default)', () => {
		expect(normalizeConfig({}).hands).toEqual([]);
	});

	it('rejects an entry missing its pinned entry point', () => {
		expect(() => normalizeConfig({hands: [{name: 'x'}]})).toThrow(
			/pinned entry point/i,
		);
	});

	it('rejects an entry with no name', () => {
		expect(() => normalizeConfig({hands: [{entry: './h.mjs'}]})).toThrow(
			/name must be a non-empty string/i,
		);
	});

	it('rejects a non-array hands value', () => {
		expect(() => normalizeConfig({hands: 'nope'})).toThrow(
			/'hands' must be an array/i,
		);
	});
});

describe('readHandsConfig (temp home, real ~/.webhands untouched)', () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		while (tempRoots.length > 0) {
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
	});

	async function tempHome(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-hands-cfg-'));
		tempRoots.push(root);
		return root;
	}

	it('returns an empty config when the file is absent', async () => {
		const root = await tempHome();
		expect(await readHandsConfig(root)).toEqual({hands: []});
	});

	it('reads an explicit named list from <home>/hands.json', async () => {
		const root = await tempHome();
		await writeFile(
			join(root, HANDS_CONFIG_FILENAME),
			JSON.stringify({hands: [{name: 'echo', entry: ECHO_HAND_ENTRY}]}),
		);
		const config = await readHandsConfig(root);
		expect(config.hands).toEqual([{name: 'echo', entry: ECHO_HAND_ENTRY}]);
	});

	it('errors on a malformed config file (does not silently treat as empty)', async () => {
		const root = await tempHome();
		await writeFile(join(root, HANDS_CONFIG_FILENAME), '{ not json');
		await expect(readHandsConfig(root)).rejects.toThrow(/not valid JSON/i);
	});

	it('never touches the real ~/.webhands', async () => {
		const realHome = join(homedir(), DEFAULT_HOME_DIRNAME);
		const before = existsSync(realHome);
		const root = await tempHome();
		await readHandsConfig(root);
		expect(existsSync(realHome)).toBe(before);
	});
});

describe('loadHands (explicit + declarative; install-separate-from-load)', () => {
	it('loads ONLY hands named in config (an installed-but-not-named hand does not load)', async () => {
		let installedButUnnamedLoaded = false;
		const importModule = async (specifier: string): Promise<unknown> => {
			// Simulate the dependency tree: the "named" hand resolves; the
			// "installed-but-not-named" one WOULD resolve if asked, but the loader
			// must never ask for it because it is not in the config.
			if (specifier.includes('installed-but-unnamed')) {
				installedButUnnamedLoaded = true;
				return {default: (() => ({verbs: {}})) satisfies Hand};
			}
			const namedHand: Hand = () => ({verbs: {}});
			return {default: namedHand};
		};

		const loaded = await loadHands(
			{hands: [{name: 'named', entry: './named.mjs'}]},
			{baseDir: '/tmp/nonexistent', importModule},
		);

		expect(loaded).toHaveLength(1);
		expect(loaded[0]!.entry.name).toBe('named');
		// The unnamed-but-installed hand was never imported: naming is the trust act.
		expect(installedButUnnamedLoaded).toBe(false);
	});

	it('loads nothing for an empty list', async () => {
		expect(await loadHands({hands: []})).toEqual([]);
	});

	it('resolves a relative pinned entry against baseDir and imports the real module', async () => {
		const loaded = await loadHands(
			{hands: [{name: 'echo', entry: './echo-hand.mjs'}]},
			{baseDir: join(HERE, 'fixtures', 'hands')},
		);
		expect(loaded).toHaveLength(1);
		// The imported default export is the Hand factory.
		const contribution = loaded[0]!.hand({
			pwPage: {} as HandContext['pwPage'],
			context: {} as HandContext['context'],
			ensureOpen: () => {},
		});
		expect(
			typeof (contribution.verbs as Record<string, unknown>).echoTitle,
		).toBe('function');
	});

	it('throws HandLoadError when the pinned entry cannot be imported', async () => {
		await expect(
			loadHands(
				{hands: [{name: 'missing', entry: './does-not-exist.mjs'}]},
				{baseDir: HERE},
			),
		).rejects.toBeInstanceOf(HandLoadError);
	});

	it('throws HandLoadError when the module exports no Hand', async () => {
		const importModule = async (): Promise<unknown> => ({notAHand: 123});
		await expect(
			loadHands(
				{hands: [{name: 'bad', entry: './bad.mjs'}]},
				{baseDir: '/tmp', importModule},
			),
		).rejects.toThrow(/does not export a Hand/i);
	});
});

describe('third-party hand end-to-end through the public API (real browser, fixture)', () => {
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
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
	});

	/** Open a session with the given loaded hands over an isolated profile. */
	async function openWithHands(
		name: string,
		hands: readonly Hand[],
	): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-hands-e2e-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root}, hands);
		const session = await transport.open({mode: 'launch', profile: name});
		return session;
	}

	it('loads a hand via the explicit mechanism and composes its verb into the session Page', async () => {
		// 1. Load through the PUBLIC loading mechanism: an explicit named entry
		//    with a pinned entry point, resolved from an isolated temp config.
		const root = await mkdtemp(join(tmpdir(), 'mbc-hands-cfg-e2e-'));
		tempRoots.push(root);
		await writeFile(
			join(root, HANDS_CONFIG_FILENAME),
			JSON.stringify({
				hands: [
					{name: 'echo', source: 'npm:echo-hand', entry: ECHO_HAND_ENTRY},
				],
			}),
		);
		const config = await readHandsConfig(root);
		const loaded = await loadHands(config, {baseDir: root});
		expect(loaded.map((l) => l.entry.name)).toEqual(['echo']);

		// 2. The loaded hand plugs into the SAME host the built-ins use: open a
		//    real session with it and confirm BOTH a built-in verb and the
		//    third-party verb work against the same live page.
		const session = await openWithHands(
			'echo-profile',
			loaded.map((l) => l.hand),
		);
		try {
			await session.page.navigate(`${server.url}/index.html`);

			// Built-in verb still works (composed alongside the third-party one).
			const snap = await session.page.snapshot();
			expect(snap.url).toBe(`${server.url}/index.html`);

			// The third-party verb (not on the seam type) composed into the page.
			const pageWithEcho = session.page as unknown as {
				echoTitle(): Promise<string>;
			};
			expect(await pageWithEcho.echoTitle()).toBe('webhands fixture');
		} finally {
			await session.close();
		}
	});

	it('does not load a hand that is installed but not named in config', async () => {
		// The config names NOTHING, so even though the echo hand module exists on
		// disk (is "installed"), it never loads and its verb is absent.
		const root = await mkdtemp(join(tmpdir(), 'mbc-hands-unnamed-'));
		tempRoots.push(root);
		await writeFile(
			join(root, HANDS_CONFIG_FILENAME),
			JSON.stringify({hands: []}),
		);
		const loaded = await loadHands(await readHandsConfig(root), {
			baseDir: root,
		});
		expect(loaded).toEqual([]);

		const session = await openWithHands('unnamed-profile', []);
		try {
			await session.page.navigate(`${server.url}/index.html`);
			const pageWithEcho = session.page as unknown as {
				echoTitle?: unknown;
			};
			expect(pageWithEcho.echoTitle).toBeUndefined();
		} finally {
			await session.close();
		}
	});
});
