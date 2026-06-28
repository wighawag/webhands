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

/** What to wait for in the {@link WebHandsPage.wait} verb. */
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

/**
 * Options for the {@link WebHandsPage.snapshot} verb.
 *
 * `full` is the ONLY recognised key. Unknown keys are REJECTED (not silently
 * ignored) by {@link validateSnapshotOptions}, which every entry point calls:
 * passing `{view: 'full'}` (a natural mistake, because the RESULT carries a
 * {@link SnapshotView} `view` field) throws a clear error instead of silently
 * returning the wrong view. There is no `view` option; `view` is a RESULT
 * field, set by the verb from `full`.
 */
export interface SnapshotOptions {
	/**
	 * When `true`, return the raw DOM (`view: 'full'`) instead of the default
	 * accessibility-tree + visible-text view. Maps to the CLI `--full` flag.
	 */
	readonly full?: boolean;
}

/**
 * Validate a {@link SnapshotOptions} value at a verb entry point, the SINGLE
 * source of truth shared by the in-process host and the RPC server dispatch so
 * neither path can silently drop a misspelled option.
 *
 * Accepts `undefined`, `{}`, and `{full: boolean}`. REJECTS any object carrying
 * a key other than `full`, and a non-boolean `full`, by throwing a clear `Error`
 * that names the offending key and hints the right one (e.g. `{view: 'full'}`
 * throws `snapshot: unknown option "view" (did you mean { full: true }?)`).
 *
 * This turns a silent wrong-result into a loud error: it does not change
 * behaviour for any valid input. Returns the validated options unchanged so it
 * can wrap a call site inline.
 */
export function validateSnapshotOptions(
	options?: SnapshotOptions,
): SnapshotOptions | undefined {
	if (options === undefined) {
		return options;
	}
	if (typeof options !== 'object' || options === null) {
		throw new Error(
			`snapshot: options must be an object like { full: true }, got ${typeof options}`,
		);
	}
	const unknownKeys = Object.keys(options).filter((key) => key !== 'full');
	if (unknownKeys.length > 0) {
		const named = unknownKeys.map((key) => `"${key}"`).join(', ');
		throw new Error(
			`snapshot: unknown option ${named} (did you mean { full: true }?)`,
		);
	}
	if (options.full !== undefined && typeof options.full !== 'boolean') {
		throw new Error(
			`snapshot: option "full" must be a boolean, got ${typeof options.full}`,
		);
	}
	return options;
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
export interface WebHandsPage {
	/** Navigate the active page to a URL and let it settle. */
	navigate(url: string): Promise<void>;
	/**
	 * Return a structured, token-cheap view of the page. Defaults to the
	 * accessibility-tree + visible-text view with stable refs; pass
	 * `{full: true}` to get the raw DOM instead (PRD story 7). An unknown or
	 * misshapen option REJECTS (e.g. `{view: 'full'}`), it is never silently
	 * ignored (see {@link validateSnapshotOptions}).
	 */
	snapshot(options?: SnapshotOptions): Promise<Snapshot>;
	/** Click the element addressed by a raw Playwright locator string. */
	click(target: LocatorString): Promise<void>;
	/** Type text into the element addressed by a raw Playwright locator string. */
	type(target: LocatorString, text: string): Promise<void>;
	/**
	 * Run a JavaScript EXPRESSION in the active page's context and return its
	 * result, the `eval` escape hatch for cases no other verb covers (PRD story
	 * 9). It sits naturally beside the raw-locator addressing (ADR-0004): both are
	 * page-context expressions the transport resolves.
	 *
	 * `expression` is evaluated AS AN EXPRESSION (not a function body), so its
	 * value is the result: `'1 + 2'` yields `3`, `"document.title"` yields the
	 * title. If it evaluates to a Promise, the transport awaits it and returns the
	 * resolved value.
	 *
	 * SERIALIZATION CONTRACT (the load-bearing part). The result must cross the
	 * seam by VALUE: it is structurally cloned out of the page context, not
	 * handed back as a live reference. The transport, not this verb, owns the
	 * serialization, and its behaviour is the documented contract callers rely
	 * on. It is RICHER than `JSON.stringify` (do not reason about it as JSON):
	 * - Primitives, plain objects, and arrays round-trip faithfully, including
	 *   nested structures.
	 * - `undefined` round-trips as `undefined`; `null` as `null`.
	 * - Non-finite numbers (`NaN`, `Infinity`, `-0`) and `BigInt` are PRESERVED
	 *   as their real JS values (unlike JSON, which would lose them).
	 * - A circular structure is PRESERVED, with each back-reference replaced by a
	 *   `[Circular]` marker (it does NOT throw).
	 * - Values with no transferable form (functions, symbols) come back as
	 *   `undefined`; a `Date` comes back as a `Date`; `Map`/`Set` come back as an
	 *   empty object `{}` (their entries do not survive the clone).
	 * - Live host objects (a DOM node, `window`) come back as an OPAQUE PREVIEW
	 *   STRING, NOT the live object: it cannot cross the process boundary, so the
	 *   escape hatch hands back a readable stand-in rather than a broken handle.
	 *   An agent that needs a DOM value reads a serializable property of it
	 *   (`...textContent`, `...value`) inside the expression, exactly as the
	 *   tests do.
	 * - An expression that THROWS in the page REJECTS with a transport-neutral
	 *   `Error` carrying the page-side message (no CDP/Playwright type leaks
	 *   across the seam, ADR-0003).
	 *
	 * The return type is `unknown` because the page decides the shape; callers
	 * narrow it. This is deliberately a thin passthrough to the transport's
	 * serialize-and-return: `eval` does not re-encode or wrap the result, so an
	 * agent gets exactly what the page produced.
	 */
	eval(expression: string): Promise<unknown>;
	/** Pace actions by waiting for a condition. */
	wait(condition: WaitCondition): Promise<void>;
	/** Read the session's cookies. */
	cookies(): Promise<readonly Cookie[]>;
	/** Seed the session's cookies. */
	setCookies(cookies: readonly Cookie[]): Promise<void>;
}

/**
 * A live browser session owning one active {@link WebHandsPage}. The session lifetime
 * spans from {@link Transport.open} to {@link Session.close}; it is the unit a
 * long-lived controller process keeps between CLI invocations (PRD
 * "session/daemon question").
 */
export interface Session {
	/** The active page the verbs act on. */
	readonly page: WebHandsPage;
	/** Tear down the session and release the underlying browser resources. */
	close(): Promise<void>;
	/**
	 * Resolve when the session is closed — either by the USER closing the browser
	 * window/context, or by a {@link Session.close} call. This is what lets a
	 * headed flow (notably `setup-profile`) HOLD the window open and block until
	 * the human is done, instead of tearing it down immediately. Resolves once
	 * (idempotent); resolves immediately if the session is already closed.
	 */
	waitForClose(): Promise<void>;
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
