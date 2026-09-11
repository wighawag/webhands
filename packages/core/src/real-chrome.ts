import {spawn, type ChildProcess} from 'node:child_process';
import {access, constants, rm} from 'node:fs/promises';
import {delimiter, join} from 'node:path';
import {resolveCdpEndpoint} from './devtools-port.js';
import {
	ProxyAuthUnsupportedError,
	RealChromeNotFoundError,
	RealChromeStartError,
} from './errors.js';
import {
	hostResolverRulesArg,
	parseSocksProxy,
	type ParsedSocksProxy,
} from './socks-proxy.js';

/**
 * Spawning the USER'S OWN Chrome with a remote-debugging port, so the controller
 * can attach to it over CDP (finding
 * `akamai-blocks-playwright-launched-chromium-attach-to-real-chrome-works`;
 * ADR-0014).
 *
 * WHY THIS EXISTS, and it is not a small reason. A Playwright-LAUNCHED browser is
 * measurably a different animal from the browser you use yourself, even with
 * `--use-system-browser chrome` and even under `--stealth`: Playwright adds
 * automation args, an emulated viewport, a pile of `--disable-*` flags and a cold
 * profile. Against Akamai Bot Manager, every launched variant was blocked
 * identically, while a Chrome the HUMAN started and webhands merely ATTACHED to
 * drove a nine-screen authenticated flow with no blocking at all. Attaching was
 * already possible (`serve --endpoint <url>`); what was missing was doing the
 * boring half (start Chrome with a debugging port on a dedicated dir, find the
 * port, hand back the endpoint) so the WORKING recipe is one command instead of
 * folklore.
 *
 * SEAM (ADR-0003). This module spawns a process and reads a file. It imports NO
 * Playwright and NO CDP type: what it hands back is a plain `http://127.0.0.1:<port>`
 * URL string, exactly the shape the attach `OpenTarget.endpoint` already carries.
 * That is what keeps "spawn the user's Chrome" independent of how we later drive
 * it.
 *
 * SCOPE (ADR-0002). This starts a NORMAL browser the user could have started
 * themselves, with the flags needed to make it automatable AND a dedicated
 * user-data dir. It spoofs nothing and solves nothing. It deliberately does NOT
 * point at the user's DAILY profile dir: Chrome refuses to automate a profile it
 * is already running, and sharing it would risk both profile-lock corruption and
 * that profile's own reputation.
 */

/** Chrome-family executables to look for, in PREFERENCE order, per platform. */
const CANDIDATES: Readonly<Record<string, readonly string[]>> = {
	linux: [
		'google-chrome-stable',
		'google-chrome',
		'chromium-browser',
		'chromium',
		'microsoft-edge-stable',
		'microsoft-edge',
	],
	darwin: [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
	],
	win32: [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	],
};

/**
 * The env var naming the Chrome executable to spawn, for a user whose install is
 * somewhere the candidate list does not cover (a Flatpak wrapper, a versioned
 * build, a non-English Windows path). Checked BEFORE the candidates, so it is
 * always an escape hatch rather than a last resort.
 */
export const REAL_CHROME_ENV = 'WEBHANDS_CHROME';

/** Options for {@link spawnRealChrome}. */
export interface SpawnRealChromeOptions {
	/**
	 * The user-data dir the spawned Chrome owns. REQUIRED and never defaulted: the
	 * caller (the transport, via `resolveProfileLocation`) decides where a profile
	 * lives, and a defaulted dir here could silently become the user's daily
	 * profile, which is the one thing this must not touch.
	 */
	readonly userDataDir: string;
	/**
	 * Explicit path to the Chrome/Chromium executable. When omitted, the env var
	 * {@link REAL_CHROME_ENV} then the per-platform {@link CANDIDATES} are tried,
	 * and a typed {@link RealChromeNotFoundError} is raised if none exists.
	 */
	readonly executablePath?: string;
	/**
	 * Run the spawned browser headless. Default `false`, i.e. a VISIBLE window,
	 * because the entire point is a browser the human can see, log into and take
	 * over. Tests pass `true`.
	 */
	readonly headless?: boolean;
	/** Extra command-line args appended verbatim (after webhands' own). */
	readonly args?: readonly string[];
	/**
	 * Route ALL of the spawned browser's traffic AND DNS through one SOCKS proxy,
	 * given as a SOCKS URL (`socks5h://host:1080`, `socks5://host:1080`).
	 *
	 * This is the ONLY way to change the exit IP in this mode, and that makes it
	 * more important here than on the Playwright launch path: `--real-chrome` exists
	 * to present a real browser, and the IP is part of what a bot manager weighs. A
	 * real browser on a datacentre IP is still a datacentre IP.
	 *
	 * Mapped to Chromium's own `--proxy-server`, plus the `--host-resolver-rules`
	 * catch-all when no-leak is in effect, through the SAME
	 * {@link parseSocksProxy} the launch transport uses, so `socks5h` vs `socks5`
	 * means the same thing in both modes. Note Chrome ALWAYS resolves URL hostnames
	 * at the proxy for a SOCKSv5 proxy (per Chromium's `net/docs/proxy.md`); the
	 * resolver rules close the side channels (DNS prefetcher and friends).
	 *
	 * CREDENTIALS ARE REFUSED, loudly. Chromium documents that "no authentication
	 * methods are supported for SOCKSv5 in Chrome" and that it "will not use any
	 * credentials embedded in the proxy settings", so a `user:pass@` URL would be
	 * silently stripped and every request would fail with
	 * `ERR_PROXY_CONNECTION_FAILED`, or worse leave the user believing their traffic
	 * was authenticated and proxied. A {@link ProxyAuthUnsupportedError} says so
	 * instead. (The Playwright LAUNCH path can carry credentials, because Playwright
	 * answers the auth challenge itself rather than passing them to Chrome.)
	 */
	readonly proxy?: string;
	/**
	 * Override whether {@link proxy} enforces NO local DNS. `true` forces the
	 * leak-free catch-all even for a plain `socks5://` URL; `false` allows local DNS
	 * even for `socks5h://`. When omitted the SCHEME decides. Ignored without a
	 * proxy.
	 */
	readonly proxyNoLeak?: boolean;
	/**
	 * How long to wait for Chrome to publish its debugging port, in ms. Default
	 * 30s: a real Chrome opening a warm profile (extensions, restored session) is
	 * far slower to start than a bare Chromium, and the failure mode of being too
	 * impatient here is a confusing "could not start" on a browser that was merely
	 * still loading.
	 */
	readonly readyTimeoutMs?: number;
	/** Env for the spawned process + executable discovery. Defaults to `process.env`. */
	readonly env?: NodeJS.ProcessEnv;
	/** Platform override for candidate selection (tests). Defaults to `process.platform`. */
	readonly platform?: string;
}

/** A spawned, attachable real Chrome. */
export interface RealChrome {
	/**
	 * Its loopback CDP endpoint (`http://127.0.0.1:<port>`), ready to hand to an
	 * attach open. A plain string: no CDP type crosses (ADR-0003).
	 */
	readonly endpoint: string;
	/** The executable that was actually spawned (after discovery). */
	readonly executablePath: string;
	/** The spawned process id, for a human who wants to see or signal it. */
	readonly pid: number | undefined;
	/**
	 * Terminate the browser WE spawned (SIGTERM, then SIGKILL if it ignores that).
	 * Idempotent, and safe to call after the user has already closed the window.
	 *
	 * Only ever call this for a browser this module started. A browser the USER
	 * started is theirs: the attach transport detaches from those without killing
	 * them (ADR-0002), and that asymmetry is deliberate.
	 */
	close(): Promise<void>;
}

/**
 * Find the Chrome-family executable to spawn, or `undefined` if none is
 * installed.
 *
 * Order: the {@link REAL_CHROME_ENV} override, then the per-platform candidates.
 * A candidate containing a path separator is checked as a PATH-less absolute/
 * relative path; a bare name is resolved against `PATH`. Returning `undefined`
 * (rather than throwing) keeps this usable as a capability probe, e.g. for a
 * help message or a doctor command.
 */
export async function discoverChromeExecutable(
	options: {
		readonly env?: NodeJS.ProcessEnv;
		readonly platform?: string;
	} = {},
): Promise<string | undefined> {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;

	const override = env[REAL_CHROME_ENV];
	if (override !== undefined && override.trim() !== '') {
		// An explicit override is honoured EXACTLY: if the user named a path that
		// does not exist, we report that rather than quietly using something else.
		return (await isExecutable(override)) ? override : undefined;
	}

	for (const candidate of CANDIDATES[platform] ?? CANDIDATES.linux!) {
		const resolved = await resolveCandidate(candidate, env);
		if (resolved !== undefined) {
			return resolved;
		}
	}
	return undefined;
}

/**
 * Start a real Chrome with remote debugging on an OS-assigned port against
 * `userDataDir`, and return it once its CDP endpoint is live.
 *
 * The flags are deliberately minimal and boring:
 * - `--remote-debugging-port=0` so the OS picks a free port (no collision with a
 *   Chrome the user already runs on 9222, and nothing to configure). The port is
 *   read back from the `DevToolsActivePort` file Chrome writes into the dir.
 * - `--user-data-dir=<dir>` so this is a DEDICATED profile, never the daily one.
 * - `--no-first-run` / `--no-default-browser-check` so a fresh dir does not open
 *   onboarding tabs over the page we are about to drive.
 * - `about:blank` as the initial page, so there is exactly one tab to attach to
 *   and it is not a restored session tab.
 *
 * Notably ABSENT: any `--disable-*` automation flag, `--enable-automation`, and
 * any fingerprint override. That absence is the point: the browser differs from
 * the user's own only by the debugging port and the dedicated profile dir.
 *
 * HONESTY, measured, because it is tempting to overclaim here. This does NOT hide
 * that the browser is automatable: Chrome sets `navigator.webdriver === true`
 * whenever `--remote-debugging-port` is enabled, verified BEFORE any client
 * attaches (a page's own boot script reads `true` in a plainly-spawned Chrome). So
 * the empirical advantage of this mode over a Playwright launch is NOT a missing
 * automation bit; it is everything else about being a real browser: no launch
 * hardening flags, a real warm profile with history and prefs, a real window, and
 * the human's own IP and behaviour. A site that simply reads `navigator.webdriver`
 * will still see automation here.
 *
 * @throws RealChromeNotFoundError when no Chrome executable can be found.
 * @throws RealChromeStartError when it fails to spawn, exits early, or never
 *   publishes a debugging port.
 */
export async function spawnRealChrome(
	options: SpawnRealChromeOptions,
): Promise<RealChrome> {
	const env = options.env ?? process.env;
	const executablePath =
		options.executablePath ??
		(await discoverChromeExecutable({
			env,
			...(options.platform !== undefined ? {platform: options.platform} : {}),
		}));
	if (executablePath === undefined) {
		throw new RealChromeNotFoundError(
			CANDIDATES[options.platform ?? process.platform] ?? CANDIDATES.linux!,
			REAL_CHROME_ENV,
		);
	}

	// A browser ALREADY running against this dir is a hard stop, and detecting it
	// HERE is what makes the endpoint we return trustworthy. Chrome's second
	// instance does not fail loudly: it hands its URL to the running one and exits
	// 0, leaving the FIRST browser's `DevToolsActivePort` file in place. Without this
	// check we would read that file and hand back a live endpoint belonging to a
	// browser we do not own, whose lifetime we would then wrongly claim (our
	// `close()` would kill our own already-dead child and leave theirs running).
	// Callers that WANT to reuse a running browser check liveness first (see
	// `isLiveDevToolsEndpoint`) and attach instead of spawning.
	const existing = await resolveCdpEndpoint(options.userDataDir, {
		timeoutMs: 0,
	});
	if (existing !== undefined) {
		// A GENEROUS probe budget here, deliberately. The `else` branch DELETES the port
		// file, so a false "not live" (a genuinely running Chrome that missed a tight
		// budget on a loaded machine) would destroy a live browser's endpoint on disk,
		// breaking both the reuse path and any user tooling that reads that file. The
		// extra patience is only ever paid when a port file exists at all.
		if (await isLiveDevToolsEndpoint(existing, {timeoutMs: 3_000})) {
			throw new RealChromeStartError(
				executablePath,
				`a browser is already running against ${options.userDataDir} ` +
					`(its debugging endpoint ${existing} is live)`,
			);
		}
		// A STALE file from a previous run: remove it so the port we read below can
		// only be the one OUR child wrote. Otherwise a slow-starting browser would
		// make us return the previous run's dead port.
		await rm(join(options.userDataDir, 'DevToolsActivePort'), {
			force: true,
		});
	}

	const args = buildRealChromeArgs(options);

	let child: ChildProcess;
	try {
		child = spawn(executablePath, args, {
			env,
			// Ignore stdio: Chrome is chatty on stderr (GPU/dbus noise on Linux) and
			// we must not let a full pipe buffer block the browser we are driving.
			stdio: 'ignore',
			// Keep it in our process group so an operator's Ctrl-C reaches it too.
			detached: false,
		});
	} catch (cause) {
		throw new RealChromeStartError(executablePath, 'it could not be spawned', {
			cause,
		});
	}

	// Record an early exit so the port wait can abort instead of timing out: a
	// Chrome that refuses the dir (e.g. already running against it) exits fast,
	// and "it exited with code N" is a far better message than a 30s silence.
	let exit: {code: number | null; signal: NodeJS.Signals | null} | undefined;
	child.once('exit', (code, signal) => {
		exit = {code, signal};
	});
	let spawnError: unknown;
	child.once('error', (cause) => {
		spawnError = cause;
	});

	const endpoint = await resolveCdpEndpoint(options.userDataDir, {
		timeoutMs: options.readyTimeoutMs ?? 30_000,
		abortReason: () => {
			if (spawnError !== undefined) return 'it failed to start';
			if (exit !== undefined) {
				return exit.signal !== null
					? `it exited on signal ${exit.signal}`
					: `it exited with code ${String(exit.code)}`;
			}
			return undefined;
		},
	});

	if (endpoint === undefined) {
		// Never leave a half-started browser behind: if it is somehow still alive
		// but portless, it is unusable to us and the user did not ask for a stray
		// window.
		await terminate(child);
		const detail =
			spawnError !== undefined
				? 'it failed to start'
				: exit !== undefined
					? exit.signal !== null
						? `it exited on signal ${exit.signal}`
						: `it exited with code ${String(exit.code)}`
					: 'it did not publish a remote-debugging port in time';
		throw new RealChromeStartError(executablePath, detail, {
			...(spawnError !== undefined ? {cause: spawnError} : {}),
		});
	}

	let closed = false;
	return {
		endpoint,
		executablePath,
		pid: child.pid,
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			await terminate(child);
		},
	};
}

/**
 * Ask a spawned browser to exit, escalating only if it ignores the polite ask.
 *
 * SIGTERM lets Chrome flush the profile it owns (cookies, session state) so the
 * dedicated dir stays reusable; SIGKILL after a grace period covers a hung
 * browser so `stop` can never hang forever. Resolves immediately if the process
 * is already gone (the user closed the window themselves).
 */
async function terminate(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	const exited = new Promise<void>((resolve) => {
		child.once('exit', () => resolve());
	});
	try {
		child.kill('SIGTERM');
	} catch {
		// Already gone between the check and the signal.
		return;
	}
	// Both waits CLEAR their timer. An uncancelled `setTimeout` in a `Promise.race`
	// holds the Node event loop for its full duration after the browser has already
	// exited, which would leave every in-process consumer (the eval harness, tests, a
	// library user) idling for up to 5s after a clean close.
	const killed = await raceWithTimeout(exited, SIGTERM_GRACE_MS);
	if (!killed) {
		try {
			child.kill('SIGKILL');
		} catch {
			// Nothing more we can do; the caller's teardown continues regardless.
		}
		await raceWithTimeout(exited, SIGKILL_GRACE_MS);
	}
}

/** How long a spawned browser gets to honour SIGTERM before SIGKILL. */
const SIGTERM_GRACE_MS = 5_000;

/** How long to wait for the process to be reaped after SIGKILL. */
const SIGKILL_GRACE_MS = 1_000;

/**
 * True iff `work` settled within `ms`. Always clears its timer (see
 * {@link terminate}).
 */
async function raceWithTimeout(
	work: Promise<unknown>,
	ms: number,
): Promise<boolean> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			work.then(() => true),
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), ms);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/**
 * Build the full command line for a real-Chrome spawn.
 *
 * Pure and exported so the FLAGS are testable without spawning a browser (the
 * launch transport's option forwarding is asserted the same way, via a launch
 * spy). The order is fixed: webhands' own flags, then the proxy flags, then the
 * caller's `args`, then the initial page last, so a caller can override a flag by
 * repeating it (Chromium takes the last occurrence) and the URL stays the final
 * positional.
 *
 * @throws ProxyAuthUnsupportedError if the proxy URL carries credentials.
 * @throws InvalidProxyError if the proxy URL is not a usable SOCKS URL.
 */
export function buildRealChromeArgs(options: SpawnRealChromeOptions): string[] {
	const proxyArgs: string[] = [];
	if (options.proxy !== undefined && options.proxy.trim() !== '') {
		const parsed = assertUsableChromeProxy(options.proxy, options.proxyNoLeak);
		proxyArgs.push(`--proxy-server=${parsed.server}`);
		if (parsed.noLeak) {
			proxyArgs.push(hostResolverRulesArg(parsed.host));
		}
	}
	return [
		'--remote-debugging-port=0',
		`--user-data-dir=${options.userDataDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		...(options.headless === true ? ['--headless=new'] : []),
		...proxyArgs,
		...(options.args ?? []),
		'about:blank',
	];
}

/**
 * Parse a proxy URL and assert Chrome can actually USE it, returning the parsed
 * proxy.
 *
 * Split out of {@link buildRealChromeArgs} so EVERY path that accepts a proxy in
 * this mode runs the same check, including paths that never build a command line.
 * The real-Chrome transport's REUSE path is the one that forced this: it
 * short-circuits before any args are built, so a credentialled URL slipped through
 * and the session ran unproxied. A refusal that only fires on some paths is not a
 * refusal.
 *
 * Uses the SAME parser as the launch path, so a malformed value is the typed
 * {@link InvalidProxyError} rather than an unproxied browser, and `socks5h` vs
 * `socks5` means the same thing in both modes.
 *
 * @throws InvalidProxyError if the value is not a usable SOCKS URL.
 * @throws ProxyAuthUnsupportedError if it carries credentials, which Chrome
 *   ignores outright (see that error for the citation).
 */
export function assertUsableChromeProxy(
	proxy: string,
	proxyNoLeak?: boolean,
): ParsedSocksProxy {
	const parsed = parseSocksProxy(proxy, proxyNoLeak);
	if (parsed.username !== undefined || parsed.password !== undefined) {
		throw new ProxyAuthUnsupportedError(proxy);
	}
	return parsed;
}

/**
 * True iff a DevTools endpoint is LIVE, by GETting `/json/version` with a short
 * timeout.
 *
 * The single liveness probe, shared by the spawn guard above (refuse to spawn over
 * a running browser) and by the real-Chrome transport's reuse path (attach to one
 * instead of spawning). It exists because the `DevToolsActivePort` file SURVIVES
 * the browser's exit, so the file proves nothing on its own. Any failure counts as
 * not-live, since the only use of the answer is choosing between reuse and spawn.
 *
 * `timeoutMs` exists because the COST of a false negative differs per caller: the
 * transport's reuse probe merely ends up spawning a fresh browser, while the spawn
 * guard goes on to DELETE the port file, so it pays for a slower, surer answer.
 */
export async function isLiveDevToolsEndpoint(
	endpoint: string,
	options: {readonly timeoutMs?: number} = {},
): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 500);
	try {
		const res = await fetch(`${endpoint}/json/version`, {
			signal: controller.signal,
		});
		return res.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

/** Resolve one candidate (a bare command name or a path) to an executable. */
async function resolveCandidate(
	candidate: string,
	env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
	if (candidate.includes('/') || candidate.includes('\\')) {
		return (await isExecutable(candidate)) ? candidate : undefined;
	}
	for (const dir of (env.PATH ?? '').split(delimiter)) {
		if (dir === '') continue;
		const full = join(dir, candidate);
		if (await isExecutable(full)) {
			return full;
		}
	}
	return undefined;
}

/** True iff `path` exists and is executable by this process. */
async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
