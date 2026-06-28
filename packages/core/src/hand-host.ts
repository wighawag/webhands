import {
	errors as pwErrors,
	type BrowserContext,
	type Locator,
	type Page,
} from 'playwright';
import type {
	BoundingBox,
	Cookie,
	WebHandsPage,
	QueryOptions,
	QueryRow,
	ScrollTarget,
	SelectChoice,
	Snapshot,
	SnapshotOptions,
	WaitCondition,
} from './seam.js';
import {validateSnapshotOptions} from './seam.js';

/**
 * The hand-host primitive (Phase 1 of the "hands" prd,
 * `work/prds/tasked/hands-pluggable-page-capabilities.md`).
 *
 * A **hand** is in-process code that closes over the WebHandsPage and contributes named
 * verbs (+ an optional `dispose`). This module is the host: it builds the
 * scoped-but-LIVE {@link HandContext} from the live Playwright objects, lets
 * each hand contribute its verbs, and composes them into the same {@link WebHandsPage}
 * object the seam already exposes (see {@link composePage}).
 *
 * webhands' OWN eight verbs are themselves built-in hands over this host
 * ({@link BUILT_IN_HANDS}), so the primitive is proven by self-application: if
 * it can express webhands' `click`/`snapshot`/`cookies`, it can host a
 * third-party hand the same way (Phase 2). This is a purely INTERNAL,
 * behavior-preserving refactor — the verb composition that lived as a
 * duplicated `page` object literal in BOTH Playwright transports now lives here
 * once.
 *
 * INTERNAL-ONLY BOUNDARY (the prd's resolved Q2): this whole module is
 * package-internal. {@link Hand}/{@link HandContext}/{@link composePage} are
 * NOT exported from the package entry point (`index.ts`) in Phase 1; they go
 * public in the separate Phase 2 task. The public seam (`seam.ts`) is
 * unchanged.
 *
 * NO-LEAK / CROSS-BROWSER (ADR-0003, refined by the prd): the host is built
 * INSIDE the Playwright transport(s) and uses only the Playwright
 * `Page`/`BrowserContext` API — no CDP/Chromium-only types — so the live
 * `pwPage` stays in-process and never crosses the seam, and the host introduces
 * no Chromium-only dependency that would foreclose a future Firefox launch
 * (only CDP-`attach` stays Chromium-bound, as today).
 *
 * TRUST MODEL (stated, not enforced here): hands are trusted, local, in-process
 * peers with ZERO isolation between them (one live page, one process).
 * Inter-hand reuse is ordinary Node composition (import & call), NOT a
 * sibling-hand registry in the context — so {@link HandContext} carries live
 * page access only.
 */

/**
 * The scoped-but-LIVE access a hand receives. It carries live page access ONLY
 * (the trust model note above): the real Playwright {@link Page} and
 * {@link BrowserContext} the hand operates against in-process, plus the
 * lifecycle guard.
 *
 * - `pwPage` — the live Node-side Playwright `Page`. NEVER crosses the seam.
 * - `context` — the live `BrowserContext`; the built-in `cookies`/`setCookies`
 *   hand proves it is needed (cookies are a context-level, not page-level,
 *   concern).
 * - `ensureOpen` — the per-session lifecycle guard. Each verb calls it first so
 *   a verb invoked after the session closed rejects with `session is closed`
 *   (the seam's lifetime contract). The guard's "closed" state is owned by the
 *   per-transport session wiring (launch vs attach differ); the host only reads
 *   it through this function.
 */
export interface HandContext {
	readonly pwPage: Page;
	readonly context: BrowserContext;
	readonly ensureOpen: () => void;
}

/**
 * What a hand contributes once given its {@link HandContext}: a set of named
 * verbs (a subset of webhands' (eight) seam verbs, i.e. a `Partial` of the
 * seam {@link WebHandsPage}) and an optional `dispose` for any in-process
 * resource it set up.
 *
 * A hand may contribute several verbs (the built-in interaction hand contributes
 * both `click` and `type`) — a hand is NOT a single verb. It is NOT a transport
 * either: it does not `open` sessions. Nothing more than this is allowed (no
 * lifecycle hooks, no event handlers, no MCP-definition objects) — those are
 * either the transport's job (session lifecycle) or a later phase's.
 */
export interface HandContribution {
	readonly verbs: Partial<WebHandsPage>;
	readonly dispose?: () => Promise<void> | void;
}

/**
 * A hand: a capability MODULE that, given live page access, contributes verbs.
 * It is a plain factory function so a hand is just ordinary in-process Node
 * code closing over the {@link HandContext} — the exact shape webhands' own
 * verbs already had, made explicit.
 */
export type Hand = (ctx: HandContext) => HandContribution;

/**
 * The composed result the host hands back to a transport's session wiring: the
 * {@link WebHandsPage} (the seam object the verbs were merged into) and a single
 * `dispose` that tears down every hand.
 */
export interface ComposedHands {
	readonly page: WebHandsPage;
	/**
	 * Dispose every hand's resources. Hands are disposed in REVERSE registration
	 * order (LIFO, the natural teardown order for layered setup), and every
	 * hand's `dispose` is awaited even if an earlier one rejects, so one failing
	 * hand cannot strand another's cleanup. This disposes the HANDS only; tearing
	 * down the browser/context (and the order relative to this) is the
	 * per-transport session lifecycle's job, NOT the host's.
	 */
	dispose(): Promise<void>;
}

/**
 * Compose a set of hands over one live {@link HandContext} into a single
 * {@link WebHandsPage}. This is the host primitive both Playwright transports call to
 * build their session's verb surface — the SINGLE shared composition (no
 * duplicated page-object literal).
 *
 * Composition is EAGER (exactly as the page object literal was built before):
 * each hand is invoked once at session-open time and its verbs are merged into
 * one page object. There is no lazy registration and no ordering effect on the
 * verbs themselves (the eight built-in verbs have disjoint names). The returned
 * {@link WebHandsPage} is validated to carry every verb the seam requires, so a missing
 * built-in verb is a build-time/open-time failure here rather than an `undefined
 * is not a function` at the call site.
 */
export function composePage(
	ctx: HandContext,
	hands: readonly Hand[],
): ComposedHands {
	const verbs: Partial<WebHandsPage> = {};
	const disposers: Array<NonNullable<HandContribution['dispose']>> = [];

	for (const hand of hands) {
		const contribution = hand(ctx);
		Object.assign(verbs, contribution.verbs);
		if (contribution.dispose !== undefined) {
			disposers.push(contribution.dispose);
		}
	}

	const page = assertCompletePage(verbs);

	return {
		page,
		async dispose(): Promise<void> {
			// LIFO teardown; await every disposer even if one rejects so a single
			// failing hand cannot strand the others' cleanup.
			const failures: unknown[] = [];
			for (let i = disposers.length - 1; i >= 0; i--) {
				try {
					await disposers[i]!();
				} catch (cause) {
					failures.push(cause);
				}
			}
			if (failures.length > 0) {
				throw failures[0];
			}
		},
	};
}

/** The seam's full verb set; used to validate a composed page is complete. */
const REQUIRED_VERBS = [
	'navigate',
	'snapshot',
	'click',
	'type',
	'eval',
	'wait',
	'cookies',
	'setCookies',
	'query',
	'count',
	'exists',
	'isVisible',
	'getAttribute',
	'press',
	'hover',
	'select',
	'scroll',
	'drag',
] as const satisfies ReadonlyArray<keyof WebHandsPage>;

/**
 * Assert the composed verbs cover the whole seam {@link WebHandsPage}, then return it
 * as a `WebHandsPage`. A gap here means a built-in hand was dropped from the
 * composition — surfacing it at open time is far cheaper than a runtime
 * `undefined is not a function`.
 */
function assertCompletePage(verbs: Partial<WebHandsPage>): WebHandsPage {
	const missing = REQUIRED_VERBS.filter(
		(name) => typeof verbs[name] !== 'function',
	);
	if (missing.length > 0) {
		throw new Error(
			`hand-host: composed page is missing verb(s): ${missing.join(', ')}`,
		);
	}
	return verbs as WebHandsPage;
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

// ---------------------------------------------------------------------------
// Built-in hands: webhands' OWN eight verbs, each a hand over the host.
//
// Grouped into cohesive capability modules (navigation, snapshot, interaction,
// eval, wait, cookies) to demonstrate that a hand can contribute several verbs
// + in-process logic (it is NOT one-verb-per-hand). The verb BODIES are moved
// verbatim from the two transports' page-object literals, so behavior is
// preserved byte-for-byte (the existing verb suite is the proof).
// ---------------------------------------------------------------------------

/** The `navigate` verb: go to a URL and let it settle on the `load` event. */
export const navigationHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
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
	},
});

/** The `snapshot` verb: the token-cheap a11y view, or `--full` raw DOM. */
export const snapshotHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async snapshot(options?: SnapshotOptions): Promise<Snapshot> {
			ensureOpen();
			// Reject an unknown/misshapen option LOUDLY (e.g. `{view: 'full'}`)
			// rather than silently returning the wrong view. Single source of
			// truth in the seam, shared with the RPC server dispatch.
			validateSnapshotOptions(options);
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
	},
});

/** The `click` + `type` verbs: page interaction by raw locator (ADR-0004). */
export const interactionHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async click(t): Promise<void> {
			ensureOpen();
			await clickLocator(pwPage, t);
		},
		async type(t, text): Promise<void> {
			ensureOpen();
			await resolveLocator(pwPage, t).fill(text);
		},
	},
});

/** The `eval` escape hatch: run a JS EXPRESSION in the page, return by value. */
export const evalHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async eval(expression: string): Promise<unknown> {
			ensureOpen();
			// The `eval` escape hatch (PRD story 9): run the raw JS EXPRESSION in the
			// page and return its serializable result. Playwright's `evaluate`
			// already IS the seam's serialization contract (see {@link WebHandsPage.eval}):
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
	},
});

/** The `wait` verb: pace actions by a condition (timeout/locator/navigation). */
export const waitHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async wait(condition: WaitCondition): Promise<void> {
			ensureOpen();
			await waitFor(pwPage, condition);
		},
	},
});

/**
 * The `cookies` + `setCookies` verbs. These prove the {@link HandContext} needs
 * the `context`: cookies are a context-level, not page-level, concern, so this
 * hand reaches `ctx.context`, not `ctx.pwPage`.
 */
export const cookiesHand: Hand = ({context, ensureOpen}) => ({
	verbs: {
		async cookies(): Promise<readonly Cookie[]> {
			ensureOpen();
			const raw = await context.cookies();
			return raw.map(toSeamCookie);
		},
		async setCookies(cookies): Promise<void> {
			ensureOpen();
			await context.addCookies(cookies.map(fromSeamCookie));
		},
	},
});

/**
 * The Tier-1 read verbs (prd `broaden-agent-verb-surface`, R2): the `query`
 * extraction verb plus the thin state shorthands `count` / `exists` /
 * `isVisible` / `getAttribute`. All five address element(s) by the SAME raw
 * Playwright locator expression the other verbs use, resolved through the ONE
 * existing {@link resolveLocator} (so a `frameLocator(...)` same-origin frame
 * hop in the string Just Works, and there is no parallel addressing scheme —
 * R1). They are pure READS: no page mutation.
 *
 * `query` returns one row per match carrying EXACTLY the requested fields (R2);
 * the state verbs are computed over the same machinery (see {@link queryRows}
 * and the per-verb bodies). Read values cross by structured clone, the same
 * contract as `eval` (ADR-0003).
 */
export const queryHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async query(target, options?: QueryOptions): Promise<QueryRow[]> {
			ensureOpen();
			return queryRows(pwPage, target, options);
		},
		async count(target): Promise<number> {
			ensureOpen();
			return resolveLocator(pwPage, target).count();
		},
		async exists(target): Promise<boolean> {
			ensureOpen();
			return (await resolveLocator(pwPage, target).count()) > 0;
		},
		async isVisible(target): Promise<boolean> {
			ensureOpen();
			// The FIRST match's actionability-grade visibility. `.first().isVisible()`
			// returns `false` for an ABSENT element too (no match cannot be visible),
			// which is the loud, correct answer for the absent case.
			return resolveLocator(pwPage, target).first().isVisible();
		},
		async getAttribute(target, name: string): Promise<string | null> {
			ensureOpen();
			// The FIRST match's DOM attribute. `.first().getAttribute()` resolves to
			// `null` for an absent attribute AND surfaces a clean miss for an absent
			// element (it would otherwise time out); we treat "no element" as `null`
			// (there is no attribute value to read) rather than hanging.
			if ((await resolveLocator(pwPage, target).count()) === 0) {
				return null;
			}
			return resolveLocator(pwPage, target).first().getAttribute(name);
		},
	},
});

/**
 * The Tier-2 rich INPUT verbs (prd `broaden-agent-verb-surface`, stories 8-12):
 * `press` / `hover` / `select` / `scroll` / `drag`. These lift page-level
 * Playwright actions a hand already has on `pwPage` (`keyboard.press`,
 * `hover`, `selectOption`, `mouse.wheel`/`scrollIntoViewIfNeeded`, `dragTo`) up
 * to the agent verb seam so a seam-only agent can drive a browser game or a
 * richer form, not just `click`/`type`.
 *
 * Every locator-addressing form resolves through the SAME single
 * {@link resolveLocator} the other verbs use (so a same-origin `frameLocator(...)`
 * hop in the string Just Works — no parallel addressing scheme, R1). Keys are
 * strings, offsets are numbers, locators are strings: nothing Playwright-shaped
 * crosses the seam (ADR-0003).
 */
export const inputHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async press(key, target): Promise<void> {
			ensureOpen();
			if (target !== undefined) {
				// At a locator: Playwright focuses the element first, then presses
				// (the `locator.press` semantics).
				await resolveLocator(pwPage, target).press(key);
				return;
			}
			// No locator: the page's currently focused element receives the key.
			await pwPage.keyboard.press(key);
		},
		async hover(target): Promise<void> {
			ensureOpen();
			await resolveLocator(pwPage, target).hover();
		},
		async select(target, choice: SelectChoice): Promise<void> {
			ensureOpen();
			// EXACTLY ONE of value/label (the seam type enforces it); map to
			// Playwright's `selectOption({value})` / `selectOption({label})`.
			const option =
				'value' in choice ? {value: choice.value} : {label: choice.label};
			await resolveLocator(pwPage, target).selectOption(option);
		},
		async scroll(target: ScrollTarget): Promise<void> {
			ensureOpen();
			if ('to' in target) {
				// Reach an off-viewport element by scrolling it into view.
				await resolveLocator(pwPage, target.to).scrollIntoViewIfNeeded();
				return;
			}
			// Scroll the page by a pixel delta (the wheel convention: positive dy
			// scrolls DOWN).
			await pwPage.mouse.wheel(target.by.dx, target.by.dy);
		},
		async drag(source, target): Promise<void> {
			ensureOpen();
			await resolveLocator(pwPage, source).dragTo(
				resolveLocator(pwPage, target),
			);
		},
	},
});

/**
 * webhands' built-in verbs as built-in hands, in composition order. Both
 * Playwright transports compose THIS exact set, so the verb surface is
 * identical across launch and attach (the only legitimate difference is the
 * per-transport SESSION LIFECYCLE, which is not a hand's concern).
 */
export const BUILT_IN_HANDS: readonly Hand[] = [
	navigationHand,
	snapshotHand,
	interactionHand,
	evalHand,
	waitHand,
	cookiesHand,
	queryHand,
	inputHand,
];

/**
 * Compose webhands' built-in hands over a live context into the seam's
 * {@link WebHandsPage}. The convenience both transports call: `composePage(ctx,
 * BUILT_IN_HANDS)`. The built-in hands set up no in-process resources, so the
 * returned `dispose` is a no-op today; it exists so a transport can sequence
 * hand-teardown before its own browser/context teardown once third-party hands
 * (which may hold resources) are added in Phase 2.
 */
export function composeBuiltInPage(ctx: HandContext): ComposedHands {
	return composePage(ctx, BUILT_IN_HANDS);
}

/**
 * Compose webhands' built-in hands together with any explicitly-loaded
 * third-party hands (Phase 2) over a live context. The third-party hands are
 * composed AFTER the built-ins through the EXACT same {@link composePage} the
 * built-ins use, so a loaded hand plugs into the same host: its verbs merge into
 * the same seam {@link WebHandsPage} and its `dispose` is sequenced LIFO with the rest.
 * A third-party hand may add NEW verbs (the common case) and, because later
 * contributions win the merge, may also override a built-in verb — that is the
 * operator's choice, made by the trust act of naming the hand (ADR-0007).
 */
export function composeWithHands(
	ctx: HandContext,
	extraHands: readonly Hand[],
): ComposedHands {
	return composePage(ctx, [...BUILT_IN_HANDS, ...extraHands]);
}

// ---------------------------------------------------------------------------
// Shared verb building blocks (moved here with the verb bodies they back).
// Re-exported from the launch transport for its existing public-API consumers.
// ---------------------------------------------------------------------------

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
 * Shared by both Playwright transports (via the `wait` built-in hand) so the
 * verb behaviour stays identical (no parallel second implementation).
 */
export async function waitFor(
	page: Page,
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
 * One resolution path for both transports (via the built-in interaction/wait
 * hands), so there is no parallel addressing scheme.
 */
export function resolveLocator(page: Page, expression: string) {
	// eslint-disable-next-line no-new-func
	const factory = new Function('page', 'p', `return (${expression});`) as (
		page: Page,
		p: Page,
	) => ReturnType<Page['locator']>;
	return factory(page, page);
}

/**
 * Run the `click` verb against a Playwright page (PRD story 8), shared by both
 * Playwright transports (via the built-in interaction hand) so the verb behaves
 * identically (mirrors {@link waitFor}; no parallel second implementation).
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
	page: Page,
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

/**
 * Run the `query` verb (prd `broaden-agent-verb-surface`, R2) against a
 * Playwright page: resolve the locator EXPRESSION through the SINGLE existing
 * {@link resolveLocator} (so a same-origin `frameLocator(...)` hop in the string
 * Just Works), then return ONE ROW PER MATCH carrying EXACTLY the requested
 * fields and nothing else.
 *
 * The split is LOUD and never auto-detected:
 * - `attrs[name]` is the element's `getAttribute(name)` (the markup value;
 *   `null` if absent).
 * - `props[name]` is the live `el[name]` JS property (runtime state), read in
 *   one page-world `evaluate` over the element so the value is structurally
 *   cloned out by VALUE — the SAME serialization contract `eval` documents
 *   (ADR-0003: no Playwright/CDP type leak; richer than JSON).
 * - `pw.visible` / `pw.bbox` are the closed Playwright-locator extras
 *   (`isVisible()` / `boundingBox()`), the only facts not expressible as an
 *   attribute or a property. `bbox` is in VIEWPORT CSS-pixels.
 *
 * `limit` bounds the row count. With no fields requested every row is an empty
 * object (the caller asked for nothing; R2). Each row is built independently so
 * a per-element read failure is the page's own throw, surfaced faithfully like
 * `eval` (no silent swallow).
 */
export async function queryRows(
	page: Page,
	expression: string,
	options?: QueryOptions,
): Promise<QueryRow[]> {
	const attrs = options?.attrs ?? [];
	const props = options?.props ?? [];
	const pw = options?.pw ?? [];
	const base = resolveLocator(page, expression);
	const total = await base.count();
	const limit =
		options?.limit !== undefined ? Math.max(0, options.limit) : total;
	const rowCount = Math.min(total, limit);

	const rows: QueryRow[] = [];
	for (let i = 0; i < rowCount; i++) {
		rows.push(await readRow(base.nth(i), attrs, props, pw));
	}
	return rows;
}

/**
 * Read ONE matched element into a {@link QueryRow}, carrying only the requested
 * families. `attrs` and `props` are read in a SINGLE page-world `evaluate` over
 * the element handle (so a row is one round-trip and `props` values are cloned
 * by value); the `pw` extras use the locator API (`isVisible`/`boundingBox`).
 */
async function readRow(
	cell: Locator,
	attrs: readonly string[],
	props: readonly string[],
	pw: readonly string[],
): Promise<QueryRow> {
	const row: {
		attrs?: Record<string, string | null>;
		props?: Record<string, unknown>;
		pw?: {visible?: boolean; bbox?: BoundingBox | null};
	} = {};

	if (attrs.length > 0 || props.length > 0) {
		// One page-world read of the live element: `getAttribute` for the markup
		// attrs, `el[name]` for the live JS props. The returned object is
		// structurally cloned out of the page by Playwright (the `eval` contract),
		// so a prop value crosses the seam by VALUE with no type leak.
		const read = await cell.evaluate(
			(
				el: Element,
				{
					attrNames,
					propNames,
				}: {attrNames: readonly string[]; propNames: readonly string[]},
			) => {
				const out: {
					attrs?: Record<string, string | null>;
					props?: Record<string, unknown>;
				} = {};
				if (attrNames.length > 0) {
					const a: Record<string, string | null> = {};
					for (const name of attrNames) {
						a[name] = el.getAttribute(name);
					}
					out.attrs = a;
				}
				if (propNames.length > 0) {
					const p: Record<string, unknown> = {};
					for (const name of propNames) {
						p[name] = (el as unknown as Record<string, unknown>)[name];
					}
					out.props = p;
				}
				return out;
			},
			{attrNames: [...attrs], propNames: [...props]},
		);
		if (read.attrs !== undefined) {
			row.attrs = read.attrs;
		}
		if (read.props !== undefined) {
			row.props = read.props;
		}
	}

	if (pw.length > 0) {
		const extras: {visible?: boolean; bbox?: BoundingBox | null} = {};
		if (pw.includes('visible')) {
			extras.visible = await cell.isVisible();
		}
		if (pw.includes('bbox')) {
			extras.bbox = await cell.boundingBox();
		}
		row.pw = extras;
	}

	return row;
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
