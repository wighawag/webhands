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
 * Which page view a {@link Snapshot} carries.
 *
 * - `'accessibility'` — the DEFAULT, token-cheap structured view: the
 *   accessibility tree (roles + names) plus visible text, with stable element
 *   refs (see {@link Snapshot.content}). This is the cheap view an agent reads
 *   to decide what to act on WITHOUT parsing raw HTML.
 * - `'full'` — the raw DOM (serialized outer HTML), returned when the verb is
 *   called with {@link SnapshotOptions.full}. A settled PRD decision (story 7,
 *   `needsAnswers` Q3): default is the accessibility view, `--full` is raw DOM.
 */
export type SnapshotView = 'accessibility' | 'full';

/** Options for the {@link Page.snapshot} verb. */
export interface SnapshotOptions {
	/**
	 * When `true`, return the raw DOM (`view: 'full'`) instead of the default
	 * accessibility-tree + visible-text view. Maps to the CLI `--full` flag.
	 */
	readonly full?: boolean;
}

/**
 * A structured, token-cheap view of the current page with stable element refs.
 *
 * In the default `'accessibility'` view, {@link Snapshot.content} is the
 * accessibility tree (roles + accessible names) plus visible text, with each
 * actionable node carrying a stable `[ref=...]` element reference. The refs
 * are stable for an unchanged page (re-snapshotting yields the same refs), so
 * an agent can read the cheap view, pick a ref, and address that element
 * later. Snapshot refs and the raw Playwright-locator addressing (ADR-0004)
 * are COMPLEMENTARY ways to address elements, not competitors.
 *
 * The `content` string is a transport-neutral, human/agent-readable text
 * serialization (no CDP/Playwright types cross the seam, per ADR-0003). Its
 * concrete grammar is a transport detail; callers treat it as opaque,
 * token-cheap text to read, and parse refs out of it only by the documented
 * `[ref=...]` convention.
 */
export interface Snapshot {
	/** The page URL at snapshot time. */
	readonly url: string;
	/** Which view this snapshot carries (default vs `--full` raw DOM). */
	readonly view: SnapshotView;
	/** Human/agent-readable structured page content (see {@link Snapshot}). */
	readonly content: string;
}

/**
 * The page-level verb surface. One method per verb in the domain glossary.
 * All element addressing flows through {@link LocatorString}.
 */
export interface Page {
	/** Navigate the active page to a URL and let it settle. */
	navigate(url: string): Promise<void>;
	/**
	 * Return a structured, token-cheap view of the page. Defaults to the
	 * accessibility-tree + visible-text view with stable refs; pass
	 * `{full: true}` to get the raw DOM instead (PRD story 7).
	 */
	snapshot(options?: SnapshotOptions): Promise<Snapshot>;
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
