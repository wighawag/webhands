import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
	DEFAULT_HOME_DIRNAME,
	isControllerError,
	MissingProfileError,
	MissingStealthDependencyError,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	type StealthChromiumImporter,
} from '../src/index.js';

/**
 * HERMETIC stealth-launch tests: NO real browser, NO real Patchright, NO
 * network. The Patchright import is injected via the transport's internal
 * dynamic-import seam (`importStealthChromium`), and the launch is a spy, so
 * these assert the launcher WIRING (which engine, which options) without
 * spawning anything. The live/real-WAF behaviour is manual by nature and is
 * deliberately NOT tested here (CI stays hermetic).
 *
 * Shared-write isolation mirrors the real-browser transport tests: every
 * profile root is a per-test temp dir and the real `~/.webhands` is asserted
 * untouched.
 */
describe('PlaywrightLaunchTransport stealth opt-in (hermetic)', () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		while (tempRoots.length > 0) {
			const dir = tempRoots.pop()!;
			await rm(dir, {recursive: true, force: true});
		}
	});

	/** Make an isolated controller-home temp root with a set-up profile in it. */
	async function makeSetUpProfile(name = 'default'): Promise<{root: string}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-stealth-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		return {root};
	}

	/** A fake `launchPersistentContext` result good enough for `open`'s use. */
	function fakeContext() {
		const page = {} as never;
		return {
			pages: () => [page],
			newPage: async () => page,
			on: () => {},
			// `open` builds a Session via composeWithHands which only reads
			// pwPage/context lazily inside verbs; we never invoke a verb here, so a
			// minimal object suffices and no browser is touched.
		} as never;
	}

	it('does NOT consult the stealth importer when stealth is disabled (default)', async () => {
		const {root} = await makeSetUpProfile('vanilla');
		const importSpy = vi.fn<StealthChromiumImporter>();

		// Default options => vanilla path. Point at a MISSING profile so `open`
		// rejects at the profile guard BEFORE any real browser launch, keeping the
		// test hermetic while still proving the stealth seam is never entered.
		const transport = new PlaywrightLaunchTransport({root}, [], {
			importStealthChromium: importSpy,
		});

		const err = await transport
			.open({mode: 'launch', profile: 'never-set-up'})
			.then(
				() => {
					throw new Error('expected open to reject');
				},
				(e: unknown) => e,
			);

		expect(err).toBeInstanceOf(MissingProfileError);
		// Stealth disabled => the Patchright importer must never be called.
		expect(importSpy).not.toHaveBeenCalled();
	});

	it('launches via the injected stealth chromium (not vanilla) with systemBrowser + headless forwarded', async () => {
		const {root} = await makeSetUpProfile('stealthy');

		const launchSpy = vi.fn(async () => fakeContext());
		const importStealthChromium: StealthChromiumImporter = async () => ({
			chromium: {launchPersistentContext: launchSpy as never},
		});

		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			systemBrowser: 'chrome',
			importStealthChromium,
		});

		// headed: true => headless: false must be forwarded.
		const session = await transport.open({
			mode: 'launch',
			profile: 'stealthy',
			headed: true,
		});

		expect(launchSpy).toHaveBeenCalledTimes(1);
		const [profileDir, options] = launchSpy.mock.calls[0]!;
		expect(profileDir).toContain('stealthy');
		// systemBrowser maps to Playwright's `channel` on the actual launch call.
		expect(options).toMatchObject({
			headless: false,
			channel: 'chrome',
		});
		// Automation-flavoured default args are dropped for stealth.
		expect(
			(options as {ignoreDefaultArgs?: unknown}).ignoreDefaultArgs,
		).toEqual(['--enable-automation']);

		void session; // no verbs invoked; nothing real to close.
	});

	it('defaults noViewport to TRUE under stealth (viewport: null) and is overridable', async () => {
		// Stealth on, noViewport unset => Patchright recipe default: viewport null.
		{
			const {root} = await makeSetUpProfile('stealth-noviewport-default');
			const launchSpy = vi.fn(async () => fakeContext());
			const transport = new PlaywrightLaunchTransport({root}, [], {
				stealth: true,
				importStealthChromium: async () => ({
					chromium: {launchPersistentContext: launchSpy as never},
				}),
			});
			await transport.open({
				mode: 'launch',
				profile: 'stealth-noviewport-default',
			});
			const [, options] = launchSpy.mock.calls[0]!;
			expect((options as {viewport?: unknown}).viewport).toBeNull();
		}

		// Stealth on, noViewport explicitly false => fixed viewport kept (no null).
		{
			const {root} = await makeSetUpProfile('stealth-noviewport-off');
			const launchSpy = vi.fn(async () => fakeContext());
			const transport = new PlaywrightLaunchTransport({root}, [], {
				stealth: true,
				noViewport: false,
				importStealthChromium: async () => ({
					chromium: {launchPersistentContext: launchSpy as never},
				}),
			});
			await transport.open({mode: 'launch', profile: 'stealth-noviewport-off'});
			const [, options] = launchSpy.mock.calls[0]!;
			expect('viewport' in (options as object)).toBe(false);
		}
	});

	it('forwards headless: true by default (no headed flag) on the stealth path', async () => {
		const {root} = await makeSetUpProfile('stealth-headless');

		const launchSpy = vi.fn(async () => fakeContext());
		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			importStealthChromium: async () => ({
				chromium: {launchPersistentContext: launchSpy as never},
			}),
		});

		await transport.open({mode: 'launch', profile: 'stealth-headless'});

		const [, options] = launchSpy.mock.calls[0]!;
		expect((options as {headless?: boolean}).headless).toBe(true);
		// No systemBrowser configured => no Playwright channel passed.
		expect((options as {channel?: unknown}).channel).toBeUndefined();
	});

	it('sets viewport: null when noViewport=true is opted in explicitly', async () => {
		// noViewport is a generic hardening knob. We exercise launchOptions
		// construction hermetically through the stealth launch SPY (the SAME
		// launchOptions object is built for vanilla and stealth alike).
		const {root} = await makeSetUpProfile('noviewport-explicit');
		const launchSpy = vi.fn(async () => fakeContext());
		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			noViewport: true,
			importStealthChromium: async () => ({
				chromium: {launchPersistentContext: launchSpy as never},
			}),
		});
		await transport.open({mode: 'launch', profile: 'noviewport-explicit'});
		const [, options] = launchSpy.mock.calls[0]!;
		expect((options as {viewport?: unknown}).viewport).toBeNull();
	});

	it('preserves current behavior when noViewport is unset and sets no UA/locale/timezone/headers by default', async () => {
		// noViewport explicitly false reproduces the "unset, no-viewport-default"
		// launchOptions (`this.#noViewport ?? this.#stealth` => false): no viewport
		// override is added. Crucially we ALSO assert the transport never sets
		// user-agent/locale/timezone/headers by default (Patchright warns a wrong UA
		// is a bigger tell than none).
		const {root} = await makeSetUpProfile('viewport-default');
		const launchSpy = vi.fn(async () => fakeContext());
		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			noViewport: false,
			importStealthChromium: async () => ({
				chromium: {launchPersistentContext: launchSpy as never},
			}),
		});
		await transport.open({mode: 'launch', profile: 'viewport-default'});
		const [, options] = launchSpy.mock.calls[0]!;
		// noViewport:false => no viewport key at all (Playwright default preserved).
		expect('viewport' in (options as object)).toBe(false);
		// No args were requested => no args key (only the hardening escape hatch sets it).
		expect('args' in (options as object)).toBe(false);
		// We never set user-agent/locale/timezone/headers by default.
		for (const key of [
			'userAgent',
			'locale',
			'timezoneId',
			'extraHTTPHeaders',
		]) {
			expect(key in (options as object)).toBe(false);
		}
	});

	it('forwards extraLaunchArgs verbatim to launchOptions.args', async () => {
		const {root} = await makeSetUpProfile('extra-args');
		const launchSpy = vi.fn(async () => fakeContext());
		const args = ['--disable-blink-features=AutomationControlled', '--foo'];
		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			extraLaunchArgs: args,
			importStealthChromium: async () => ({
				chromium: {launchPersistentContext: launchSpy as never},
			}),
		});
		await transport.open({mode: 'launch', profile: 'extra-args'});
		const [, options] = launchSpy.mock.calls[0]!;
		expect((options as {args?: unknown}).args).toEqual(args);
	});

	it('passes ignoreDefaultArgs through (boolean true) overriding the stealth default', async () => {
		const {root} = await makeSetUpProfile('ignore-all');
		const launchSpy = vi.fn(async () => fakeContext());
		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			ignoreDefaultArgs: true,
			importStealthChromium: async () => ({
				chromium: {launchPersistentContext: launchSpy as never},
			}),
		});
		await transport.open({mode: 'launch', profile: 'ignore-all'});
		const [, options] = launchSpy.mock.calls[0]!;
		// The explicit passthrough REPLACES the built-in ['--enable-automation'].
		expect((options as {ignoreDefaultArgs?: unknown}).ignoreDefaultArgs).toBe(
			true,
		);
	});

	it('passes ignoreDefaultArgs through (explicit list) as given', async () => {
		const {root} = await makeSetUpProfile('ignore-list');
		const launchSpy = vi.fn(async () => fakeContext());
		const drop = [
			'--enable-automation',
			'--enable-blink-features=IdleDetection',
		];
		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			ignoreDefaultArgs: drop,
			importStealthChromium: async () => ({
				chromium: {launchPersistentContext: launchSpy as never},
			}),
		});
		await transport.open({mode: 'launch', profile: 'ignore-list'});
		const [, options] = launchSpy.mock.calls[0]!;
		expect(
			(options as {ignoreDefaultArgs?: unknown}).ignoreDefaultArgs,
		).toEqual(drop);
	});

	it('throws a typed MissingStealthDependencyError when patchright is not importable (no fallback)', async () => {
		const {root} = await makeSetUpProfile('needs-patchright');

		// Simulate `await import('patchright')` failing (package not installed).
		const importStealthChromium: StealthChromiumImporter = async () => {
			throw Object.assign(new Error("Cannot find package 'patchright'"), {
				code: 'ERR_MODULE_NOT_FOUND',
			});
		};

		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			importStealthChromium,
		});

		const err = await transport
			.open({mode: 'launch', profile: 'needs-patchright'})
			.then(
				() => {
					throw new Error('expected open to reject');
				},
				(e: unknown) => e,
			);

		expect(err).toBeInstanceOf(MissingStealthDependencyError);
		expect(isControllerError(err)).toBe(true);
		expect((err as MissingStealthDependencyError).code).toBe(
			'missing-stealth-dependency',
		);
		expect((err as MissingStealthDependencyError).dependency).toBe(
			'patchright',
		);
		expect((err as MissingStealthDependencyError).message).toMatch(
			/pnpm add patchright/,
		);
		// The original import failure is preserved as the cause.
		expect((err as MissingStealthDependencyError).cause).toBeInstanceOf(Error);
	});

	it('throws MissingStealthDependencyError when the stealth module lacks a usable chromium', async () => {
		const {root} = await makeSetUpProfile('bad-module');

		// Import resolves but to a module without a launchPersistentContext.
		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			importStealthChromium: async () => ({}) as never,
		});

		await expect(
			transport.open({mode: 'launch', profile: 'bad-module'}),
		).rejects.toBeInstanceOf(MissingStealthDependencyError);
	});

	it('leaves the real ~/.webhands location UNTOUCHED across stealth opens', async () => {
		const realHome = join(homedir(), DEFAULT_HOME_DIRNAME);
		const before = existsSync(realHome);

		const {root} = await makeSetUpProfile('isolation');

		const transport = new PlaywrightLaunchTransport({root}, [], {
			stealth: true,
			importStealthChromium: async () => ({
				chromium: {launchPersistentContext: async () => fakeContext()},
			}),
		});
		await transport.open({mode: 'launch', profile: 'isolation'});

		const after = existsSync(realHome);
		expect(after).toBe(before);
		if (before) {
			const leaked = existsSync(join(realHome, 'profiles', 'isolation'));
			expect(leaked).toBe(false);
		}
	});
});

describe('MissingStealthDependencyError (typed condition shape)', () => {
	it('is an identifiable controller error with the missing-stealth-dependency code', () => {
		const err = new MissingStealthDependencyError();
		expect(err).toBeInstanceOf(MissingStealthDependencyError);
		expect(isControllerError(err)).toBe(true);
		expect(err.code).toBe('missing-stealth-dependency');
		expect(err.dependency).toBe('patchright');
	});
});
