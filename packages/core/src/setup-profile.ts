import {spawn, type ChildProcess, type SpawnOptions} from 'node:child_process';
import {access, constants, mkdir, readlink} from 'node:fs/promises';
import {hostname} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {
	MissingBrowserBinaryError,
	MissingDisplayError,
	MissingStealthDependencyError,
	RealChromeNotFoundError,
	RealChromeStartError,
} from './errors.js';
import {
	siblingBrowserBuilds,
	STEALTH_PACKAGE,
} from './playwright-launch-transport.js';
import {
	assertUsableChromeProxy,
	captureTail,
	chromeCandidates,
	discoverChromeExecutable,
	envArgs,
	REAL_CHROME_ENV,
} from './real-chrome.js';
import {
	resolveProfileLocation,
	type ProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';
import {hostResolverRulesArg} from './socks-proxy.js';

/**
 * The one-time human login flow (SPEC User Story 1; CONTEXT `setup-profile`;
 * ADR-0002; finding
 * `cloudflare-turnstile-refuses-any-browser-with-a-debugging-port`).
 *
 * `setup-profile` opens the dedicated profile in a VISIBLE browser so a human
 * logs into a site and/or clears an anti-bot challenge ONCE. The cookies and
 * state that session writes persist in the profile dir, so a later `serve`
 * against the SAME profile reuses them without re-login.
 *
 * THE BROWSER IS NOT UNDER AUTOMATION, and that is the whole design. This flow
 * drives nothing: it only needs a window a human types into. It used to open
 * that window through the Playwright launch transport, which added Playwright's
 * default automation args and a remote-debugging pipe, so the page saw
 * `navigator.webdriver === true`. Cloudflare Turnstile then looped forever on
 * "Verifying your browser" and Google sign-in refused with "This browser or app
 * may not be secure": the human could not log in at all, in the one step whose
 * only job is letting them log in. Measured on the same machine, the same Chrome
 * binary started plainly (no debugging port) passed Turnstile with one click.
 *
 * So this module spawns the browser as a PLAIN CHILD PROCESS: no Playwright, no
 * `--remote-debugging-port`/`--remote-debugging-pipe`, no `--enable-automation`,
 * none of Playwright's default `--disable-*` args. See {@link buildSetupProfileArgs}
 * for the exact (short) command line. It then waits for the process to exit,
 * which is the human closing the window, and Chrome has flushed the profile.
 *
 * WHICH BROWSER. A Chromium user-data dir is written by a specific browser build,
 * so the profile must be set up with the build that will later drive it
 * ({@link resolveSetupProfileExecutable}):
 * - default: the pinned Playwright Chromium (what a plain `serve` launches),
 *   started directly from its executable path;
 * - `stealth`: Patchright's Chromium (what `serve --stealth` launches);
 * - `realChrome` or `systemBrowser: 'chrome'`: the system Chrome, resolved
 *   exactly as `serve --real-chrome` resolves it ({@link REAL_CHROME_ENV}, then
 *   the per-platform PATH names).
 *
 * SCOPE (ADR-0002). The verb only OPENS the window; it never types credentials or
 * touches a credential, and solves nothing.
 */

/** A function that receives the login prompt (one call, the full text). */
export type PromptSink = (message: string) => void;

/**
 * Spawn the browser process. Node's `spawn` by default; injectable so a test can
 * assert the exact argv without starting anything.
 */
export type SpawnBrowser = (
	executablePath: string,
	args: readonly string[],
	options: SpawnOptions,
) => ChildProcess;

/** Options for {@link setupProfile}. */
export interface SetupProfileOptions extends ProfileLocationOptions {
	/** Name of the dedicated profile to set up (e.g. `default`). */
	readonly profile: string;
	/**
	 * The page the window opens on, e.g. the site's sign-in page. Defaults to
	 * `about:blank`. Passed as the final positional argument, exactly as a user
	 * typing `google-chrome <url>` would.
	 */
	readonly url?: string;
	/**
	 * Where the actionable prompt is delivered. Defaults to STDERR
	 * (`console.error`), because STDOUT is reserved for the CLI's structured
	 * output envelope. Tests inject a sink to assert the prompt's content.
	 */
	readonly onPrompt?: PromptSink;
	/**
	 * Set the profile up with the system Chrome that `serve --real-chrome` will
	 * later drive (same discovery: {@link REAL_CHROME_ENV}, then the PATH names).
	 */
	readonly realChrome?: boolean;
	/**
	 * A system browser by its install identity (`serve --use-system-browser`).
	 * `'chrome'` resolves exactly like {@link realChrome}. Any other value can
	 * only be honoured through {@link REAL_CHROME_ENV}, since without Playwright
	 * there is nothing that maps a channel name to an executable.
	 */
	readonly systemBrowser?: string;
	/**
	 * Set the profile up with Patchright's Chromium, the build `serve --stealth`
	 * launches. Ignored when a system browser is selected (that build wins, as it
	 * does on `serve`).
	 */
	readonly stealth?: boolean;
	/**
	 * Route the window's traffic and DNS through a SOCKS proxy, so the human logs
	 * in from the SAME exit IP a later `serve --proxy` will use. Mapped onto
	 * Chromium's own `--proxy-server` (plus the no-leak resolver rule), exactly as
	 * `serve --real-chrome --proxy`. Not an automation flag; credentials are
	 * refused because Chrome cannot use them.
	 */
	readonly proxy?: string;
	/** Override no-leak DNS for {@link proxy} (see `parseSocksProxy`). */
	readonly proxyNoLeak?: boolean;
	/**
	 * Explicit executable to spawn, bypassing all resolution. For library callers
	 * with an unusual install, and for tests.
	 */
	readonly executablePath?: string;
	/** Env for the spawned process and executable discovery. Defaults to `process.env`. */
	readonly env?: NodeJS.ProcessEnv;
	/** Platform override (tests). Defaults to `process.platform`. */
	readonly platform?: string;
	/** Process spawner (tests). Defaults to Node's `spawn`. */
	readonly spawnBrowser?: SpawnBrowser;
	/**
	 * Where the pinned bundled Chromium lives (tests). Defaults to Playwright's
	 * `chromium.executablePath()`, which names the revision this build pins
	 * whether or not it is installed.
	 */
	readonly bundledExecutablePath?: () => string;
	/**
	 * How Patchright's Chromium path is obtained (tests). Defaults to a lazy
	 * `import('patchright')`; a failure is the typed
	 * {@link MissingStealthDependencyError}.
	 */
	readonly stealthExecutablePath?: () => Promise<string>;
}

/** How the browser process ended. */
export interface BrowserExit {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
}

/** The plain, un-automated browser {@link setupProfile} started. */
export interface SetupProfileBrowser {
	/** The executable that was spawned. */
	readonly executablePath: string;
	/** Its exact argv (after the executable). */
	readonly args: readonly string[];
	/** The process id, for a human who wants to see or signal it. */
	readonly pid: number | undefined;
	/**
	 * Resolve when the browser exits, i.e. the human closed the window (Chrome
	 * has flushed the profile by then). Rejects with {@link MissingDisplayError}
	 * when it died for want of a display, or {@link RealChromeStartError} for any
	 * other failing exit, quoting Chrome's stderr.
	 */
	waitForExit(): Promise<BrowserExit>;
}

/** The result of {@link setupProfile}: the running browser + where the profile is. */
export interface SetupProfileResult {
	readonly browser: SetupProfileBrowser;
	/** The resolved location of the profile being set up. */
	readonly location: ProfileLocation;
}

/**
 * Run the `setup-profile` flow for {@link SetupProfileOptions.profile}.
 *
 * Creates the dedicated profile dir if absent (the ONE place a profile dir is
 * created: the launch transport refuses a missing one with `MissingProfileError`
 * so a typo cannot spawn a blank profile), spawns the plain browser on it, emits
 * the prompt, and returns. The caller awaits `browser.waitForExit()` to know the
 * human is done.
 *
 * @throws MissingDisplayError on a display-less Linux host (checked up front).
 * @throws MissingBrowserBinaryError when the bundled or named system browser is
 *   not installed.
 * @throws RealChromeNotFoundError for `realChrome` with no Chrome found.
 * @throws RealChromeStartError when a browser is already running on the profile,
 *   or the spawn itself fails.
 */
export async function setupProfile(
	options: SetupProfileOptions,
): Promise<SetupProfileResult> {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const location = resolveProfileLocation(options.profile, {
		...(options.root !== undefined ? {root: options.root} : {}),
		...(options.env !== undefined ? {env: options.env} : {}),
	});

	// Display first: it is the cheapest check, and a missing display is the
	// first thing a headless host meets. On Linux a window needs X11 or Wayland;
	// macOS and Windows always have a window server.
	if (
		platform === 'linux' &&
		!nonEmpty(env.DISPLAY) &&
		!nonEmpty(env.WAYLAND_DISPLAY)
	) {
		throw new MissingDisplayError();
	}

	const executablePath = await resolveSetupProfileExecutable(options);
	const args = buildSetupProfileArgs({
		userDataDir: location.profileDir,
		...(options.url !== undefined ? {url: options.url} : {}),
		...(options.proxy !== undefined ? {proxy: options.proxy} : {}),
		...(options.proxyNoLeak !== undefined
			? {proxyNoLeak: options.proxyNoLeak}
			: {}),
		env,
	});

	await mkdir(location.profileDir, {recursive: true});

	// A browser already running on this dir would swallow our spawn: Chrome's
	// second instance hands its URL to the first and exits 0 at once, which we
	// would report as "the human closed it, profile saved" while the real window
	// is still open. Refuse instead.
	const holder = await liveSingletonHolder(location.profileDir);
	if (holder !== undefined) {
		throw new RealChromeStartError(
			executablePath,
			`a browser (pid ${String(holder)}) is already running against ${location.profileDir}`,
		);
	}

	const spawnBrowser: SpawnBrowser =
		options.spawnBrowser ?? ((exe, argv, opts) => spawn(exe, argv, opts));
	let child: ChildProcess;
	try {
		child = spawnBrowser(executablePath, args, {
			env,
			// stderr piped (drained, only a tail kept) so a failing start can quote
			// Chrome's own explanation; stdout is noise.
			stdio: ['ignore', 'ignore', 'pipe'],
			// Same process group, so the operator's Ctrl-C reaches the browser too.
			detached: false,
		});
	} catch (cause) {
		throw new RealChromeStartError(executablePath, 'it could not be spawned', {
			cause,
		});
	}
	const stderrTail = captureTail(child, 2_000);

	// Subscribe NOW, not when the caller gets round to waiting: an exit that
	// lands between spawn and `waitForExit()` must not be missed.
	const exited = new Promise<BrowserExit>((resolve, reject) => {
		child.once('error', (cause) => {
			reject(
				new RealChromeStartError(executablePath, 'it failed to start', {
					cause,
				}),
			);
		});
		child.once('exit', (code, signal) => {
			// A clean quit (the human closed it), or a polite termination signal
			// (Ctrl-C, logout, `kill`), on which Chrome still flushes the profile.
			if (code === 0 || (signal !== null && CLEAN_SIGNALS.has(signal))) {
				resolve({code, signal});
				return;
			}
			// Anything else is a crash or a refused start: SIGABRT is the classic
			// no-usable-sandbox abort, and reporting "profile saved" there would lie.
			void stderrTail.read().then((stderr) => {
				if (isMissingDisplayOutput(stderr)) {
					reject(new MissingDisplayError());
					return;
				}
				reject(
					new RealChromeStartError(
						executablePath,
						signal !== null
							? `it exited on signal ${signal}`
							: `it exited with code ${String(code)}`,
						{stderr},
					),
				);
			});
		});
	});
	// A caller that never waits must not crash the process with an unhandled
	// rejection; one that does still sees the rejection.
	exited.catch(() => {});

	const sink: PromptSink = options.onPrompt ?? ((m) => console.error(m));
	sink(buildPrompt(location));

	return {
		location,
		browser: {
			executablePath,
			args,
			pid: child.pid,
			waitForExit: () => exited,
		},
	};
}

/**
 * The complete argv for the setup browser, and deliberately nothing more.
 *
 * - `--user-data-dir=<profileDir>`: the dedicated profile, never the daily one.
 * - `--no-first-run` / `--no-default-browser-check`: no onboarding over the page.
 * - the proxy flags, only when a proxy was asked for (routing, not automation).
 * - {@link REAL_CHROME_ARGS_ENV} extras, the operator's escape hatch for a host
 *   with no usable sandbox (`--no-sandbox`), honoured as on `serve --real-chrome`.
 * - the start URL, last.
 *
 * ABSENT on purpose, and asserted by a test: `--remote-debugging-port`,
 * `--remote-debugging-pipe`, `--enable-automation`, and every Playwright default
 * arg. Any of those is what makes `navigator.webdriver` true.
 */
export function buildSetupProfileArgs(options: {
	readonly userDataDir: string;
	readonly url?: string;
	readonly proxy?: string;
	readonly proxyNoLeak?: boolean;
	readonly env?: NodeJS.ProcessEnv;
}): string[] {
	const proxyArgs: string[] = [];
	if (options.proxy !== undefined && options.proxy.trim() !== '') {
		const parsed = assertUsableChromeProxy(options.proxy, options.proxyNoLeak);
		proxyArgs.push(`--proxy-server=${parsed.server}`);
		if (parsed.noLeak) proxyArgs.push(hostResolverRulesArg(parsed.host));
	}
	const url =
		options.url !== undefined && options.url.trim() !== ''
			? options.url
			: 'about:blank';
	return [
		`--user-data-dir=${options.userDataDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		...proxyArgs,
		...envArgs(options.env ?? process.env),
		url,
	];
}

/**
 * Pick the executable whose build will later drive this profile (see the module
 * overview for the mapping), and verify it exists.
 */
export async function resolveSetupProfileExecutable(
	options: Pick<
		SetupProfileOptions,
		| 'executablePath'
		| 'realChrome'
		| 'systemBrowser'
		| 'stealth'
		| 'env'
		| 'platform'
		| 'bundledExecutablePath'
		| 'stealthExecutablePath'
	>,
): Promise<string> {
	if (options.executablePath !== undefined) {
		return options.executablePath;
	}
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const system = nonEmpty(options.systemBrowser)
		? options.systemBrowser
		: undefined;

	if (options.realChrome === true || system !== undefined) {
		const overridden = nonEmpty(env[REAL_CHROME_ENV]);
		if (
			options.realChrome !== true &&
			system !== undefined &&
			system !== 'chrome' &&
			!overridden
		) {
			throw new Error(
				`setup-profile cannot locate the '${system}' system browser by name: ` +
					`it starts the browser plainly (not through Playwright, so the login ` +
					`window is not under automation), and only 'chrome' has a known ` +
					`lookup. Point ${REAL_CHROME_ENV} at the ${system} executable and ` +
					`rerun.`,
			);
		}
		const found = await discoverChromeExecutable({env, platform});
		if (found !== undefined) return found;
		if (options.realChrome === true) {
			throw new RealChromeNotFoundError(
				chromeCandidates(platform),
				REAL_CHROME_ENV,
			);
		}
		throw new MissingBrowserBinaryError(system ?? 'chrome');
	}

	const executablePath =
		options.stealth === true
			? await (options.stealthExecutablePath ?? patchrightExecutablePath)()
			: (options.bundledExecutablePath ?? (() => chromium.executablePath()))();
	if (!(await isExecutable(executablePath))) {
		throw new MissingBrowserBinaryError('chromium', undefined, {
			executablePath,
			present: await siblingBrowserBuilds(executablePath, 'chromium'),
		});
	}
	return executablePath;
}

/** Compose the login prompt. Pure, so a test can assert its content. */
export function buildPrompt(location: ProfileLocation): string {
	return [
		`Setting up the "${location.profile}" profile for webhands.`,
		`Profile directory: ${location.profileDir}`,
		'',
		'A plain browser window is now open. It is NOT under automation (no',
		'debugging port), so sign-in pages and bot checks see an ordinary browser.',
		'In that window:',
		'  1. Log in to the site(s) you want this profile to stay signed in to.',
		'  2. Clear any anti-bot challenge / CAPTCHA if one appears.',
		'  3. When you are done, CLOSE the browser window (quit it entirely).',
		'',
		'Your session (cookies, logins, challenge clearance) is saved into the',
		'profile directory above, so a later `serve` against the same profile',
		'reuses it without re-login. Nobody but you types your credentials: this',
		'tool only opens the window.',
	].join('\n');
}

/** Patchright's Chromium path, via the same lazy optional import `serve --stealth` uses. */
async function patchrightExecutablePath(): Promise<string> {
	let mod: {chromium?: {executablePath?: () => string}};
	try {
		const specifier = STEALTH_PACKAGE;
		mod = (await import(specifier)) as typeof mod;
	} catch (cause) {
		throw new MissingStealthDependencyError(STEALTH_PACKAGE, undefined, {
			cause,
		});
	}
	if (typeof mod.chromium?.executablePath !== 'function') {
		throw new MissingStealthDependencyError(STEALTH_PACKAGE);
	}
	return mod.chromium.executablePath();
}

/**
 * The pid holding Chrome's `SingletonLock` in `dir`, when that process is alive
 * on THIS host; otherwise `undefined`.
 *
 * The lock is a symlink whose target is `<hostname>-<pid>` (Linux and macOS;
 * absent on Windows, where this simply finds nothing). A stale lock from a
 * crashed browser points at a dead pid, which Chrome itself clears, so only a
 * LIVE holder counts.
 */
export async function liveSingletonHolder(
	dir: string,
): Promise<number | undefined> {
	let target: string;
	try {
		target = await readlink(join(dir, 'SingletonLock'));
	} catch {
		return undefined;
	}
	const dash = target.lastIndexOf('-');
	if (dash < 0 || target.slice(0, dash) !== hostname()) return undefined;
	const pid = Number(target.slice(dash + 1));
	if (!Number.isInteger(pid) || pid <= 0) return undefined;
	try {
		process.kill(pid, 0);
		return pid;
	} catch (cause) {
		// EPERM means it exists but is someone else's: still alive.
		return (cause as NodeJS.ErrnoException).code === 'EPERM' ? pid : undefined;
	}
}

/** Signals that end a browser normally (it flushes its profile on them). */
const CLEAN_SIGNALS: ReadonlySet<NodeJS.Signals> = new Set([
	'SIGTERM',
	'SIGINT',
	'SIGHUP',
]);

/** Chromium's own words when it has no display to draw on. */
function isMissingDisplayOutput(stderr: string): boolean {
	return /Missing X server or \$DISPLAY/i.test(stderr);
}

function nonEmpty(value: string | undefined): value is string {
	return value !== undefined && value.trim() !== '';
}

async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
