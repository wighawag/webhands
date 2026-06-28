import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page,
} from 'playwright';
import {AttachNoContextError, AttachNotChromiumError} from './errors.js';
import {composeWithHands, type Hand, type HandContext} from './hand-host.js';
import {
	resolveScreenshotsDir,
	type ProfileLocationOptions,
} from './profile-location.js';
import type {OpenTarget, Session, Transport} from './seam.js';

/**
 * The `attach` concrete transport: connect (`chromium.connectOverCDP`) to a
 * browser the USER already started with remote debugging enabled, and reuse the
 * user's EXISTING authenticated context — `browser.contexts()[0]`, never
 * `newContext()` — so the controller drives the live, logged-in tabs on the
 * user's real fingerprint and IP (PRD "Solution, attach"; ADR-0002).
 *
 * CDP-attach is Chromium-only (ADR-0003: Firefox attaches via a different
 * mechanism). That constraint is SURFACED as a typed `core` error
 * ({@link AttachNotChromiumError}) rather than leaking any CDP/Chromium-only
 * type into the seam: the Playwright/CDP types are confined to this module and
 * the seam stays transport-neutral (ADR-0003).
 *
 * It handles ONLY `mode: 'attach'`. `mode: 'launch'` is a SEPARATE transport
 * ({@link PlaywrightLaunchTransport}); calling `open` with `mode: 'launch'`
 * here throws, because mixing the two open mechanisms in one transport is what
 * ADR-0003's seam exists to avoid.
 *
 * There is NO browser-relaunch helper: a settled PRD decision is that the user
 * starts their own browser with `--remote-debugging-port` and supplies the
 * resulting endpoint (PRD "needsAnswers" #5). This transport only connects to a
 * running one.
 */
export class PlaywrightAttachTransport implements Transport {
	readonly #hands: readonly Hand[];
	readonly #location: ProfileLocationOptions;

	/**
	 * @param hands explicitly-loaded third-party hands to compose alongside the
	 *   built-ins (Phase 2, ADR-0007). These come from {@link loadHands} against
	 *   the operator's explicit config; the transport does NOT discover them. Omit
	 *   for the built-ins-only surface.
	 * @param location overrides for the controller home root, used ONLY to resolve
	 *   the managed SCREENSHOTS dir (`<homeRoot>/screenshots`) the Tier-4
	 *   `screenshot` verb mints under — attach reuses the user's own browser, so it
	 *   owns no profile dir, but the screenshot output location still honours the
	 *   same `root`/`WEBHANDS_HOME` override so a test can isolate it. Omit in
	 *   production to use `~/.webhands/screenshots`.
	 */
	constructor(
		hands: readonly Hand[] = [],
		location: ProfileLocationOptions = {},
	) {
		this.#hands = hands;
		this.#location = location;
	}

	async open(target: OpenTarget): Promise<Session> {
		if (target.mode !== 'attach') {
			throw new Error(
				`PlaywrightAttachTransport only handles 'attach'; ` +
					`'${target.mode}' is owned by the launch transport.`,
			);
		}

		// `endpoint` is the opaque, transport-resolved remote-debugging endpoint
		// (e.g. `http://127.0.0.1:9222`). The seam keeps it a plain string so no
		// CDP type leaks (ADR-0003); this transport interprets it as a CDP URL.
		const browser = await chromium.connectOverCDP(target.endpoint);

		try {
			// CDP-attach is Chromium-only. If the reached engine is not Chromium,
			// refuse with a typed condition instead of driving an unsupported
			// browser (Firefox attaches differently — ADR-0003).
			const engine = browser.browserType().name();
			if (engine !== 'chromium') {
				throw new AttachNotChromiumError(engine);
			}

			// Reuse the EXISTING authenticated context, never `newContext()`
			// (ADR-0002): a fresh context would discard the user's live login.
			const context = browser.contexts()[0];
			if (context === undefined) {
				throw new AttachNoContextError(target.endpoint);
			}

			// Drive the context's existing active page; open one only if the
			// browser exposes a context with no page yet (single active session in
			// v1, PRD Out of Scope).
			const pwPage = context.pages()[0] ?? (await context.newPage());
			const screenshotsDir = resolveScreenshotsDir(this.#location);
			return makeAttachedSession(browser, pwPage, this.#hands, screenshotsDir);
		} catch (cause) {
			// On any open-time refusal, disconnect from the user's browser without
			// closing it (a CDP connection close detaches; it does not kill the
			// browser the user started).
			await browser.close().catch(() => {});
			throw cause;
		}
	}
}

/**
 * Wrap a CDP-attached browser into the seam's {@link Session}.
 *
 * The VERB surface comes from the shared hand-host ({@link composeBuiltInPage}),
 * the SAME single composition the launch transport uses (no duplicated
 * page-object literal). Cookies resolve through the reused context (derived here
 * via `pwPage.context()`) so they reflect the live, authenticated session.
 *
 * Only the SESSION LIFECYCLE is per-transport: this transport listens on the
 * browser's `'disconnected'` event and its `close()` calls `browser.close()`,
 * which DISCONNECTS the controller from the user's browser WITHOUT killing it
 * (a `connectOverCDP` connection detaches rather than terminating the remote
 * process, ADR-0002) — the opposite of the launch transport, which kills the
 * browser it spawned.
 */
function makeAttachedSession(
	browser: Browser,
	pwPage: Page,
	extraHands: readonly Hand[],
	screenshotsDir: string,
): Session {
	const context: BrowserContext = pwPage.context();
	let closed = false;
	const ensureOpen = () => {
		if (closed) {
			throw new Error('session is closed');
		}
	};

	// Resolves when the session ends: either the user's browser goes away
	// (Playwright fires 'disconnected' on a connectOverCDP browser) or our own
	// close() disconnects. Lets a caller block until the session is gone.
	let resolveClosed!: () => void;
	const closedSignal = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	const markClosed = () => {
		if (closed) return;
		closed = true;
		resolveClosed();
	};
	browser.on('disconnected', markClosed);

	// Build the verb surface from the built-in hands over a live hand-context —
	// the same shared host the launch transport uses, so the verbs behave
	// identically across both transports. The live `pwPage`/`context` stay
	// in-process and never cross the seam (ADR-0003).
	const handContext: HandContext = {
		pwPage,
		context,
		ensureOpen,
		screenshotsDir,
	};
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
			// Dispose the hands first (their in-process resources), THEN detach from
			// the user's browser without terminating it. browser.close() fires
			// 'disconnected', which runs markClosed.
			await disposeHands();
			await browser.close();
			markClosed();
		},
		waitForClose(): Promise<void> {
			return closedSignal;
		},
	};
}
