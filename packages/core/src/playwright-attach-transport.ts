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
 * How long to wait for the CDP connection to tear down in {@link Session.close}
 * before giving up on the WAIT (not on the teardown) and declaring the session
 * closed.
 *
 * Why a bound is needed at all: Playwright's `browser.close()` on a
 * `connectOverCDP` connection INTERMITTENTLY blocks for exactly 30 seconds.
 * Measured repeatedly against a separate-process Chromium here: most detaches
 * finish in 2 to 10ms, and some take 30008ms / 30229ms, i.e. a 30s internal
 * timeout being waited out rather than real work. Nothing in the result differs;
 * only the waiting does.
 *
 * Since the CDP connection carries no unflushed state we own (the BROWSER owns the
 * profile, and it keeps running either way, ADR-0002), waiting longer buys
 * nothing, while blocking `stop` for 30s is a visibly broken tool. So we bound the
 * wait and return; the underlying disconnect continues in the background and the
 * socket closes with it (or with the process, which is about to exit anyway).
 */
const DETACH_TIMEOUT_MS = 2_000;

/**
 * How long to wait for `connectOverCDP` to reach the endpoint before failing.
 *
 * Playwright's default is 30s, which is the wrong budget here: the browser we are
 * attaching to is ALREADY RUNNING (the user started it, or `--real-chrome` just
 * confirmed its debugging port is live), so a connection that has not landed in a
 * few seconds is a wrong endpoint, not a slow one. Waiting 30s to say "that port
 * is not a browser" trains the user to think the tool is hung.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * The `attach` concrete transport: connect (`chromium.connectOverCDP`) to a
 * browser the USER already started with remote debugging enabled, and reuse the
 * user's EXISTING authenticated context — `browser.contexts()[0]`, never
 * `newContext()` — so the controller drives the live, logged-in tabs on the
 * user's real fingerprint and IP (SPEC "Solution, attach"; ADR-0002).
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
 * There is NO browser-relaunch helper: a settled SPEC decision is that the user
 * starts their own browser with `--remote-debugging-port` and supplies the
 * resulting endpoint (SPEC "needsAnswers" #5). This transport only connects to a
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
		const browser = await chromium.connectOverCDP(target.endpoint, {
			timeout: CONNECT_TIMEOUT_MS,
		});

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
			// v1, SPEC Out of Scope).
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
/**
 * Await `work`, but give up WAITING after `ms` (the work itself continues).
 *
 * The timer is always cleared, which matters more than it looks: an uncancelled
 * `setTimeout` inside a `Promise.race` keeps the Node event loop alive for its full
 * duration after the fast path has already won. The `serve` CLI never noticed (its
 * signal handler calls `process.exit`), but every in-process consumer (the eval
 * harness, the test suite, any library user) would sit idle for the remainder of the
 * bound after a perfectly clean close.
 */
async function raceWithTimeout(
	work: Promise<unknown>,
	ms: number,
): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			work,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, ms);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

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
			// Claim the close BEFORE awaiting anything: the guard above reads a flag that
			// used to be set only at the END, so two concurrent `close()` calls both
			// disposed the hands and both detached. The bounded detach below widened that
			// window to a deterministic 2s, so the race stopped being theoretical.
			closed = true;
			// Dispose the hands first (their in-process resources), THEN detach from
			// the user's browser without terminating it. browser.close() fires
			// 'disconnected', which runs markClosed.
			await disposeHands();
			// BOUNDED: the detach is fire-and-mostly-forget because Playwright's CDP
			// close intermittently blocks 30s (see DETACH_TIMEOUT_MS). We still await
			// the common fast path, so an orderly disconnect stays orderly.
			await raceWithTimeout(
				browser.close().catch(() => {
					// A failed disconnect is not a failed close: the session is over for
					// this controller either way, and the user's browser is untouched.
				}),
				DETACH_TIMEOUT_MS,
			);
			markClosed();
		},
		waitForClose(): Promise<void> {
			return closedSignal;
		},
	};
}
