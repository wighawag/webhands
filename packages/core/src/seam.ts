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

/**
 * Options for the {@link WebHandsPage.eval} verb.
 *
 * This is an OPTIONS OBJECT, not a positional argument, on purpose (R1, the
 * reversibility invariant): the optional `frame` qualifier is an ADDITION to
 * this object, so a call passing no options keeps `eval`'s today behaviour
 * unchanged. `eval` is the ONE verb that carries a `frame?` qualifier, because
 * it runs page-world JS and CANNOT carry a `frameLocator(...)` expression the
 * way the locator-taking verbs do (the spike confirmed `ReferenceError`); the
 * other verbs reach a same-origin frame through a `frameLocator(...)` hop in
 * their locator string instead (R1).
 */
export interface EvalOptions {
	/**
	 * A transport-neutral SELECTOR for a SAME-ORIGIN child frame to evaluate the
	 * expression in — a CSS selector for the `<iframe>` element (e.g.
	 * `#main-iframe`), the form the single frame resolver understands. NEVER a
	 * Playwright `Frame` handle (no Playwright type crosses the seam, ADR-0003).
	 *
	 * Omitted == today's top-document `eval` (backward compatible). When given,
	 * the expression runs in the named frame and its result crosses the seam by
	 * the SAME structured-clone contract `eval` already has.
	 *
	 * SAME-ORIGIN ONLY: a cross-origin frame is a browser security boundary
	 * page-world JS cannot cross, so a selector that resolves to a CROSS-ORIGIN
	 * frame fails LOUD with a typed error (never a silent empty); cross-origin
	 * reach is the separate Tier-4 frameLocator/coordinate surface.
	 */
	readonly frame?: string;
}

/**
 * Options for the {@link WebHandsPage.script} verb (the driver-context `script`).
 *
 * An OPTIONS OBJECT, not positional fields, so future qualifiers stay additive
 * (mirrors {@link EvalOptions}/{@link QueryOptions}, R1). There are no options
 * today; the type exists so the verb's signature is already shaped for an
 * additive extension and so a `script` request can carry an options object the
 * day one is needed.
 */
export interface ScriptOptions {} // eslint-disable-line @typescript-eslint/no-empty-object-type

/** What to wait for in the {@link WebHandsPage.wait} verb. */
export type WaitCondition =
	| {readonly kind: 'timeout'; readonly ms: number}
	| {readonly kind: 'locator'; readonly target: LocatorString}
	| {readonly kind: 'navigation'};

/**
 * Which native `<select>` option the {@link WebHandsPage.select} verb chooses
 * (prd `broaden-agent-verb-surface`, Tier-2). EXACTLY ONE of `value` / `label`,
 * a discriminated union so the mutual exclusion is impossible to violate at the
 * seam (the CLI mirrors it with `wait`-style loud validation, R5):
 *
 * - `value` — match the option's `value` attribute (`<option value="v">`).
 * - `label` — match the option's VISIBLE label (its text), what a human reads.
 *
 * Plain strings only, so nothing Playwright-shaped crosses the seam (ADR-0003).
 */
export type SelectChoice = {readonly value: string} | {readonly label: string};

/**
 * Where the {@link WebHandsPage.scroll} verb scrolls (prd
 * `broaden-agent-verb-surface`, Tier-2). EXACTLY ONE of `to` / `by`, a
 * discriminated union mirroring `wait`'s mutually-exclusive forms:
 *
 * - `to` — bring the element a locator EXPRESSION addresses into view
 *   (`scrollIntoViewIfNeeded`); reach an off-viewport control.
 * - `by` — scroll the page by a pixel delta (`mouse.wheel`), `dx`/`dy` in
 *   CSS pixels (positive `dy` scrolls DOWN, the wheel convention).
 *
 * `to` carries a {@link LocatorString}; `by` carries plain numbers — no
 * Playwright type crosses the seam (ADR-0003).
 */
export type ScrollTarget =
	| {readonly to: LocatorString}
	| {readonly by: {readonly dx: number; readonly dy: number}};

/**
 * Which mouse button the {@link WebHandsPage.mouse} verb uses (prd
 * `broaden-agent-verb-surface`, Tier-4, R3; story 17). Plain string enum, the
 * Playwright `page.mouse` button vocabulary, so nothing Playwright-shaped
 * crosses the seam (ADR-0003 as amended by the Tier-4 ADR).
 */
export type MouseButton = 'left' | 'right' | 'middle';

/**
 * What the {@link WebHandsPage.mouse} verb does at the given coordinate (prd
 * `broaden-agent-verb-surface`, Tier-4, R3):
 *
 * - `'click'` — a full press-and-release at `(x, y)` (`mouse.click`).
 * - `'move'` — move the pointer to `(x, y)` without pressing (`mouse.move`),
 *   e.g. to trigger a hover affordance at a raw coordinate.
 * - `'down'` / `'up'` — press / release the button at the current position
 *   (`mouse.down` / `mouse.up`), the two halves of a manual drag.
 */
export type MouseAction = 'click' | 'move' | 'down' | 'up';

/**
 * A coordinate mouse input (prd `broaden-agent-verb-surface`, Tier-4, R3, story
 * 17). The coordinate-input counterpart to the locator-addressing `click`, for
 * the VISION/TILE captcha family and any task that must act at a raw pixel an
 * agent SAW in a screenshot rather than at a DOM element.
 *
 * COORDINATE FRAME (load-bearing). `x`/`y` are VIEWPORT CSS-pixels (the
 * Playwright `page.mouse` frame), NOT OS-level screen coordinates (webhands
 * never injects OS input). A pixel `(x, y)` in a VIEWPORT {@link Screenshot}
 * maps DIRECTLY to a `mouse` click `(x, y)` — that is the look-then-click
 * contract the agent relies on. A FULL-PAGE screenshot is NOT coordinate-matched
 * (it includes off-viewport content), so its pixels do not map to `mouse`
 * coordinates (see {@link ScreenshotScope}).
 *
 * Plain numbers + a string enum only, so nothing Playwright-shaped crosses the
 * seam (ADR-0003 as amended by the Tier-4 ADR).
 */
export interface MouseInput {
	/** What to do at the coordinate (click / move / down / up). */
	readonly action: MouseAction;
	/** Viewport CSS-pixel X (left-relative), the `page.mouse` frame. */
	readonly x: number;
	/** Viewport CSS-pixel Y (top-relative), the `page.mouse` frame. */
	readonly y: number;
	/** Which button for `click`/`down`/`up`. Defaults to `'left'`. */
	readonly button?: MouseButton;
}

/**
 * Which region a {@link WebHandsPage.screenshot} captures (prd
 * `broaden-agent-verb-surface`, Tier-4, R3; stories 17-19):
 *
 * - `'viewport'` — the DEFAULT: exactly the visible viewport. Its pixels are
 *   COORDINATE-MATCHED to the `mouse` verb (a pixel at `(x, y)` is the `mouse`
 *   click `(x, y)`), so it is the shot the look-then-click loop uses.
 * - `'full'` — the whole scrollable page (`fullPage`), for READING scrolled-out
 *   content. It is NOT coordinate-matched (it includes off-viewport content), so
 *   its pixels must NOT be fed back as `mouse` coordinates.
 * - `'element'` — clipped to the element a locator addresses (just the captcha
 *   widget, ideal for focusing a vision model). REQUIRES a
 *   {@link ScreenshotOptions.locator}; absent, the verb rejects LOUD (like
 *   `wait`'s mutually-exclusive validation).
 */
export type ScreenshotScope = 'viewport' | 'full' | 'element';

/**
 * Options for the {@link WebHandsPage.screenshot} verb (prd
 * `broaden-agent-verb-surface`, Tier-4, R3; R5). An OPTIONS OBJECT so future
 * fields stay additive (R1).
 *
 * The seam stays ADR-0003-clean (as amended by the Tier-4 ADR): the verb takes
 * STRINGS + an enum and returns a file PATH — NEVER image bytes.
 */
export interface ScreenshotOptions {
	/**
	 * Which region to capture. Defaults to `'viewport'` (the coordinate-matched
	 * shot the `mouse` loop uses). See {@link ScreenshotScope}.
	 */
	readonly scope?: ScreenshotScope;
	/**
	 * The element to clip to for `scope: 'element'`, a raw Playwright locator
	 * EXPRESSION resolved through the SAME resolver the other verbs use (so a
	 * `frameLocator(...)` hop reaches a frame widget). REQUIRED for `'element'`
	 * and rejected (loud, like `wait`) for the other scopes.
	 */
	readonly locator?: LocatorString;
	/**
	 * Caller override for the output PNG path. When omitted, webhands MINTS a
	 * unique path under its managed screenshots dir. When given, it is VALIDATED
	 * to stay UNDER that managed dir (a path that escapes it is rejected with a
	 * typed error), so the verb never writes to an arbitrary filesystem location.
	 * A plain string — no bytes cross the seam.
	 */
	readonly out?: string;
}

/**
 * The result of a {@link WebHandsPage.screenshot}: the file PATH webhands wrote
 * the PNG to, plus its pixel dimensions (prd `broaden-agent-verb-surface`,
 * Tier-4, R3, story 19).
 *
 * `path` is a plain STRING — the load-bearing ADR-0003 (as amended) choice: a
 * path, not image bytes, crosses the seam, so the seam stays string/number-typed
 * and the agent reads/attaches the file itself. `width`/`height` are the PNG's
 * pixel dimensions, so an agent knows the coordinate space of a VIEWPORT shot
 * before it maps a pixel to a `mouse` click.
 */
export interface Screenshot {
	/** The filesystem PATH of the written PNG (a string; never bytes). */
	readonly path: string;
	/** The PNG's pixel width. */
	readonly width: number;
	/** The PNG's pixel height. */
	readonly height: number;
}

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
 * The Playwright-locator-derived extras a {@link QueryRow} can carry under
 * `pw`. This is the ONLY fixed (closed) set in {@link QueryOptions}: these two
 * facts are NOT expressible as a DOM attribute or a live JS property, so they
 * cannot ride in `attrs`/`props` (which are caller-named and open). Everything
 * else the agent wants is named freely as an attribute or a property (R2, no
 * curated DOM field set).
 *
 * - `'visible'` — actionability-grade visibility (`locator.isVisible()`),
 *   strictly better than the `offsetParent` hack: a present-but-hidden element
 *   reads `false`.
 * - `'bbox'` — the element's bounding box (`locator.boundingBox()`) in VIEWPORT
 *   CSS-pixels, the coordinate frame the future Tier-4 `mouse` verb uses.
 */
export type PwExtra = 'visible' | 'bbox';

/**
 * An element's bounding box in VIEWPORT CSS-pixels, the value of a
 * {@link QueryRow}'s `pw.bbox`. Plain numbers only, so nothing Playwright-typed
 * crosses the seam (ADR-0003). `null` when the element has no box (e.g. it is
 * not rendered), mirroring `locator.boundingBox()`.
 */
export interface BoundingBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * Options for the {@link WebHandsPage.query} verb (R2).
 *
 * This is an OPTIONS OBJECT, not positional fields, on purpose (R1, the
 * reversibility invariant a reviewer checks): a future optional `frame?`
 * qualifier AND the T1b `ref` field are then PURE ADDITIONS to this object,
 * breaking no existing call. Do NOT turn these into positional arguments.
 *
 * There is NO curated DOM field set: a row carries EXACTLY what the caller
 * names here and nothing else. `attrs` and `props` are caller-named and OPEN
 * (the agent already knows DOM/Playwright vocabulary); `pw` is the one closed
 * set ({@link PwExtra}).
 *
 * `refs` is the OPT-IN durable-handle switch (R4): default `query` is a PURE
 * READ that mints nothing and returns no `ref`; `refs: true` adds a `ref` to
 * each row (see {@link QueryRow.ref}). It is a dedicated boolean, NOT a member
 * of `pw`, because a `ref` is not a Playwright-locator-derived FACT about the
 * element (the closed `pw` set) — it is an ADDRESS the agent acts on later. The
 * CLI exposes it as `--with-refs`.
 *
 * The `attrs` vs `props` split is deliberate and LOUD — webhands NEVER
 * auto-detects which of the two a name like `value`/`checked` means, because a
 * silent attribute-vs-property guess is the footgun this repo's "loud over
 * silent" style rejects.
 */
export interface QueryOptions {
	/**
	 * DOM ATTRIBUTES to read by name, via `getAttribute(name)` — what is written
	 * in the markup (`href`, `data-sitekey`, `type`). A missing attribute reads
	 * `null`.
	 */
	readonly attrs?: readonly string[];
	/**
	 * Live JS PROPERTIES to read by name, via `el[name]` — runtime state
	 * (`innerText`, `value`, `checked`, `selectedIndex`). `text` is just
	 * `props: ['innerText']`; there is no special `text` field.
	 */
	readonly props?: readonly string[];
	/**
	 * Playwright-locator-derived extras to include (the ONLY closed set; see
	 * {@link PwExtra}).
	 */
	readonly pw?: readonly PwExtra[];
	/** Bound the number of rows returned (token economy on a multi-match). */
	readonly limit?: number;
	/**
	 * Opt-in to a durable element {@link QueryRow.ref} per row (R4; finding
	 * `query-ref-mint-mechanism-attribute-beats-weakmap`). Default (omitted /
	 * `false`) keeps `query` a PURE READ: no `ref` field, and the page is NOT
	 * mutated. `true` computes a `ref` per matched element by the PREFERENCE
	 * LADDER — REUSE the element's own stable UNIQUE attribute when present
	 * (`id`/`data-testid`/…, ZERO DOM mutation), MINT a namespaced
	 * `data-webhands-ref` attribute ONLY as the fallback for an anonymous element.
	 *
	 * Mints are single-`query`-scoped: each `refs: true` query SWEEPS the prior
	 * query's mints first, so a ref can never match a stale element from two
	 * queries ago. An action verb resolves a `ref` with loud staleness detection
	 * (resolve-to-zero / resolve-to-many => {@link StaleRefError}); see
	 * {@link ActionOptions.byRef}.
	 */
	readonly refs?: boolean;
}

/**
 * One matched element's data, carrying EXACTLY the fields the caller named in
 * {@link QueryOptions} and nothing else (R2). A sub-object is present ONLY when
 * the caller asked for that family, and within it a key is present for every
 * name requested:
 *
 * - `attrs[name]` is the `getAttribute(name)` value (`null` if absent).
 * - `props[name]` is the live `el[name]` value, structurally cloned by VALUE
 *   (the same contract as `eval`; ADR-0003: no Playwright/CDP type leaks).
 * - `pw.visible` / `pw.bbox` are the requested {@link PwExtra} values.
 *
 * When `query` is called with NO fields, each row is an empty object `{}`: the
 * caller asked for nothing, so the row carries nothing (R2, "a row carries
 * EXACTLY what the caller asked for").
 */
export interface QueryRow {
	readonly attrs?: Readonly<Record<string, string | null>>;
	readonly props?: Readonly<Record<string, unknown>>;
	readonly pw?: {
		readonly visible?: boolean;
		readonly bbox?: BoundingBox | null;
	};
	/**
	 * The element's durable HANDLE, present ONLY when the caller asked
	 * ({@link QueryOptions.refs}). It is a LOCATOR STRING the agent feeds back to
	 * an action verb (`click`/`type`) with `{byRef: true}` to act on THIS element
	 * later even after the list mutates — fixing the index-drift footgun where a
	 * positional `.nth(i)` silently clicks the wrong row.
	 *
	 * It is computed by the LADDER (R4): when the element has a stable UNIQUE
	 * attribute it IS that real locator (`#buy-charlie`, `[data-testid="x"]`),
	 * durable across framework reconciliation and ZERO DOM mutation; otherwise it
	 * is a minted `[data-webhands-ref="<id>"]` selector. Either way it is a plain
	 * STRING resolved through the ONE existing resolver — no new addressing engine,
	 * no Playwright type on the seam (ADR-0003/0004). It is a SHORT-LIVED handle:
	 * acting on it after a NODE-REPLACEMENT re-render or a navigation fails LOUD
	 * with {@link StaleRefError}, never a silent wrong-element action.
	 */
	readonly ref?: string;
}

/**
 * Options for an ACTION verb that may act on a durable {@link QueryRow.ref}
 * instead of a raw locator (R4). An OPTIONS OBJECT so it is an ADDITIVE,
 * non-breaking extension of `click`/`type` (R1): a today call passing no options
 * is unchanged.
 *
 * `byRef: true` tells the verb its `target` is a `ref` from a prior
 * `query({refs: true})`, so it must enforce the loud-stale contract: resolve the
 * ref through the SAME single resolver, then assert it matches EXACTLY ONE
 * element — resolve-to-zero (removed/replaced) OR resolve-to-many (a cloned
 * subtree) BOTH reject with a typed {@link StaleRefError}, never a silent
 * wrong-element action. Omitted / `false` keeps the verb's plain locator
 * behaviour (auto-waiting, first-match), unchanged.
 */
export interface ActionOptions {
	readonly byRef?: boolean;
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
	/**
	 * Click the element addressed by a raw Playwright locator string.
	 *
	 * With `{byRef: true}` the `target` is treated as a durable
	 * {@link QueryRow.ref} from a prior `query({refs: true})`: it is resolved
	 * through the SAME resolver but MUST match EXACTLY ONE element, else a typed
	 * {@link StaleRefError} (resolve-to-zero / resolve-to-many) — the loud-stale
	 * guarantee that makes a ref strictly safer than a positional `.nth(i)`. The
	 * options object is additive (R1); omitted keeps today's plain-locator click.
	 */
	click(target: LocatorString, options?: ActionOptions): Promise<void>;
	/**
	 * Type text into the element addressed by a raw Playwright locator string.
	 *
	 * With `{byRef: true}` the `target` is a durable {@link QueryRow.ref}, resolved
	 * with the same EXACTLY-ONE loud-stale contract as {@link WebHandsPage.click}
	 * (a typed {@link StaleRefError} on zero/many). The options object is additive
	 * (R1); omitted keeps today's plain-locator type.
	 */
	type(
		target: LocatorString,
		text: string,
		options?: ActionOptions,
	): Promise<void>;
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
	 *
	 * FRAME SCOPE ({@link EvalOptions.frame}). With no `frame` this is exactly
	 * the top-document `eval` above. With a `frame` selector the expression runs
	 * in that NAMED SAME-ORIGIN child frame instead (e.g. to fire a captcha
	 * `data-callback` or read a runtime-only value the top document cannot see),
	 * returning by the same structured clone. The frame resolves through the
	 * SAME single resolver `click`/`type` use (a `frameLocator(...)` over the
	 * selector; R1), so there is no parallel frame-addressing path. A selector
	 * that resolves to a CROSS-ORIGIN frame REJECTS with a typed
	 * cross-origin-frame error (page-world JS cannot cross a security boundary),
	 * never a silent empty result.
	 */
	eval(expression: string, options?: EvalOptions): Promise<unknown>;
	/**
	 * Run a caller-supplied DRIVER-CONTEXT script against the live page and return
	 * its serializable result. Unlike {@link WebHandsPage.eval} (which runs a
	 * single page-world JS EXPRESSION via `page.evaluate`), `script` runs the
	 * caller's JS in the controller's OWN Node process and hands it the full
	 * Playwright `page` (the same live page the hands close over), so ONE call can
	 * locate + act + auto-wait + read a whole sub-flow the way the Playwright
	 * baseline writes by hand. This closes the "one process per action" gap: an
	 * agent batches a sub-flow into one turn against the page it ALREADY opened.
	 *
	 * `source` is JS that EVALUATES TO A FUNCTION taking the page, e.g.
	 * `async (page) => { await page.fill('#user', 'u'); await page.click('#go');
	 * return await page.locator('.list').count(); }` (a sync function is fine too;
	 * its return is awaited). The function is invoked with the live page and its
	 * (awaited) return value is the result. `script` does NOT supersede `eval`:
	 * the name + this contract signal you get the FULL Playwright `page` (DRIVER
	 * context), not a bigger page-world `eval`.
	 *
	 * SERIALIZATION CONTRACT (the load-bearing part, ADR-0003). The script runs
	 * IN-PROCESS, so its `page` API is plain Node JS, NOT the seam: there is no
	 * ADR-3 constraint on what the script CALLS. But the script's RETURN VALUE
	 * crosses the seam (and, over the served session, the RPC wire), so it MUST be
	 * SEAM-CLEAN: a serializable value with NO Playwright/CDP type in it (return a
	 * `.count()` number, a `.textContent()` string, a plain object — never a live
	 * `Locator`/`Page`/handle). A returned Playwright object does not round-trip;
	 * read a serializable property of it inside the script instead. A script that
	 * THROWS REJECTS with a transport-neutral `Error` carrying the message (no
	 * Playwright/CDP type leaks across the seam), exactly as `eval` does, so a
	 * thrown script is a CLEAN structured error, never a crash.
	 *
	 * TRUST: `script` is the SAME page-script code-execution surface as `eval`
	 * (caller JS against your own logged-in session, loopback-only), NOT the larger
	 * `hands.json` hand-loading / npm-dependency surface — no module is loaded,
	 * only a JS source string is read and run (see `docs/adr/0012`).
	 *
	 * The return type is `unknown` because the script decides the shape; callers
	 * narrow it (mirrors {@link WebHandsPage.eval}).
	 */
	script(source: string, options?: ScriptOptions): Promise<unknown>;
	/** Pace actions by waiting for a condition. */
	wait(condition: WaitCondition): Promise<void>;
	/** Read the session's cookies. */
	cookies(): Promise<readonly Cookie[]>;
	/** Seed the session's cookies. */
	setCookies(cookies: readonly Cookie[]): Promise<void>;
	/**
	 * Read STRUCTURED data out of the element(s) addressed by a raw Playwright
	 * locator string (ADR-0004; already frame-capable for same-origin frames via
	 * a `frameLocator(...)` expression). Returns ONE ROW PER MATCH, each carrying
	 * EXACTLY the fields named in {@link QueryOptions} — caller-named `attrs`
	 * (DOM attributes) and `props` (live JS properties), plus the closed `pw`
	 * extras (R2). This kills the `eval`-returns-a-JSON-string pattern.
	 *
	 * The options are an OPTIONS OBJECT so a future `frame?` field is a
	 * non-breaking addition (R1); the locator resolves through the SAME single
	 * resolver `click`/`type`/`wait` use — no parallel addressing scheme.
	 *
	 * With `{refs: true}` (OPT-IN) each row also carries a durable
	 * {@link QueryRow.ref} the agent feeds back to `click`/`type` (`{byRef: true}`)
	 * to act on THAT element after the page mutates, fixing the index-drift
	 * footgun. The default (no `refs`) is a PURE READ that mints nothing.
	 *
	 * Values cross by structured clone, the SAME contract as `eval` (ADR-0003: no
	 * Playwright/CDP types on the seam). With no fields requested, each row is an
	 * empty object.
	 */
	query(target: LocatorString, options?: QueryOptions): Promise<QueryRow[]>;
	/**
	 * The number of elements the locator matches (a property of the MATCH SET,
	 * not a row field). A thin shorthand over the same machinery as
	 * {@link WebHandsPage.query}.
	 */
	count(target: LocatorString): Promise<number>;
	/** Whether the locator matches at least one element (`count(target) > 0`). */
	exists(target: LocatorString): Promise<boolean>;
	/**
	 * The first match's actionability-grade visibility (its `pw:['visible']`): a
	 * present-but-hidden element reads `false`, and an ABSENT element reads
	 * `false` too (no match cannot be visible).
	 */
	isVisible(target: LocatorString): Promise<boolean>;
	/**
	 * The first match's `name` DOM attribute (its `attrs:[name]`), via
	 * `getAttribute`. `null` when the attribute is absent OR the locator matches
	 * no element — both "there is no such attribute value to read".
	 */
	getAttribute(target: LocatorString, name: string): Promise<string | null>;
	/**
	 * Press a keyboard key or chord (prd `broaden-agent-verb-surface`, Tier-2,
	 * story 8) — arrows, `Enter`, `Space`, a letter (`w`), or a chord like
	 * `Control+A`. The chord grammar is Playwright's `keyboard.press` grammar:
	 * `Modifier+Modifier+Key`, modifiers `Control`/`Alt`/`Shift`/`Meta`, key names
	 * like `ArrowLeft`/`Enter`/`a` (see the task's ## Decisions note). The key is a
	 * plain STRING, so nothing Playwright-shaped crosses the seam (ADR-0003).
	 *
	 * With `target`, the key is sent to the element that locator addresses (it is
	 * focused first, the `locator.press` semantics); WITHOUT it, the key is sent to
	 * the page's currently focused element (`keyboard.press`). `target` is an
	 * optional trailing arg so a future `frame?` stays additive (R1).
	 */
	press(key: string, target?: LocatorString): Promise<void>;
	/**
	 * Hover the pointer over the element a locator addresses (prd
	 * `broaden-agent-verb-surface`, Tier-2, story 9), to reveal a hover menu /
	 * on-hover control `click` cannot surface (`locator.hover`).
	 */
	hover(target: LocatorString): Promise<void>;
	/**
	 * Choose an option in the native `<select>` a locator addresses (prd
	 * `broaden-agent-verb-surface`, Tier-2, story 10), by `value` OR by `label`
	 * (EXACTLY ONE; see {@link SelectChoice}). Maps to Playwright
	 * `locator.selectOption`; the chosen option is reflected in the element's live
	 * state (its `value` / `selectedIndex`).
	 */
	select(target: LocatorString, choice: SelectChoice): Promise<void>;
	/**
	 * Scroll the page, either TO an element a locator addresses or BY a pixel
	 * delta (prd `broaden-agent-verb-surface`, Tier-2, story 11; EXACTLY ONE form,
	 * see {@link ScrollTarget}). `to` reaches lazy-loaded / off-viewport content
	 * (`scrollIntoViewIfNeeded`); `by` nudges the page a fixed amount
	 * (`mouse.wheel`).
	 */
	scroll(target: ScrollTarget): Promise<void>;
	/**
	 * Drag the element `source` addresses onto the element `target` addresses (prd
	 * `broaden-agent-verb-surface`, Tier-2, story 12), for drag-reorder UIs and
	 * drag-slider challenges (`locator.dragTo`). Both are raw locator EXPRESSIONS
	 * resolved through the SAME resolver as `click`/`type` (ADR-0004).
	 */
	drag(source: LocatorString, target: LocatorString): Promise<void>;
	/**
	 * Coordinate mouse input at VIEWPORT CSS-pixels (prd
	 * `broaden-agent-verb-surface`, Tier-4, R3, story 17): click / move / press /
	 * release at a raw `(x, y)` the agent SAW in a VIEWPORT {@link
	 * WebHandsPage.screenshot}, the input half of the look-then-click loop. This
	 * is the coordinate counterpart to the locator-addressing {@link
	 * WebHandsPage.click}, for the vision/tile captcha family and any pixel-level
	 * task. It uses Playwright `page.mouse` semantics (viewport-relative CSS
	 * pixels), NOT OS-level screen input — see {@link MouseInput}.
	 *
	 * Plain numbers + a string enum cross the seam (ADR-0003 as amended by the
	 * Tier-4 ADR); no Playwright/CDP type leaks.
	 */
	mouse(input: MouseInput): Promise<void>;
	/**
	 * Capture the page to a PNG FILE and return its PATH (prd
	 * `broaden-agent-verb-surface`, Tier-4, R3; stories 17-19). webhands MINTS the
	 * PNG under its managed screenshots dir and returns `{path, width, height}`;
	 * NO image bytes cross the seam (the load-bearing ADR-0003-as-amended choice),
	 * so an agent reads / attaches the file by path.
	 *
	 * Three scopes ({@link ScreenshotScope}): `viewport` (default,
	 * COORDINATE-MATCHED to {@link WebHandsPage.mouse} — a pixel `(x, y)` here is
	 * the `mouse` click `(x, y)`), `full` (the whole scrollable page, for reading
	 * scrolled-out content, NOT coordinate-matched), and `element` (clipped to the
	 * element a locator addresses; the locator is REQUIRED and validated loud like
	 * `wait`).
	 *
	 * A caller MAY override the path ({@link ScreenshotOptions.out}); it is
	 * validated to stay UNDER the managed dir (an escaping path rejects with a
	 * typed error), so the verb never writes to an arbitrary location.
	 */
	screenshot(options?: ScreenshotOptions): Promise<Screenshot>;
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
