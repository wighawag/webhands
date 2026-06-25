import {stat} from 'node:fs/promises';
import {
	chromium,
	errors as pwErrors,
	type BrowserContext,
	type Page as PwPage,
} from 'playwright';
import {MissingBrowserBinaryError, MissingProfileError} from './errors.js';
import {
	resolveProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';
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
 */
export class PlaywrightLaunchTransport implements Transport {
	readonly #location: ProfileLocationOptions;

	/**
	 * @param location overrides for where profiles live (a `root` dir and/or an
	 *   `env`). Omit in production to use `~/.webhands`; pass a temp
	 *   `root` in tests to isolate the shared profile location.
	 */
	constructor(location: ProfileLocationOptions = {}) {
		this.#location = location;
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

		let context: BrowserContext;
		try {
			context = await chromium.launchPersistentContext(loc.profileDir, {
				headless,
			});
		} catch (cause) {
			if (isMissingBrowserBinary(cause)) {
				throw new MissingBrowserBinaryError('chromium', undefined, {cause});
			}
			throw cause;
		}

		// launchPersistentContext always opens with exactly one page; reuse it as
		// the single active page (PRD: single active session in v1). Create one if
		// the build ever changes that invariant.
		const pwPage = context.pages()[0] ?? (await context.newPage());
		return makeSession(context, pwPage);
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
 */
function isMissingBrowserBinary(cause: unknown): boolean {
	const message = cause instanceof Error ? cause.message : String(cause ?? '');
	return (
		/Executable doesn't exist/i.test(message) ||
		/please run the following command to download new browsers/i.test(
			message,
		) ||
		/playwright install/i.test(message)
	);
}

/** Wrap a live Playwright persistent context into the seam's {@link Session}. */
function makeSession(context: BrowserContext, pwPage: PwPage): Session {
	let closed = false;
	const ensureOpen = () => {
		if (closed) {
			throw new Error('session is closed');
		}
	};

	const page: Page = {
		async navigate(url: string): Promise<void> {
			ensureOpen();
			// "Settled" for `goto` = the `load` event: the document and its
			// subresources have loaded (PRD story 6, "navigate ... and wait for it
			// to settle"). We deliberately do NOT wait for `networkidle`:
			// Playwright discourages it, and it hangs forever on pages with
			// long-poll / streaming / analytics beacons (exactly the logged-in apps
			// this tool targets). Content rendered AFTER load (XHR-injected prices,
			// hydrated lists) is the job of the explicit `wait` verb (story 10), not
			// of `goto`.
			await pwPage.goto(url, {waitUntil: 'load'});
		},
		async snapshot(options?: SnapshotOptions): Promise<Snapshot> {
			ensureOpen();
			const url = pwPage.url();
			if (options?.full === true) {
				// `--full`: the raw DOM. `documentElement.outerHTML` is the serialized
				// live DOM (post-script render), which is what an agent that wants the
				// real HTML expects — not the original network response.
				const content = await pwPage.evaluate(
					() => document.documentElement.outerHTML,
				);
				return {url, view: 'full', content};
			}
			// Default: the token-cheap accessibility tree + visible text with stable
			// `[ref=...]` element refs. Playwright's `ariaSnapshot({mode: 'ai'})`
			// emits exactly that — a YAML aria tree (roles + accessible names +
			// text) where each node carries a stable `[ref=eN]` reference, assigned
			// deterministically by traversal order so re-snapshotting an unchanged
			// page yields the same refs. The string crosses the seam as opaque,
			// transport-neutral text (no Playwright type leaks, ADR-0003).
			const content = await pwPage.ariaSnapshot({mode: 'ai'});
			return {url, view: 'accessibility', content};
		},
		async click(t): Promise<void> {
			ensureOpen();
			await clickLocator(pwPage, t);
		},
		async type(t, text): Promise<void> {
			ensureOpen();
			await resolveLocator(pwPage, t).fill(text);
		},
		async eval(expression: string): Promise<unknown> {
			ensureOpen();
			// The `eval` escape hatch (PRD story 9): run the raw JS EXPRESSION in the
			// page and return its serializable result. Playwright's `evaluate`
			// already IS the seam's serialization contract (see {@link Page.eval}):
			// it passes a string as an expression, awaits a returned Promise, and
			// structurally clones the result out of the page by VALUE. That clone is
			// richer than JSON: it preserves NaN/Infinity/BigInt and circular
			// structures (back-refs become a `[Circular]` marker), yields `undefined`
			// for functions/symbols, and returns an opaque preview string for a live
			// host object (a DOM node never crosses the process boundary). A page-side
			// throw rejects. We pass it straight through rather than re-encode it:
			// wrapping the value in a transport-specific envelope would invent a
			// dialect the seam deliberately avoids. The thrown error is a plain
			// `Error`, so no Playwright/CDP type leaks across the seam (ADR-0003).
			return pwPage.evaluate(expression);
		},
		async wait(condition: WaitCondition): Promise<void> {
			ensureOpen();
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
			if (closed) return;
			closed = true;
			await context.close();
		},
	};
}

/**
 * Run the `wait` verb's three forms (PRD story 10) against a Playwright page.
 *
 * - `timeout` — pace by a fixed delay (`waitForTimeout`), so an agent can act
 *   like a human and let XHR-rendered content land.
 * - `locator` — block until the addressed element appears (`Locator.waitFor()`),
 *   the form for content rendered AFTER `goto` settled on `load`.
 * - `navigation` — block until the NEXT navigation settles to `load`. We use
 *   `waitForNavigation()` even though Playwright marks it `@deprecated` ("racy,
 *   use waitForURL"): that deprecation targets in-process TEST code that can arm
 *   the wait BEFORE the action and pass a target URL. Neither holds here. Across
 *   this seam verbs are DISCRETE sequential calls (`click` then `wait`), so we
 *   CANNOT arm before the trigger; and the realistic trigger is an async,
 *   JS-driven transition (a redirect / SPA route change that fires AFTER the
 *   agent's action, the "let XHR-rendered content load" case of story 10), so
 *   "wait for the NEXT navigation" is exactly right — whereas `waitForLoadState`
 *   would see the already-loaded current page and return before the pending
 *   transition. `waitForURL` is unusable because the verb has no target URL by
 *   design (the agent waits for "a navigation", not a known address). (See the
 *   task's ## Decisions note.)
 *
 * Shared by both Playwright transports so the verb behaviour stays identical
 * (the forward-note's "do NOT write a parallel second implementation").
 */
export async function waitFor(
	page: PwPage,
	condition: WaitCondition,
): Promise<void> {
	switch (condition.kind) {
		case 'timeout':
			await page.waitForTimeout(condition.ms);
			return;
		case 'locator':
			await resolveLocator(page, condition.target).waitFor();
			return;
		case 'navigation':
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			await page.waitForNavigation();
			return;
	}
}

/**
 * Resolve a raw Playwright locator EXPRESSION (ADR-0004) against the page. The
 * verb surface passes locator expressions like `getByRole('button', …)`; we
 * evaluate them in a small sandbox where `page`/`p` is the page, so the full
 * Playwright locator grammar is available without leaking the type across the
 * seam.
 *
 * Exported (with {@link clickLocator}/{@link waitFor}) so the attach transport
 * resolves locators IDENTICALLY — one resolution path, no parallel addressing
 * scheme (the forward-note's "do NOT write a parallel second implementation").
 */
export function resolveLocator(page: PwPage, expression: string) {
	// eslint-disable-next-line no-new-func
	const factory = new Function('page', 'p', `return (${expression});`) as (
		page: PwPage,
		p: PwPage,
	) => ReturnType<PwPage['locator']>;
	return factory(page, page);
}

/**
 * How long a normal, actionability-checked `click` may wait before we treat the
 * element as un-clickable and fall back to a dispatched click. Short on purpose:
 * a hidden custom input never becomes actionable, so the regular click would
 * otherwise burn Playwright's full default timeout (30s) before the escape path
 * runs. The visible-element happy path clicks immediately and never hits this;
 * this bound is the latency cost paid ONLY on the hidden/non-actionable path,
 * and is long enough to tolerate a slow-but-eventually-actionable element
 * (animations, late layout) before deciding to dispatch.
 */
const NORMAL_CLICK_TIMEOUT_MS = 1_000;

/**
 * Run the `click` verb against a Playwright page (PRD story 8), shared by both
 * Playwright transports so the verb behaves identically (mirrors {@link waitFor};
 * the forward-note's "do NOT write a parallel second implementation").
 *
 * First try a normal `Locator.click()`, which AUTO-WAITS for the element to be
 * visible and actionable — the right behaviour for a real button. A hidden
 * custom input (the case the prd calls out) NEVER becomes actionable, so that
 * click times out; on a Playwright `TimeoutError` we fall back to
 * `dispatchEvent('click')`, which fires a click WITHOUT the actionability
 * checks. The fallback is deliberately the documented Playwright escape (a
 * sibling to the `eval` hatch, ADR-0004), not a reimplemented click: we keep
 * the locator a raw resolved expression and only change HOW the resolved
 * locator is clicked.
 *
 * Only a timeout triggers the fallback. The fallback `dispatchEvent` is itself
 * bounded by the same short timeout, so a locator that resolves NO element (a
 * bad locator) surfaces its timeout quickly instead of hanging the dispatch on
 * Playwright's 30s default — the dispatch escape is for elements that EXIST but
 * are not actionable (hidden custom inputs), not for absent ones.
 */
export async function clickLocator(
	page: PwPage,
	expression: string,
): Promise<void> {
	const target = resolveLocator(page, expression);
	try {
		await target.click({timeout: NORMAL_CLICK_TIMEOUT_MS});
	} catch (cause) {
		if (!(cause instanceof pwErrors.TimeoutError)) {
			throw cause;
		}
		// The element never became actionable (e.g. a hidden custom input). Fire
		// the click without actionability checks, the prd's explicit escape path.
		await target.dispatchEvent('click', {timeout: NORMAL_CLICK_TIMEOUT_MS});
	}
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
