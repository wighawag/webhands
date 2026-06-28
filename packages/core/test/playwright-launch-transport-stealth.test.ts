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
