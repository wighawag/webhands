import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page as PwPage,
} from 'playwright';
import {AttachNoContextError, AttachNotChromiumError} from './errors.js';
import {
	clickLocator,
	resolveLocator,
	waitFor,
} from './playwright-launch-transport.js';
import type {
	Cookie,
	OpenTarget,
	Page,
	Session,
	Snapshot,
	SnapshotOptions,
	Transport,
	WaitCondition,
} from './seam.js';

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
			return makeAttachedSession(browser, pwPage);
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
 * `close()` DISCONNECTS the controller from the user's browser; it must not
 * kill the browser the user started (`Browser.close()` on a `connectOverCDP`
 * connection detaches rather than terminating the remote process). We resolve
 * cookies through the reused context so they reflect the live, authenticated
 * session.
 */
function makeAttachedSession(browser: Browser, pwPage: PwPage): Session {
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

	const page: Page = {
		async navigate(url: string): Promise<void> {
			ensureOpen();
			// "Settled" = the `load` event; XHR/JS-rendered content that appears
			// after load is the `wait` verb's job. Same rationale (and the
			// no-`networkidle` reasoning) as the launch transport's `navigate`.
			await pwPage.goto(url, {waitUntil: 'load'});
		},
		async snapshot(options?: SnapshotOptions): Promise<Snapshot> {
			ensureOpen();
			const url = pwPage.url();
			if (options?.full === true) {
				const content = await pwPage.evaluate(
					() => document.documentElement.outerHTML,
				);
				return {url, view: 'full', content};
			}
			// Default: the token-cheap accessibility tree + visible text with stable
			// `[ref=...]` refs (see the launch transport and `Snapshot` for the
			// rationale; the string crosses the seam as opaque, transport-neutral
			// text, ADR-0003).
			const content = await pwPage.ariaSnapshot({mode: 'ai'});
			return {url, view: 'accessibility', content};
		},
		// `resolveLocator`/`clickLocator`/`waitFor` are imported from the launch
		// transport so both transports resolve locators and run the verbs through
		// ONE path (no parallel addressing scheme; the forward-note).
		async click(t): Promise<void> {
			ensureOpen();
			// Shared `clickLocator`: normal actionability-checked click with the
			// hidden-element dispatch fallback (PRD story 8), identical to launch.
			await clickLocator(pwPage, t);
		},
		async type(t, text): Promise<void> {
			ensureOpen();
			await resolveLocator(pwPage, t).fill(text);
		},
		async eval(expression: string): Promise<unknown> {
			ensureOpen();
			return pwPage.evaluate(expression);
		},
		async wait(condition: WaitCondition): Promise<void> {
			ensureOpen();
			// Identical to the launch transport (shared `waitFor`): selector /
			// navigation / timeout, so the verb behaves the same on both.
			await waitFor(pwPage, condition);
		},
		async cookies(): Promise<readonly Cookie[]> {
			ensureOpen();
			const raw = await context.cookies();
			return raw.map(toSeamCookie);
		},
		async setCookies(cookies): Promise<void> {
			ensureOpen();
			await context.addCookies(cookies.map(fromSeamCookie));
		},
	};

	return {
		page,
		async close(): Promise<void> {
			if (closed) {
				return;
			}
			// Detach from the user's browser; do NOT terminate it. This fires
			// 'disconnected', which runs markClosed.
			await browser.close();
			markClosed();
		},
		waitForClose(): Promise<void> {
			return closedSignal;
		},
	};
}

/** Map a Playwright cookie to the transport-neutral seam {@link Cookie}. */
function toSeamCookie(c: {
	name: string;
	value: string;
	domain?: string;
	path?: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: 'Strict' | 'Lax' | 'None';
}): Cookie {
	return {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires: c.expires,
		httpOnly: c.httpOnly,
		secure: c.secure,
		sameSite: c.sameSite,
	};
}

/** Map a seam {@link Cookie} to a Playwright cookie shape. */
function fromSeamCookie(c: Cookie) {
	return {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires: c.expires,
		httpOnly: c.httpOnly,
		secure: c.secure,
		sameSite: c.sameSite,
	};
}
