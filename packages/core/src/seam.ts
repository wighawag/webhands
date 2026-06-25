/**
 * The verb-level transport seam.
 *
 * This is the highest test seam and the internal structure boundary of
 * `core` (see PRD "Testing Decisions" and `docs/adr/0003`). It is expressed
 * purely in terms of high-level VERBS (navigate, snapshot, click, type, eval,
 * wait, cookies), NOT in terms of CDP or Playwright primitives, so that a
 * future browser-extension transport or a non-Chromium (Firefox) transport
 * can implement it without changing the verb surface.
 *
 * RULES (load-bearing, do not relax without an ADR):
 * - No CDP / Chromium-only types may appear in this public surface
 *   (`docs/adr/0003`).
 * - Element addressing is a RAW PLAYWRIGHT LOCATOR STRING the active
 *   transport resolves (`docs/adr/0004`): "transport-neutral" means
 *   Playwright-equivalent addressing, not a reduced selector subset and not a
 *   structured JSON locator. We deliberately type it as a branded `string`
 *   rather than importing any Playwright `Locator` type, so no Playwright
 *   type leaks across the seam.
 */

/**
 * A raw Playwright locator string, e.g. `getByRole('button', { name: 'Search' })`.
 *
 * It is a plain `string` at runtime; the brand exists only so call sites are
 * explicit that this is a locator EXPRESSION the transport resolves (a sibling
 * to the `eval` escape hatch), not an opaque CSS selector or a structured
 * locator. Construct one with {@link locator}.
 */
export type LocatorString = string & {
	readonly __brand: 'PlaywrightLocatorString';
};

/** Tag a raw Playwright locator string as a {@link LocatorString}. */
export function locator(expression: string): LocatorString {
	return expression as LocatorString;
}

/**
 * How a {@link Transport} should obtain a browser session.
 *
 * Expressed in domain terms (a profile to launch, or a target to attach to),
 * never in CDP/Playwright terms. Concrete transports map these to their own
 * mechanism (Playwright `launchPersistentContext` / `connectOverCDP`, an
 * extension bridge, ...).
 */
export type OpenTarget =
	| {
			readonly mode: 'launch';
			/** Name of the dedicated profile the controller owns. */
			readonly profile: string;
			/** Whether the browser is visible. Defaults are a transport concern. */
			readonly headed?: boolean;
	  }
	| {
			readonly mode: 'attach';
			/**
			 * Opaque, transport-resolved endpoint of an already-running browser
			 * (e.g. a remote-debugging URL). Kept as a plain string so no
			 * CDP type leaks across the seam.
			 */
			readonly endpoint: string;
	  };

/** A single browser cookie, in transport-neutral terms. */
export interface Cookie {
	readonly name: string;
	readonly value: string;
	readonly domain?: string;
	readonly path?: string;
	readonly expires?: number;
	readonly httpOnly?: boolean;
	readonly secure?: boolean;
	readonly sameSite?: 'Strict' | 'Lax' | 'None';
}

/** What to wait for in the {@link Page.wait} verb. */
export type WaitCondition =
	| {readonly kind: 'timeout'; readonly ms: number}
	| {readonly kind: 'locator'; readonly target: LocatorString}
	| {readonly kind: 'navigation'};

/**
 * A structured, token-cheap view of the current page (accessibility tree +
 * visible text) with stable element refs. The exact shape is filled in by the
 * `snapshot` verb task; here it is left open so the seam compiles and stub
 * transports can round-trip it.
 */
export interface Snapshot {
	/** The page URL at snapshot time. */
	readonly url: string;
	/** Human/agent-readable structured page content. */
	readonly content: string;
}

/**
 * The page-level verb surface. One method per verb in the domain glossary.
 * All element addressing flows through {@link LocatorString}.
 */
export interface Page {
	/** Navigate the active page to a URL and let it settle. */
	navigate(url: string): Promise<void>;
	/** Return a structured, token-cheap view of the page. */
	snapshot(): Promise<Snapshot>;
	/** Click the element addressed by a raw Playwright locator string. */
	click(target: LocatorString): Promise<void>;
	/** Type text into the element addressed by a raw Playwright locator string. */
	type(target: LocatorString, text: string): Promise<void>;
	/** Run JavaScript in the page context and return its result. */
	eval(expression: string): Promise<unknown>;
	/** Pace actions by waiting for a condition. */
	wait(condition: WaitCondition): Promise<void>;
	/** Read the session's cookies. */
	cookies(): Promise<readonly Cookie[]>;
	/** Seed the session's cookies. */
	setCookies(cookies: readonly Cookie[]): Promise<void>;
}

/**
 * A live browser session owning one active {@link Page}. The session lifetime
 * spans from {@link Transport.open} to {@link Session.close}; it is the unit a
 * long-lived controller process keeps between CLI invocations (PRD
 * "session/daemon question").
 */
export interface Session {
	/** The active page the verbs act on. */
	readonly page: Page;
	/** Tear down the session and release the underlying browser resources. */
	close(): Promise<void>;
}

/**
 * The transport seam. A `Transport` (a.k.a. driver) knows how to OPEN a
 * {@link Session} for a given {@link OpenTarget}. v1 concrete transport is
 * Playwright (built in a later task); an extension or Firefox transport can
 * implement the same interface.
 */
export interface Transport {
	open(target: OpenTarget): Promise<Session>;
}

/** Alias: the seam is referred to as the `Driver` in the domain glossary. */
export type Driver = Transport;
