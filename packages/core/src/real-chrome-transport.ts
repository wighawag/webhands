import {mkdir} from 'node:fs/promises';
import {resolveCdpEndpoint} from './devtools-port.js';
import {PlaywrightAttachTransport} from './playwright-attach-transport.js';
import {
	resolveProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';
import {
	assertUsableChromeProxy,
	isLiveDevToolsEndpoint,
	spawnRealChrome,
	type RealChrome,
	type SpawnRealChromeOptions,
} from './real-chrome.js';
import {RealChromeReuseConflictError} from './errors.js';
import type {Hand} from './hand-host.js';
import type {OpenTarget, Session, Transport} from './seam.js';

/**
 * The `real-chrome` transport: spawn the USER'S OWN Chrome with a debugging port
 * on a dedicated profile dir, then ATTACH to it over CDP (ADR-0014; finding
 * `akamai-blocks-playwright-launched-chromium-attach-to-real-chrome-works`).
 *
 * It is the one-command form of the recipe that empirically beats a serious bot
 * manager: `google-chrome --remote-debugging-port=9222 --user-data-dir=...` then
 * `serve --endpoint http://127.0.0.1:9222`. Nothing here is cleverer than that
 * recipe; it just removes the two manual steps, because a working recipe nobody
 * can remember is not a feature.
 *
 * COMPOSITION, not a fourth driving path. The browser half is
 * {@link spawnRealChrome} (a process + a port file, zero Playwright) and the
 * driving half is the EXISTING {@link PlaywrightAttachTransport}, unchanged. This
 * class only owns what neither of them can: the LIFETIME of a browser webhands
 * started. So there is no second attach implementation to keep in step, and the
 * verb surface is identical by construction.
 *
 * LIFETIME, the one real decision. Plain attach deliberately does NOT kill the
 * browser on close, because the user started it (ADR-0002). Here WEBHANDS started
 * it, so the default is the opposite: closing the session terminates the browser
 * we spawned, matching `launch`. {@link RealChromeTransportOptions.keepBrowser}
 * inverts that for a user who wants their tabs to outlive `stop`; the next open
 * then REUSES the browser still running on that profile dir rather than failing on
 * Chrome's "profile already in use".
 *
 * SEAM (ADR-0003). `OpenTarget` is untouched: this handles `mode: 'launch'`
 * exactly like the launch transport does, because from the caller's point of view
 * that is what it is, "bring up a browser for this profile". WHICH browser and HOW
 * is transport-construction policy, the same place `stealth`/`systemBrowser`
 * already live. No CDP type is exposed: the endpoint stays an internal plain
 * string.
 */
export interface RealChromeTransportOptions {
	/**
	 * Leave the spawned browser RUNNING when the session closes, instead of
	 * terminating it. Default `false` (webhands started it, so webhands stops it).
	 *
	 * With `true`, a later open against the same profile ATTACHES to the browser
	 * still running on it instead of spawning a second one, so the user's tabs
	 * survive `stop` and the next `serve` picks them up again.
	 */
	readonly keepBrowser?: boolean;
	/**
	 * Run the spawned Chrome headless. Default: visible (see
	 * {@link SpawnRealChromeOptions.headless}).
	 *
	 * Like `executablePath` and `args`, this applies only when a browser is actually
	 * SPAWNED: if one is already running on the profile dir it is reused as-is (see
	 * {@link RealChromeTransportOptions.keepBrowser}), because you get the browser
	 * that is there.
	 */
	readonly headless?: boolean;
	/** Explicit Chrome executable path; omit to discover it. Spawn-time only. */
	readonly executablePath?: string;
	/** Extra args appended to the Chrome command line. Spawn-time only. */
	readonly args?: readonly string[];
	/**
	 * Route ALL traffic and DNS of the spawned Chrome through one SOCKS proxy (a
	 * SOCKS URL). The only way to change the exit IP in this mode; see
	 * {@link SpawnRealChromeOptions.proxy}, including why credentials are refused.
	 */
	readonly proxy?: string;
	/** Override the proxy's implied no-local-DNS behaviour; see the spawn option. */
	readonly proxyNoLeak?: boolean;
	/** How long to wait for Chrome to publish its debugging port (ms). */
	readonly readyTimeoutMs?: number;
	/** Env for discovery + the spawned process. Defaults to `process.env`. */
	readonly env?: NodeJS.ProcessEnv;
	/**
	 * INTERNAL test seam: how a real Chrome is spawned. Defaults to
	 * {@link spawnRealChrome}. Injectable so the transport's OWN logic (profile
	 * resolution, reuse, lifetime) is testable without a real Chrome install, the
	 * same way the launch transport injects its stealth importer. Deliberately NOT
	 * on {@link OpenTarget} (ADR-0003).
	 */
	readonly spawn?: (options: SpawnRealChromeOptions) => Promise<RealChrome>;
}

export class RealChromeTransport implements Transport {
	readonly #location: ProfileLocationOptions;
	readonly #hands: readonly Hand[];
	readonly #options: RealChromeTransportOptions;
	readonly #attach: PlaywrightAttachTransport;
	/** The endpoint of the browser behind the last open; see {@link cdpEndpoint}. */
	#cdpEndpoint: string | undefined;

	/**
	 * @param location overrides for where profiles live (a `root` and/or `env`).
	 * @param hands explicitly-loaded third-party hands (ADR-0007), passed through
	 *   to the attach transport that actually composes the verb surface.
	 * @param options transport-construction policy (lifetime, executable, ...).
	 */
	constructor(
		location: ProfileLocationOptions = {},
		hands: readonly Hand[] = [],
		options: RealChromeTransportOptions = {},
	) {
		this.#location = location;
		this.#hands = hands;
		this.#options = options;
		this.#attach = new PlaywrightAttachTransport(hands, location);
	}

	/**
	 * The CDP / remote-debugging endpoint of the browser behind the most recent
	 * {@link open} (spawned or reused), or `undefined` before the first open.
	 *
	 * A plain `http://127.0.0.1:<port>` string, never a CDP type (ADR-0003), mirroring
	 * {@link PlaywrightLaunchTransport.cdpEndpoint}. Unlike that one there is nothing
	 * to enable: this mode's browser ALWAYS has a debugging port, because that is how
	 * we attach to it. Exposing the value is therefore only about whether the caller
	 * ASKED to know it (`--expose-cdp`), so a caller that did not ask is not handed a
	 * shared driving surface it never requested.
	 */
	cdpEndpoint(): string | undefined {
		return this.#cdpEndpoint;
	}

	async open(target: OpenTarget): Promise<Session> {
		if (target.mode !== 'launch') {
			throw new Error(
				`RealChromeTransport only handles 'launch' (it spawns a real Chrome ` +
					`for a profile); '${target.mode}' is owned by the attach transport.`,
			);
		}

		// Validate the proxy FIRST, before anything else can short-circuit.
		//
		// This ordering is load-bearing, not tidiness. The credential refusal lives in
		// `buildRealChromeArgs`, which only runs on the SPAWN path, so when the reuse
		// path below short-circuits, a `user:pass@` URL used to sail through and the
		// session ran with no proxy at all. That is precisely the failure
		// ProxyAuthUnsupportedError exists to prevent (believing your traffic is
		// authenticated and proxied when it is not), so the check has to happen on EVERY
		// path, including the ones that never spawn. Cheap and pure: it only parses.
		if (
			this.#options.proxy !== undefined &&
			this.#options.proxy.trim() !== ''
		) {
			assertUsableChromeProxy(this.#options.proxy, this.#options.proxyNoLeak);
		}

		const loc = resolveProfileLocation(target.profile, this.#location);
		// Unlike the launch transport, a MISSING dir is NOT an error here. That rule
		// exists so a `launch` typo cannot silently spawn a blank profile, but the
		// whole point of this mode is that the HUMAN logs in with their own hands in
		// the window we open, which is `setup-profile`'s job done inline. Refusing
		// would mean "run setup-profile first" for a mode whose first run IS the
		// setup. We create it instead, so the dir is warm for every later run.
		await mkdir(loc.profileDir, {recursive: true});

		// REUSE: a browser may still be running against this profile dir, either
		// because a previous session chose `keepBrowser` or because a controller died
		// without tearing its browser down. Chrome refuses to open a user-data dir
		// twice, so spawning again would fail with a confusing "profile in use"; the
		// right move is to attach to the one already there. We detect it by the
		// DevToolsActivePort file it left behind plus a liveness check of that endpoint.
		//
		// Reuse is NOT gated on `keepBrowser`: a leftover browser has to be handled
		// whether or not the previous run asked for one, and refusing would strand the
		// profile until the human found the window.
		const existing = await this.#findRunningBrowser(loc.profileDir);
		if (existing !== undefined) {
			// CONFLICT CHECK. An already-running browser cannot retroactively acquire
			// SPAWN-TIME options: a proxy, an executable, a headless mode and extra args
			// are command-line facts of a process that is already up. Most of those are
			// cosmetic when reusing, but `proxy` decides the EXIT IP, so silently reusing
			// would egress through the user's real address while they believed they were
			// tunnelled. Refuse loudly for that class only (see #misleadingIfReused).
			const unhonourable = this.#misleadingIfReused();
			if (unhonourable.length > 0) {
				throw new RealChromeReuseConflictError(
					loc.profileDir,
					existing,
					unhonourable,
				);
			}
			// No misleading options, so reusing is exactly equivalent to what the caller
			// asked for. SOMEONE ELSE owns this browser's lifetime, so this session must
			// NOT kill it on close: plain attach semantics are right.
			this.#cdpEndpoint = existing;
			return this.#attach.open({mode: 'attach', endpoint: existing});
		}

		const spawnFn = this.#options.spawn ?? spawnRealChrome;
		const chrome = await spawnFn({
			userDataDir: loc.profileDir,
			// VISIBLE unless a caller explicitly asks otherwise through the transport
			// option. `target.headed` is deliberately NOT consulted here: this mode
			// exists so a human can watch, log in and take over the SAME browser
			// webhands drives, and a headless Chrome is both useless for that and a
			// fingerprint tell in its own right. If you want headless, you want the
			// launch transport, not this one. The option stays for tests and for a
			// caller who knowingly wants it.
			headless: this.#options.headless === true,
			...(this.#options.executablePath !== undefined
				? {executablePath: this.#options.executablePath}
				: {}),
			...(this.#options.args !== undefined ? {args: this.#options.args} : {}),
			...(this.#options.proxy !== undefined
				? {proxy: this.#options.proxy}
				: {}),
			...(this.#options.proxyNoLeak !== undefined
				? {proxyNoLeak: this.#options.proxyNoLeak}
				: {}),
			...(this.#options.readyTimeoutMs !== undefined
				? {readyTimeoutMs: this.#options.readyTimeoutMs}
				: {}),
			...(this.#options.env !== undefined ? {env: this.#options.env} : {}),
		});

		this.#cdpEndpoint = chrome.endpoint;
		let session: Session;
		try {
			session = await this.#attach.open({
				mode: 'attach',
				endpoint: chrome.endpoint,
			});
		} catch (cause) {
			// Never leave a browser we spawned behind when we could not drive it.
			await chrome.close().catch(() => {});
			throw cause;
		}

		if (this.#options.keepBrowser === true) {
			// The caller asked for the browser to outlive the session: hand back the
			// attach session untouched (its close() detaches without killing).
			return session;
		}
		return withSpawnedBrowserLifetime(session, chrome);
	}

	/**
	 * The configured options whose silent loss on the REUSE path would MISLEAD the
	 * caller, and which therefore make reuse a refusal rather than a convenience.
	 *
	 * The criterion is deliberately narrow, and it is not "can this option be applied
	 * to a running browser" (several cannot). It is: would silently ignoring it leave
	 * the user with a materially different session from the one they asked for?
	 *
	 * - `proxy` YES. It decides the EXIT IP. Reusing a browser that was started
	 *   without it means egressing through the user's real address while they believe
	 *   they are tunnelled, which is the one failure this tool must never have
	 *   quietly. (A first draft of this check also listed `headless`,
	 *   `executablePath` and `args`, which broke the legitimate `--keep-browser`
	 *   flow: they cannot be applied either, but nothing about them changes WHO YOU
	 *   APPEAR TO BE on the network, and refusing over them turned a working feature
	 *   into an error. The narrower rule is the right one.)
	 * - `headless` / `executablePath` / `args` NO. Inapplicable to an
	 *   already-running browser, but cosmetic or environmental: you get the browser
	 *   that is there, which is what reuse means. Documented on those options.
	 * - `env` / `readyTimeoutMs` NO. They affect how we DISCOVER and START a browser,
	 *   so they are meaningless when we start none.
	 */
	#misleadingIfReused(): string[] {
		return this.#options.proxy !== undefined &&
			this.#options.proxy.trim() !== ''
			? ['proxy']
			: [];
	}

	/**
	 * The endpoint of a browser ALREADY running against `profileDir`, or
	 * `undefined`.
	 *
	 * `DevToolsActivePort` is left behind on disk after Chrome exits, so its mere
	 * presence proves nothing; we read the port it names and then CHECK the
	 * endpoint actually answers. The check is a plain HTTP GET of the DevTools
	 * version route with a short timeout: no Playwright connection is made, so a
	 * stale file costs milliseconds and yields a clean "spawn a fresh one".
	 */
	async #findRunningBrowser(profileDir: string): Promise<string | undefined> {
		// One immediate read (timeoutMs 0): we are probing for an ALREADY-running
		// browser, not waiting for one to start. Liveness is checked through the SAME
		// probe `spawnRealChrome` uses to refuse spawning over a running browser, so
		// reuse here and refusal there can never disagree.
		const endpoint = await resolveCdpEndpoint(profileDir, {timeoutMs: 0});
		if (endpoint === undefined) {
			return undefined;
		}
		return (await isLiveDevToolsEndpoint(endpoint)) ? endpoint : undefined;
	}
}

/**
 * Wrap a session so closing it ALSO terminates the browser webhands spawned.
 *
 * The attach session's own `close()` only detaches (correct for a user's browser);
 * this adds the half that is specific to a browser we own. Order matters: detach
 * first so Playwright tears its connection down cleanly, THEN stop the process, so
 * Chrome gets a chance to flush the profile it owns rather than dying mid-write.
 */
function withSpawnedBrowserLifetime(
	session: Session,
	chrome: RealChrome,
): Session {
	let closed = false;
	return {
		page: session.page,
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			try {
				await session.close();
			} finally {
				// Always stop the browser, even if detaching failed: a stray Chrome
				// holding the profile dir would block the NEXT run.
				await chrome.close();
			}
		},
		waitForClose(): Promise<void> {
			return session.waitForClose();
		},
	};
}
