import {stat} from 'node:fs/promises';
import {chromium, type BrowserContext, type Page} from 'playwright';
import {
	MissingBrowserBinaryError,
	MissingProfileError,
	MissingStealthDependencyError,
} from './errors.js';
import {composeWithHands, type Hand, type HandContext} from './hand-host.js';
import {
	resolveProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';
import {hostResolverRulesArg, parseSocksProxy} from './socks-proxy.js';
import type {OpenTarget, Session, Transport} from './seam.js';

/**
 * The subset of Playwright's `chromium` browser type the launch transport uses.
 *
 * Patchright is an API-compatible Playwright fork, so its `chromium` has the
 * SAME shape (ADR-0003 stays intact: this structural type, like Playwright's
 * own types, is confined to this module and never crosses the seam). We type the
 * lazily-imported stealth chromium against THIS rather than importing any
 * Patchright type, so the dependency stays optional at the type level too.
 */
type ChromiumLauncher = Pick<typeof chromium, 'launchPersistentContext'>;

/** The shape `await import('patchright')` is expected to expose. */
interface StealthModule {
	readonly chromium: ChromiumLauncher;
}

/**
 * How the transport obtains the stealth (`patchright`) chromium. This is an
 * INTERNAL test seam, not a public API: tests inject a fake module (or a
 * rejecting importer) here so no real browser/Patchright is needed, exactly as
 * production uses the default lazy `import('patchright')`. It is deliberately
 * NOT on {@link OpenTarget} (ADR-0003: the seam stays free of Playwright/CDP/
 * Patchright concerns).
 */
export type StealthChromiumImporter = () => Promise<StealthModule>;

/**
 * Construction-time policy for {@link PlaywrightLaunchTransport}.
 *
 * Stealth is a TRANSPORT-CONSTRUCTION policy (which browser engine + launch
 * flags to use), not a per-open target detail, so it lives here and NOT on
 * {@link OpenTarget} (which stays Playwright/CDP-free per ADR-0003).
 */
export interface PlaywrightLaunchTransportOptions {
	/**
	 * Opt-in Patchright-backed stealth launch. Default `false` (vanilla
	 * Playwright). When `true`, the transport launches via the lazily-imported
	 * optional `patchright` package, which patches the CDP `Runtime.enable`
	 * automation tell that anti-bot WAFs detect (ADR-0002 keeps this as one extra
	 * layer, not a replacement for a real profile/IP). If `patchright` is not
	 * installed it throws {@link MissingStealthDependencyError}; it NEVER silently
	 * falls back to vanilla.
	 */
	readonly stealth?: boolean;
	/**
	 * Drive a browser ALREADY INSTALLED ON THE SYSTEM instead of the bundled
	 * Chromium, named by its install identity (e.g. `'chrome'` to drive the system
	 * Google Chrome, Patchright's recommended setup; also `'msedge'`,
	 * `'chrome-beta'`, ...). Applies to BOTH stealth and vanilla launches when set.
	 * When omitted, Playwright/Patchright's bundled Chromium is used.
	 *
	 * Maps to Playwright's `channel` launch option internally; we name it
	 * `systemBrowser` so the public surface speaks domain language ("use a browser
	 * I already have installed") rather than the Playwright term (ADR-0003 keeps
	 * Playwright vocabulary out of the public surface).
	 */
	readonly systemBrowser?: string;
	/**
	 * Don't impose a fixed emulated viewport: let the browser window drive its own
	 * size, exactly as a real user's browser does. Maps to Playwright's
	 * `viewport: null` on the persistent context.
	 *
	 * Why this matters for hardening: Playwright's DEFAULT is a fixed 1280x720
	 * emulated viewport that does NOT match the real OS window, a discrepancy
	 * (e.g. `window.outerWidth`/`innerWidth`/`screen` mismatches, no real resize
	 * behaviour) that fingerprinting scripts read as a headless/automation tell.
	 * Patchright's official recommended recipe sets `no_viewport=True` for this
	 * reason.
	 *
	 * Default: `undefined` leaves Playwright's behaviour as-is, EXCEPT that when
	 * {@link stealth} is enabled it defaults to `true` (the Patchright recipe).
	 * Pass an explicit `false` to keep the fixed emulated viewport even under
	 * stealth (e.g. when a caller deliberately wants a deterministic size). We pick
	 * the stealth-on default because shipping the stealth engine while leaving the
	 * tell it is meant to hide in place would be self-defeating; making it an
	 * explicit, overridable default keeps that honest and discoverable.
	 */
	readonly noViewport?: boolean;
	/**
	 * Extra command-line args appended to the browser launch (Playwright's
	 * `args`). An escape hatch for well-known hardening flags Patchright/Chromium
	 * users pass (e.g. `--disable-blink-features=AutomationControlled`) WITHOUT
	 * leaking a Playwright type across the seam: this is a plain `string[]`, kept
	 * confined to this transport-construction policy and deliberately NOT on
	 * {@link OpenTarget} (ADR-0003). Default: none.
	 *
	 * Caveat: args are passed THROUGH verbatim; a wrong or contradictory flag can
	 * itself become a tell or break the launch. Opt-in only.
	 */
	readonly extraLaunchArgs?: readonly string[];
	/**
	 * Passthrough for Playwright's `ignoreDefaultArgs`: either `true` to drop ALL
	 * of Playwright's default launch args, or a list of specific default args to
	 * drop, so a caller can strip more automation-flavoured defaults than the
	 * built-in stealth subset.
	 *
	 * When omitted, the stealth path still drops `--enable-automation` on its own
	 * (unchanged behaviour). When provided, this value REPLACES that built-in
	 * choice, so a caller opting in owns the full list (pass
	 * `['--enable-automation', ...]` to keep it). Like {@link extraLaunchArgs}
	 * this is a plain value confined to this module, never on {@link OpenTarget}.
	 * Default: none.
	 */
	readonly ignoreDefaultArgs?: boolean | readonly string[];
	/**
	 * Route ALL browser traffic AND DNS through a single SOCKS proxy, given as a
	 * SOCKS URL: `socks5h://host:1080` (or `socks5://host:1080`, optionally with a
	 * `user:pass@` userinfo). When set, the transport forwards the proxy to
	 * Playwright's `proxy` launch option AND adds Chromium's `--host-resolver-rules`
	 * catch-all so no DNS query escapes locally (see {@link proxyNoLeak}).
	 *
	 * Scheme convention: `socks5h://` means "resolve DNS at the proxy" (no leak),
	 * `socks5://` means "SOCKS5, local DNS allowed" (Chromium still resolves URL
	 * hostnames at the proxy, but its DNS prefetcher etc. may issue local DNS). Use
	 * {@link proxyNoLeak} to override the scheme's implied DNS behaviour. A
	 * malformed value throws the typed {@link InvalidProxyError} rather than
	 * launching unproxied. Default: no proxy.
	 */
	readonly proxy?: string;
	/**
	 * Override whether the {@link proxy} enforces NO local DNS. `true` forces the
	 * leak-free catch-all even for a plain `socks5://` URL; `false` allows local
	 * DNS even for a `socks5h://` URL. When omitted, the SCHEME decides
	 * (`socks5h` => no leak, `socks5`/`socks` => local DNS allowed). Ignored when
	 * {@link proxy} is unset.
	 */
	readonly proxyNoLeak?: boolean;
	/**
	 * INTERNAL test seam: override how the stealth chromium is imported. Omit in
	 * production (defaults to `import('patchright')`). See
	 * {@link StealthChromiumImporter}.
	 */
	readonly importStealthChromium?: StealthChromiumImporter;
}

/**
 * The package name of the optional stealth dependency. Kept as a runtime value
 * (not an `import('patchright')` literal) so TypeScript does NOT try to resolve
 * its types at build time, since it is an OPTIONAL dependency that is legitimately
 * absent when stealth is never enabled.
 */
const STEALTH_PACKAGE = 'patchright';

/** The default lazy import of the OPTIONAL `patchright` dependency. */
const defaultStealthImporter: StealthChromiumImporter = async () => {
	// Indirect (non-literal specifier) so tsc/bundlers do not resolve the
	// optional dep eagerly, and the module load never fails when it is absent;
	// the import only runs when stealth is opted in.
	const specifier = STEALTH_PACKAGE;
	return (await import(specifier)) as unknown as StealthModule;
};

/**
 * The v1 concrete transport: a Playwright browser the controller LAUNCHES
 * against a dedicated, persistent profile directory it owns (PRD "Solution,
 * launch"; ADR-0002). It implements the `core` {@link Transport}/`Driver` seam
 * with NO Playwright/CDP types in its public surface (ADR-0003): the
 * Playwright types are confined to this module.
 *
 * It handles ONLY `mode: 'launch'`. The `attach` mode (`connectOverCDP`) is a
 * SEPARATE transport (task `attach-transport-cdp-chromium`); calling `open`
 * with `mode: 'attach'` here throws, because mixing the two launch mechanisms
 * in one transport is what ADR-0003's seam exists to avoid.
 *
 * Profile location is resolved from the constructor options (or the
 * `WEBHANDS_HOME` env var, or `~/.webhands`). See
 * {@link resolveProfileLocation}. Because that is a SHARED location, tests pass
 * a temp `root` (or set the env var) and assert the real home is untouched.
 *
 * STEALTH (opt-in, default OFF): the third constructor arg can enable a
 * Patchright-backed launch ({@link PlaywrightLaunchTransportOptions}). Patchright
 * is an OPTIONAL dependency imported lazily only when stealth is enabled; if it
 * is absent the transport throws {@link MissingStealthDependencyError} rather
 * than falling back to vanilla. This addresses ONLY the CDP `Runtime.enable`
 * automation tell; a real profile/IP/session reputation still matter (ADR-0002).
 */
export class PlaywrightLaunchTransport implements Transport {
	readonly #location: ProfileLocationOptions;
	readonly #hands: readonly Hand[];
	readonly #stealth: boolean;
	readonly #systemBrowser: string | undefined;
	readonly #noViewport: boolean | undefined;
	readonly #extraLaunchArgs: readonly string[] | undefined;
	readonly #ignoreDefaultArgs: boolean | readonly string[] | undefined;
	readonly #proxy: string | undefined;
	readonly #proxyNoLeak: boolean | undefined;
	readonly #importStealthChromium: StealthChromiumImporter;

	/**
	 * @param location overrides for where profiles live (a `root` dir and/or an
	 *   `env`). Omit in production to use `~/.webhands`; pass a temp
	 *   `root` in tests to isolate the shared profile location.
	 * @param hands explicitly-loaded third-party hands to compose alongside the
	 *   built-ins (Phase 2, ADR-0007). These come from {@link loadHands} against
	 *   the operator's explicit config; the transport does NOT discover them. Omit
	 *   for the built-ins-only surface.
	 * @param options transport-construction policy, notably the opt-in `stealth`
	 *   toggle, optional `systemBrowser`, and the launch-hardening knobs
	 *   (`noViewport`, `extraLaunchArgs`, `ignoreDefaultArgs`; see
	 *   {@link PlaywrightLaunchTransportOptions}). Defaults to vanilla Playwright,
	 *   bundled Chromium, stealth OFF. The hardening knobs are confined to this
	 *   module and never reach {@link OpenTarget} (ADR-0003).
	 */
	constructor(
		location: ProfileLocationOptions = {},
		hands: readonly Hand[] = [],
		options: PlaywrightLaunchTransportOptions = {},
	) {
		this.#location = location;
		this.#hands = hands;
		this.#stealth = options.stealth === true;
		this.#systemBrowser = options.systemBrowser;
		this.#noViewport = options.noViewport;
		this.#extraLaunchArgs = options.extraLaunchArgs;
		this.#ignoreDefaultArgs = options.ignoreDefaultArgs;
		this.#proxy = options.proxy;
		this.#proxyNoLeak = options.proxyNoLeak;
		this.#importStealthChromium =
			options.importStealthChromium ?? defaultStealthImporter;
	}

	async open(target: OpenTarget): Promise<Session> {
		if (target.mode !== 'launch') {
			throw new Error(
				`PlaywrightLaunchTransport only handles 'launch'; ` +
					`'${target.mode}' is owned by the attach transport.`,
			);
		}

		const loc = resolveProfileLocation(target.profile, this.#location);

		// A profile is "set up" iff its dedicated dir exists on disk. Creating it
		// is the headed `setup-profile` flow's job (a later task); `launch`
		// against a missing profile is the typed MissingProfileError so the CLI
		// can tell the user to run `setup-profile` first (PRD story 17). We never
		// create the dir here, so a `launch` typo cannot silently spawn a blank
		// profile.
		if (!(await isExistingDirectory(loc.profileDir))) {
			throw new MissingProfileError(loc.profile, loc.profileDir);
		}

		const headless = target.headed !== true;

		// Pick the engine: the lazily-imported stealth (Patchright) chromium when
		// opted in, else vanilla Playwright's. Resolving the stealth module is where
		// an absent optional dependency surfaces as the typed
		// MissingStealthDependencyError (we never fall back to vanilla silently).
		const launcher = this.#stealth
			? await this.#resolveStealthLauncher()
			: chromium;

		// Launch options: forward headless, the optional systemBrowser (Playwright's
		// `channel`, e.g. 'chrome' to drive system Chrome, Patchright's recommended
		// setup), and for stealth drop Playwright's automation-flavoured default
		// args so they cannot re-add the fingerprint Patchright just removed.
		const launchOptions: Parameters<
			typeof chromium.launchPersistentContext
		>[1] = {headless};
		if (this.#systemBrowser !== undefined) {
			launchOptions.channel = this.#systemBrowser;
		}
		// no_viewport: explicit caller choice wins; otherwise default to TRUE under
		// stealth (Patchright's recommended recipe), and leave Playwright's default
		// fixed viewport in place when stealth is off. `viewport: null` is how
		// Playwright expresses "let the real window drive the size".
		const noViewport = this.#noViewport ?? this.#stealth;
		if (noViewport) {
			launchOptions.viewport = null;
		}
		// ignoreDefaultArgs: an explicit passthrough REPLACES the built-in stealth
		// choice (the caller then owns the full list). With no passthrough, the
		// stealth path keeps dropping just `--enable-automation` so it cannot re-add
		// the fingerprint Patchright just removed.
		if (this.#ignoreDefaultArgs !== undefined) {
			launchOptions.ignoreDefaultArgs =
				typeof this.#ignoreDefaultArgs === 'boolean'
					? this.#ignoreDefaultArgs
					: [...this.#ignoreDefaultArgs];
		} else if (this.#stealth) {
			launchOptions.ignoreDefaultArgs = ['--enable-automation'];
		}
		// Proxy: route ALL traffic + DNS through one SOCKS proxy. We parse the URL
		// HERE (a malformed value is the typed InvalidProxyError, never a silent
		// unproxied launch), forward it to Playwright's `proxy` option, and when
		// no-leak is in effect add Chromium's --host-resolver-rules catch-all so even
		// the DNS prefetcher cannot leak a raw local DNS query.
		const hardeningArgs: string[] = [];
		if (this.#proxy !== undefined && this.#proxy.trim() !== '') {
			const parsed = parseSocksProxy(this.#proxy, this.#proxyNoLeak);
			launchOptions.proxy = {
				server: parsed.server,
				...(parsed.username !== undefined ? {username: parsed.username} : {}),
				...(parsed.password !== undefined ? {password: parsed.password} : {}),
			};
			if (parsed.noLeak) {
				hardeningArgs.push(hostResolverRulesArg(parsed.host));
			}
		}
		// Extra launch args (the hardening escape hatch) are appended verbatim. We do
		// NOT set user-agent/locale/timezone/headers here: a wrong UA is a bigger
		// tell than none (Patchright warns against overriding them), so those stay
		// untouched by default. The proxy's no-leak DNS arg (if any) rides alongside.
		if (
			this.#extraLaunchArgs !== undefined &&
			this.#extraLaunchArgs.length > 0
		) {
			hardeningArgs.push(...this.#extraLaunchArgs);
		}
		if (hardeningArgs.length > 0) {
			launchOptions.args = hardeningArgs;
		}

		let context: BrowserContext;
		try {
			context = await launcher.launchPersistentContext(
				loc.profileDir,
				launchOptions,
			);
		} catch (cause) {
			if (isMissingBrowserBinary(cause)) {
				// With systemBrowser set (e.g. 'chrome') the "binary missing" failure
				// means the SYSTEM browser is absent, not the bundled Chromium; name
				// what is actually missing so the CLI's fix message is accurate.
				const browser = this.#systemBrowser ?? 'chromium';
				throw new MissingBrowserBinaryError(browser, undefined, {cause});
			}
			throw cause;
		}

		// launchPersistentContext always opens with exactly one page; reuse it as
		// the single active page (PRD: single active session in v1). Create one if
		// the build ever changes that invariant.
		const pwPage = context.pages()[0] ?? (await context.newPage());
		return makeSession(context, pwPage, this.#hands);
	}

	/**
	 * Resolve the stealth (`patchright`) chromium via the injected lazy importer.
	 *
	 * Confines the brittle "optional dependency absent" detection to ONE spot
	 * (mirroring {@link isMissingBrowserBinary}): any failure to import the
	 * optional package becomes the typed {@link MissingStealthDependencyError}, so
	 * the caller never silently degrades to vanilla Playwright.
	 */
	async #resolveStealthLauncher(): Promise<ChromiumLauncher> {
		let mod: StealthModule;
		try {
			mod = await this.#importStealthChromium();
		} catch (cause) {
			throw new MissingStealthDependencyError('patchright', undefined, {
				cause,
			});
		}
		if (
			mod === null ||
			typeof mod !== 'object' ||
			typeof mod.chromium?.launchPersistentContext !== 'function'
		) {
			throw new MissingStealthDependencyError('patchright');
		}
		return mod.chromium;
	}
}

/** True iff `path` exists and is a directory. */
async function isExistingDirectory(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Recognise Playwright's "browser executable doesn't exist" failure. Playwright
 * does not export a typed error for this, so we detect on the message (it
 * instructs the user to run `playwright install`). We confine that brittle
 * string match to this one spot and re-raise as a stable typed error.
 *
 * This also covers the `channel: 'chrome'` case, where the missing binary is the
 * SYSTEM Chrome, not the bundled Chromium. Playwright phrases that as the
 * channel/distribution not being found; we match those variants too so the
 * stealth+system-Chrome path still yields the typed MissingBrowserBinaryError.
 */
function isMissingBrowserBinary(cause: unknown): boolean {
	const message = cause instanceof Error ? cause.message : String(cause ?? '');
	return (
		/Executable doesn't exist/i.test(message) ||
		/please run the following command to download new browsers/i.test(
			message,
		) ||
		/playwright install/i.test(message) ||
		// channel: 'chrome' (or other system channels) not installed on the host.
		/Chromium distribution '.*' is not found/i.test(message) ||
		/No "?(chrome|msedge|chromium)"? .* found/i.test(message)
	);
}

/**
 * Wrap a live Playwright persistent context into the seam's {@link Session}.
 *
 * The VERB surface comes from the shared hand-host ({@link composeBuiltInPage}),
 * which is the single place the eight built-in verbs are composed (no duplicated
 * page-object literal). Only the SESSION LIFECYCLE is per-transport here: the
 * launch transport listens on the context's `'close'` event and its `close()`
 * calls `context.close()`, which KILLS the browser this transport spawned
 * (contrast the attach transport, which detaches without killing the user's
 * browser, ADR-0002).
 */
function makeSession(
	context: BrowserContext,
	pwPage: Page,
	extraHands: readonly Hand[],
): Session {
	let closed = false;
	const ensureOpen = () => {
		if (closed) {
			throw new Error('session is closed');
		}
	};

	// Resolves the first time the context is gone — whether the USER closed the
	// window (Playwright fires the context 'close' event) or our own close()
	// ran. This is what lets `setup-profile` hold the headed window open and
	// block on waitForClose() until the human is done.
	let resolveClosed!: () => void;
	const closedSignal = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	const markClosed = () => {
		if (closed) return;
		closed = true;
		resolveClosed();
	};
	context.on('close', markClosed);

	// Build the verb surface from the built-in hands over a live hand-context.
	// The host keeps the live `pwPage`/`context` in-process (they never cross the
	// seam, ADR-0003); the hand-context carries live page access only.
	const handContext: HandContext = {pwPage, context, ensureOpen};
	const {page, dispose: disposeHands} = composeWithHands(
		handContext,
		extraHands,
	);

	return {
		page,
		async close(): Promise<void> {
			if (closed) {
				return;
			}
			// Dispose the hands first (their in-process resources), THEN tear down
			// the browser: context.close() fires the 'close' event, which runs
			// markClosed and KILLS the browser this transport spawned.
			await disposeHands();
			await context.close();
			markClosed();
		},
		waitForClose(): Promise<void> {
			return closedSignal;
		},
	};
}
