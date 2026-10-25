import {EventEmitter} from 'node:events';
import {existsSync} from 'node:fs';
import {chmod, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {afterEach, describe, expect, it} from 'vitest';
import {
	DEFAULT_HOME_DIRNAME,
	MissingBrowserBinaryError,
	MissingDisplayError,
	ProxyAuthUnsupportedError,
	RealChromeNotFoundError,
	REAL_CHROME_ENV,
	buildSetupProfileArgs,
	resolveProfileLocation,
	setupProfile,
	type SpawnBrowser,
} from '../src/index.js';
import {CI_SANDBOX_ARGS, testChromeExecutable} from './spawn-test-chrome.js';

/**
 * `setup-profile` tests.
 *
 * The contract under test is that the login window is a PLAIN browser process,
 * not one under automation: no remote-debugging port or pipe, no
 * `--enable-automation`, none of Playwright's defaults (finding
 * `cloudflare-turnstile-refuses-any-browser-with-a-debugging-port`). Most cases
 * use an injected spawner or a tiny shell script standing in for the browser, so
 * the argv and the wait-for-exit behaviour are asserted without a real browser.
 * One case starts the REAL bundled Chromium and has its page report
 * `navigator.webdriver` back over HTTP, which is the property that matters.
 *
 * Shared-write isolation: every run points its profile root at a per-test temp
 * dir; nothing here ever touches the real `~/.webhands`.
 */

/** Switches that make a browser automated, or that Playwright adds by default. */
const AUTOMATION_FLAG =
	/^--(remote-debugging-(port|pipe|address)|enable-automation|disable-blink-features=AutomationControlled|disable-component-update|disable-default-apps|disable-extensions|disable-sync|headless)/;

const tempRoots: string[] = [];

afterEach(async () => {
	while (tempRoots.length > 0) {
		await rm(tempRoots.pop()!, {recursive: true, force: true});
	}
});

async function makeTempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'mbc-setup-'));
	tempRoots.push(root);
	return root;
}

/** A display-bearing env, so the up-front display check passes regardless of host. */
const DISPLAY_ENV = {PATH: process.env.PATH ?? '', DISPLAY: ':0'};

/** A fake browser process: records argv, exits when the test says so. */
function fakeSpawner(): {
	spawn: SpawnBrowser;
	calls: {exe: string; args: readonly string[]}[];
	exit: (code: number | null, signal?: NodeJS.Signals | null) => void;
	stderr: PassThrough;
} {
	const calls: {exe: string; args: readonly string[]}[] = [];
	const child = new EventEmitter() as EventEmitter & {
		pid: number;
		stderr: PassThrough;
	};
	child.pid = 4242;
	child.stderr = new PassThrough();
	return {
		calls,
		stderr: child.stderr,
		spawn: (exe, args) => {
			calls.push({exe, args});
			return child as never;
		},
		exit: (code, signal = null) => {
			child.stderr.end();
			child.emit('exit', code, signal);
		},
	};
}

/**
 * A stand-in browser executable: a shell script that writes its argv, one per
 * line, to `$ARGV_OUT` and exits at once (a human closing the window instantly).
 */
async function argvRecorder(root: string): Promise<{
	exe: string;
	out: string;
}> {
	const exe = join(root, 'fake-browser');
	const out = join(root, 'argv.txt');
	await writeFile(exe, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$ARGV_OUT"\n');
	await chmod(exe, 0o755);
	return {exe, out};
}

describe('setupProfile: a plain, un-automated browser', () => {
	it('spawns ONLY user-data-dir, no-first-run, no-default-browser-check and the URL', async () => {
		const root = await makeTempRoot();
		const fake = fakeSpawner();
		const {browser, location} = await setupProfile({
			profile: 'default',
			root,
			url: 'https://example.test/login',
			executablePath: '/opt/chromium/chrome',
			env: DISPLAY_ENV,
			platform: 'linux',
			spawnBrowser: fake.spawn,
			onPrompt: () => {},
		});

		expect(fake.calls).toHaveLength(1);
		const {exe, args} = fake.calls[0]!;
		expect(exe).toBe('/opt/chromium/chrome');
		expect(args).toEqual([
			`--user-data-dir=${location.profileDir}`,
			'--no-first-run',
			'--no-default-browser-check',
			'https://example.test/login',
		]);
		// The point of the whole change, stated directly.
		expect(args.some((a) => /remote-debugging/.test(a))).toBe(false);
		expect(args).not.toContain('--enable-automation');
		expect(args.filter((a) => AUTOMATION_FLAG.test(a))).toEqual([]);
		expect(browser.args).toEqual(args);

		fake.exit(0);
		await expect(browser.waitForExit()).resolves.toEqual({
			code: 0,
			signal: null,
		});
	});

	it('defaults the start URL to about:blank', () => {
		expect(buildSetupProfileArgs({userDataDir: '/p', env: {}})).toEqual([
			'--user-data-dir=/p',
			'--no-first-run',
			'--no-default-browser-check',
			'about:blank',
		]);
	});

	it('adds proxy routing (not automation) when asked, and refuses credentials', () => {
		const args = buildSetupProfileArgs({
			userDataDir: '/p',
			proxy: 'socks5h://127.0.0.1:1080',
			env: {},
		});
		expect(args).toContain('--proxy-server=socks5://127.0.0.1:1080');
		expect(args.at(-1)).toBe('about:blank');
		expect(args.filter((a) => AUTOMATION_FLAG.test(a))).toEqual([]);
		expect(() =>
			buildSetupProfileArgs({
				userDataDir: '/p',
				proxy: 'socks5h://u:p@127.0.0.1:1080',
				env: {},
			}),
		).toThrow(ProxyAuthUnsupportedError);
	});

	it('honours the operator escape hatch WEBHANDS_CHROME_ARGS (e.g. --no-sandbox), before the URL', () => {
		const args = buildSetupProfileArgs({
			userDataDir: '/p',
			url: 'https://x.test/',
			env: {WEBHANDS_CHROME_ARGS: '--no-sandbox --disable-dev-shm-usage'},
		});
		expect(args.slice(-3)).toEqual([
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'https://x.test/',
		]);
	});

	it('blocks until the process exits, really spawning it', async () => {
		const root = await makeTempRoot();
		const {exe, out} = await argvRecorder(root);
		const {browser, location} = await setupProfile({
			profile: 'real-spawn',
			root,
			executablePath: exe,
			env: {...DISPLAY_ENV, ARGV_OUT: out},
			platform: 'linux',
			onPrompt: () => {},
		});
		await expect(browser.waitForExit()).resolves.toMatchObject({code: 0});
		const argv = (await readFile(out, 'utf8')).trim().split('\n');
		expect(argv).toEqual([
			`--user-data-dir=${location.profileDir}`,
			'--no-first-run',
			'--no-default-browser-check',
			'about:blank',
		]);
	});

	it('rejects a crashing browser instead of reporting the profile saved', async () => {
		const root = await makeTempRoot();
		const fake = fakeSpawner();
		const {browser} = await setupProfile({
			profile: 'crash',
			root,
			executablePath: '/x/chrome',
			env: DISPLAY_ENV,
			platform: 'linux',
			spawnBrowser: fake.spawn,
			onPrompt: () => {},
		});
		fake.exit(null, 'SIGABRT');
		await expect(browser.waitForExit()).rejects.toMatchObject({
			code: 'real-chrome-start-failed',
		});
	});

	it('maps Chromium\'s "Missing X server" exit to missing-display', async () => {
		const root = await makeTempRoot();
		const fake = fakeSpawner();
		const {browser} = await setupProfile({
			profile: 'no-x',
			root,
			executablePath: '/x/chrome',
			env: DISPLAY_ENV,
			platform: 'linux',
			spawnBrowser: fake.spawn,
			onPrompt: () => {},
		});
		fake.stderr.write(
			'ERROR:ozone_platform_x11.cc Missing X server or $DISPLAY\n',
		);
		fake.exit(1);
		await expect(browser.waitForExit()).rejects.toBeInstanceOf(
			MissingDisplayError,
		);
	});

	it('refuses up front on a Linux host with no display (missing-display)', async () => {
		const root = await makeTempRoot();
		const fake = fakeSpawner();
		await expect(
			setupProfile({
				profile: 'headless-host',
				root,
				executablePath: '/x/chrome',
				env: {PATH: ''},
				platform: 'linux',
				spawnBrowser: fake.spawn,
				onPrompt: () => {},
			}),
		).rejects.toBeInstanceOf(MissingDisplayError);
		expect(fake.calls).toEqual([]);
	});
});

describe('setupProfile: which browser build writes the profile', () => {
	it('defaults to the pinned bundled Chromium, launched directly', async () => {
		const root = await makeTempRoot();
		const fake = fakeSpawner();
		const {browser} = await setupProfile({
			profile: 'bundled',
			root,
			env: DISPLAY_ENV,
			platform: 'linux',
			// /bin/sh stands in for an installed bundled Chromium (it is executable).
			bundledExecutablePath: () => '/bin/sh',
			spawnBrowser: fake.spawn,
			onPrompt: () => {},
		});
		expect(browser.executablePath).toBe('/bin/sh');
		expect(fake.calls[0]!.exe).toBe('/bin/sh');
		fake.exit(0);
	});

	it('a missing bundled Chromium is the typed missing-browser-binary, with the path it wanted', async () => {
		const root = await makeTempRoot();
		const wanted = join(
			root,
			'ms-playwright',
			'chromium-9999',
			'chrome-linux',
			'chrome',
		);
		const error = await setupProfile({
			profile: 'absent',
			root,
			env: DISPLAY_ENV,
			platform: 'linux',
			bundledExecutablePath: () => wanted,
			spawnBrowser: fakeSpawner().spawn,
			onPrompt: () => {},
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(MissingBrowserBinaryError);
		expect((error as MissingBrowserBinaryError).browser).toBe('chromium');
		expect((error as MissingBrowserBinaryError).executablePath).toBe(wanted);
	});

	it('--real-chrome and --use-system-browser chrome resolve the system Chrome as serve does (WEBHANDS_CHROME first)', async () => {
		const root = await makeTempRoot();
		const {exe} = await argvRecorder(root);
		for (const selection of [{realChrome: true}, {systemBrowser: 'chrome'}]) {
			const fake = fakeSpawner();
			const {browser} = await setupProfile({
				profile: 'system',
				root,
				env: {...DISPLAY_ENV, [REAL_CHROME_ENV]: exe},
				platform: 'linux',
				spawnBrowser: fake.spawn,
				onPrompt: () => {},
				bundledExecutablePath: () => {
					throw new Error('must not consult the bundled Chromium');
				},
				...selection,
			});
			expect(browser.executablePath).toBe(exe);
			expect(
				fake.calls[0]!.args.filter((a) => AUTOMATION_FLAG.test(a)),
			).toEqual([]);
			fake.exit(0);
			await browser.waitForExit();
		}
	});

	it('then falls back to the PATH names', async () => {
		const root = await makeTempRoot();
		const bin = join(root, 'bin');
		const {mkdir} = await import('node:fs/promises');
		await mkdir(bin);
		const chrome = join(bin, 'google-chrome-stable');
		await writeFile(chrome, '#!/bin/sh\n');
		await chmod(chrome, 0o755);
		const fake = fakeSpawner();
		const {browser} = await setupProfile({
			profile: 'path',
			root,
			realChrome: true,
			env: {PATH: bin, DISPLAY: ':0'},
			platform: 'linux',
			spawnBrowser: fake.spawn,
			onPrompt: () => {},
		});
		expect(browser.executablePath).toBe(chrome);
		fake.exit(0);
	});

	it('no system Chrome: real-chrome-not-found for --real-chrome, missing-browser-binary for --use-system-browser', async () => {
		const root = await makeTempRoot();
		const base = {
			profile: 'none',
			root,
			env: {PATH: '', DISPLAY: ':0'},
			platform: 'linux',
			spawnBrowser: fakeSpawner().spawn,
			onPrompt: () => {},
		};
		await expect(
			setupProfile({...base, realChrome: true}),
		).rejects.toBeInstanceOf(RealChromeNotFoundError);
		const error = await setupProfile({...base, systemBrowser: 'chrome'}).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(MissingBrowserBinaryError);
		expect((error as MissingBrowserBinaryError).browser).toBe('chrome');
	});
});

describe('setupProfile: the profile dir', () => {
	it('creates the dedicated profile dir and prompts with what to do', async () => {
		const root = await makeTempRoot();
		const loc = resolveProfileLocation('default', {root});
		expect(existsSync(loc.profileDir)).toBe(false);

		const prompts: string[] = [];
		const fake = fakeSpawner();
		const {location} = await setupProfile({
			profile: 'default',
			root,
			executablePath: '/x/chrome',
			env: DISPLAY_ENV,
			platform: 'linux',
			spawnBrowser: fake.spawn,
			onPrompt: (m) => prompts.push(m),
		});
		expect(location.profileDir).toBe(loc.profileDir);
		expect((await stat(loc.profileDir)).isDirectory()).toBe(true);

		expect(prompts).toHaveLength(1);
		const prompt = prompts[0]!;
		expect(prompt).toContain('default');
		expect(prompt).toContain(loc.profileDir);
		expect(prompt).toMatch(/log in/i);
		expect(prompt).toMatch(/close/i);
		expect(prompt).toMatch(/not under automation/i);
		fake.exit(0);
	});

	it('is idempotent: re-running against an already-set-up profile is fine', async () => {
		const root = await makeTempRoot();
		const run = async () => {
			const fake = fakeSpawner();
			const result = await setupProfile({
				profile: 'again',
				root,
				executablePath: '/x/chrome',
				env: DISPLAY_ENV,
				platform: 'linux',
				spawnBrowser: fake.spawn,
				onPrompt: () => {},
			});
			fake.exit(0);
			await result.browser.waitForExit();
			return result;
		};
		const first = await run();
		const second = await run();
		expect(second.location.profileDir).toBe(first.location.profileDir);
	});

	it('leaves the real ~/.webhands location UNTOUCHED', async () => {
		const realHome = join(homedir(), DEFAULT_HOME_DIRNAME);
		const before = existsSync(realHome);
		const root = await makeTempRoot();
		const fake = fakeSpawner();
		await setupProfile({
			profile: 'isolation',
			root,
			executablePath: '/x/chrome',
			env: DISPLAY_ENV,
			platform: 'linux',
			spawnBrowser: fake.spawn,
			onPrompt: () => {},
		});
		fake.exit(0);
		expect(existsSync(realHome)).toBe(before);
		if (before) {
			expect(existsSync(join(realHome, 'profiles', 'isolation'))).toBe(false);
		}
	});
});

describe('setupProfile: the REAL bundled Chromium is not automated', () => {
	let server: Server | undefined;

	afterEach(async () => {
		await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
		server = undefined;
	});

	it('its page reads navigator.webdriver === false, and closing it ends the wait', async () => {
		// The page reports navigator.webdriver back to us over plain HTTP: no CDP
		// anywhere, so the measurement itself cannot be what sets the flag.
		let report!: (value: string) => void;
		const reported = new Promise<string>((r) => {
			report = r;
		});
		server = createServer((req, res) => {
			const url = new URL(req.url ?? '/', 'http://x');
			if (url.pathname === '/report') {
				report(url.searchParams.get('wd') ?? 'missing');
				res.end('ok');
				return;
			}
			res.setHeader('content-type', 'text/html');
			res.end(
				`<!doctype html><title>wd</title><script>` +
					`fetch('/report?wd=' + String(navigator.webdriver))` +
					`</script>`,
			);
		});
		await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
		const port = (server.address() as AddressInfo).port;

		const root = await makeTempRoot();
		const {browser, location} = await setupProfile({
			profile: 'real',
			root,
			url: `http://127.0.0.1:${String(port)}/`,
			executablePath: testChromeExecutable(),
			// The test-environment sandbox concession, via the SAME operator env var a
			// container user would set (never added by the product itself).
			env: {
				...process.env,
				WEBHANDS_CHROME_ARGS: CI_SANDBOX_ARGS.join(' '),
			},
			onPrompt: () => {},
		});
		expect(browser.args.some((a) => /remote-debugging/.test(a))).toBe(false);
		try {
			const wd = await Promise.race([
				reported,
				new Promise<string>((_, reject) =>
					setTimeout(() => reject(new Error('page never reported')), 30_000),
				),
			]);
			expect(wd).toBe('false');
		} finally {
			// The human "closes the window".
			process.kill(browser.pid!, 'SIGTERM');
		}
		// Chrome handles SIGTERM as a normal quit (it may report code 0 or the signal).
		await expect(browser.waitForExit()).resolves.toBeDefined();
		// The browser wrote its profile into the dedicated dir.
		expect(existsSync(join(location.profileDir, 'Local State'))).toBe(true);
	});
});
