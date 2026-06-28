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
	 * Browser channel to launch (e.g. `'chrome'` to drive the system Chrome
	 * binary, Patchright's recommended setup). Applies to BOTH stealth and vanilla
	 * launches when set. When omitted, Playwright/Patchright's bundled Chromium is
	 * used.
	 */
	readonly channel?: string;
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
	readonly #channel: string | undefined;
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
	 *   toggle and optional browser `channel` (see
	 *   {@link PlaywrightLaunchTransportOptions}). Defaults to vanilla Playwright,
	 *   no channel, stealth OFF.
	 */
	constructor(
		location: ProfileLocationOptions = {},
		hands: readonly Hand[] = [],
		options: PlaywrightLaunchTransportOptions = {},
	) {
		this.#location = location;
		this.#hands = hands;
		this.#stealth = options.stealth === true;
		this.#channel = options.channel;
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

		// Launch options: forward headless, the optional channel (e.g.
		// channel: 'chrome' to drive system Chrome, Patchright's recommended
		// setup), and for stealth drop Playwright's automation-flavoured default
		// args so they cannot re-add the fingerprint Patchright just removed.
		const launchOptions: Parameters<
			typeof chromium.launchPersistentContext
		>[1] = {headless};
		if (this.#channel !== undefined) {
			launchOptions.channel = this.#channel;
		}
		if (this.#stealth) {
			launchOptions.ignoreDefaultArgs = ['--enable-automation'];
		}

		let context: BrowserContext;
		try {
			context = await launcher.launchPersistentContext(
				loc.profileDir,
				launchOptions,
			);
		} catch (cause) {
			if (isMissingBrowserBinary(cause)) {
				// With channel: 'chrome' the "binary missing" failure means the SYSTEM
				// Chrome is absent, not the bundled Chromium; name what is actually
				// missing so the CLI's fix message is accurate.
				const browser =
					this.#channel === undefined ? 'chromium' : this.#channel;
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
