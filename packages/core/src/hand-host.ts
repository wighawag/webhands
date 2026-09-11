import {
	errors as pwErrors,
	type BrowserContext,
	type Frame,
	type Locator,
	type Page,
} from 'playwright';
import type {
	ActionOptions,
	BoundingBox,
	ClickResult,
	Cookie,
	CookieFilter,
	EvalOptions,
	WebHandsPage,
	MouseInput,
	QueryOptions,
	QueryRow,
	Screenshot,
	ScreenshotOptions,
	ScriptOptions,
	ScrollTarget,
	SelectChoice,
	Snapshot,
	SnapshotOptions,
	WaitCondition,
} from './seam.js';
import {validateCookieFilter, validateSnapshotOptions} from './seam.js';
import {
	CrossOriginFrameError,
	ScreenshotPathError,
	StaleRefError,
} from './errors.js';
import {substituteEnvPlaceholders} from './env-substitution.js';
import {compileScriptSource} from './script-source.js';
import {mkdir} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve as resolvePath} from 'node:path';

/**
 * The hand-host primitive (Phase 1 of the "hands" spec,
 * `work/specs/tasked/hands-pluggable-page-capabilities.md`).
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
 * INTERNAL-ONLY BOUNDARY (the spec's resolved Q2): this whole module is
 * package-internal. {@link Hand}/{@link HandContext}/{@link composePage} are
 * NOT exported from the package entry point (`index.ts`) in Phase 1; they go
 * public in the separate Phase 2 task. The public seam (`seam.ts`) is
 * unchanged.
 *
 * NO-LEAK / CROSS-BROWSER (ADR-0003, refined by the spec): the host is built
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
	/**
	 * The managed SCREENSHOTS directory the `screenshot` verb mints PNGs under
	 * (Tier-4, spec `broaden-agent-verb-surface`, R3). Resolved by each transport
	 * from its home root (`<homeRoot>/screenshots`, beside `profiles/`) via
	 * {@link resolveScreenshotsDir}, so the same `root`/`WEBHANDS_HOME` override
	 * that isolates profiles in a test isolates screenshots too. The verb creates
	 * it lazily on first write and validates any caller `out` override stays under
	 * it ({@link ScreenshotPathError}). Carried HERE (not on the seam) so no path
	 * policy leaks into the public {@link WebHandsPage} surface (ADR-0003).
	 */
	readonly screenshotsDir: string;
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
	'script',
	'wait',
	'cookies',
	'setCookies',
	'clearCookies',
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
	'mouse',
	'screenshot',
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

/**
 * True iff `cause` is a Playwright-style auto-wait TIMEOUT (as opposed to any
 * other failure), the signal the `click` escape path and the frame resolver both
 * branch on.
 *
 * Why this is NOT a bare `cause instanceof pwErrors.TimeoutError`: under
 * `--stealth` the live page is driven by **Patchright**, a SEPARATE npm package
 * with its own `TimeoutError` class, so a class-identity check against
 * `playwright`'s class is FALSE for every timeout Patchright raises (verified:
 * `playwright.errors.TimeoutError !== patchright.errors.TimeoutError`). That
 * silently disabled both branches under stealth: a hidden control's `click`
 * rethrew a raw timeout instead of dispatching, and a bad `eval --frame`
 * selector reported a raw timeout instead of "no iframe matched".
 *
 * So we keep the class check (exact, for the vanilla path) and ADD a structural
 * check on the error's `name`, which both packages set to `'TimeoutError'`. The
 * brittleness is confined to this one predicate rather than repeated at each
 * branch, mirroring how {@link isMissingBrowserBinary} confines Playwright's
 * untyped "binary missing" failure to one spot.
 *
 * Exported for TESTING, not as public API (it is absent from the package entry
 * point). Both call sites matter and only one of them is reachable through a
 * fixture: `clickLocator` can be driven to a real timeout, while
 * `resolveSameOriginFrame`'s branch needs a stealth-engine timeout that no hermetic
 * test can produce. Testing the predicate directly covers both.
 */
export function isTimeoutError(cause: unknown): boolean {
	return (
		cause instanceof pwErrors.TimeoutError ||
		(cause instanceof Error && cause.name === 'TimeoutError')
	);
}

/**
 * How long {@link resolveSameOriginFrame} waits for the `frame` selector to
 * resolve to an iframe element before treating it as "no such frame". Short on
 * purpose: a frame-scoped `eval` against a bad selector should fail LOUD fast,
 * not burn Playwright's 30s default auto-wait (the same reasoning as
 * {@link NORMAL_CLICK_TIMEOUT_MS}). An iframe present in the markup resolves
 * immediately and never approaches this bound; it is the latency cost paid ONLY
 * on the no-such-frame path.
 */
const FRAME_RESOLVE_TIMEOUT_MS = 1_000;

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
			// subresources have loaded (SPEC story 6, "navigate ... and wait for it
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

/**
 * The `click` + `type` verbs: page interaction by raw locator (ADR-0004).
 *
 * With `{byRef: true}` the target is a REF — either a durable `query`
 * {@link QueryRow.ref} (already a `p.locator(...)` expression) OR a `snapshot`
 * `[ref=eN]` (a bare `eN` / `aria-ref=eN`, normalized by
 * {@link normalizeRefToLocator} to `p.locator("aria-ref=eN")`; ADR-0013). BOTH
 * are resolved through the SAME {@link resolveLocator} but FIRST asserted to
 * match EXACTLY ONE element ({@link assertRefResolvesToOne}), so a stale (zero)
 * or ambiguous (many) ref fails LOUD with a {@link StaleRefError} instead of
 * silently acting on the wrong element — the safety EITHER ref exists for. The
 * SAME normalized expression is used for the assert AND the act, so the
 * fail-loud check and the action can never resolve different elements.
 */
export const interactionHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async click(t, options?: ActionOptions): Promise<ClickResult> {
			ensureOpen();
			if (options?.byRef === true) {
				const ref = normalizeRefToLocator(t);
				await assertRefResolvesToOne(pwPage, ref, 'click');
				return clickLocator(pwPage, ref, options);
			}
			return clickLocator(pwPage, t, options);
		},
		async type(t, text, options?: ActionOptions): Promise<void> {
			ensureOpen();
			// Resolve any `{ENV:NAME}` placeholder in the typed VALUE against this
			// served process's `process.env` at type-time (the process that loaded the
			// `.env` files, see `env-loading.ts`). A value with no placeholder is
			// returned VERBATIM (backward compatible); an unset/empty var fails LOUD
			// with a typed UnresolvedEnvPlaceholderError rather than a silent empty
			// type. Substitution happens HERE, in-process, so the token crossed the RPC
			// wire unchanged and only this process ever holds the resolved secret,
			// keeping the tool-call and the (future) verb trace free of the literal.
			// The LOCATOR is left untouched: only the value is credential-bearing.
			const resolved = substituteEnvPlaceholders(text);
			if (options?.byRef === true) {
				const ref = normalizeRefToLocator(t);
				await assertRefResolvesToOne(pwPage, ref, 'type');
				await typeIntoLocator(pwPage, ref, resolved, options);
				return;
			}
			await typeIntoLocator(pwPage, t, resolved, options);
		},
	},
});

/** The `eval` escape hatch: run a JS EXPRESSION in the page, return by value. */
export const evalHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async eval(expression: string, options?: EvalOptions): Promise<unknown> {
			ensureOpen();
			return evalExpression(pwPage, expression, options);
		},
	},
});

/**
 * The `script` verb: run a caller-supplied DRIVER-CONTEXT script with the live
 * Playwright {@link HandContext.pwPage}, return its serializable result.
 *
 * Same SHAPE as {@link evalHand} (closes over `pwPage`, runs caller JS, returns
 * a serializable value), but a DIFFERENT context: `eval` runs a page-world
 * EXPRESSION via `page.evaluate`; `script` runs the caller's JS IN-PROCESS and
 * hands it the full Playwright `page` so one call drives a whole sub-flow
 * (locate + act + auto-wait + read). The live `page` never crosses the seam
 * (the script closes over it in-process); only the script's serializable RETURN
 * crosses, exactly as `eval`'s result does (ADR-0003; see {@link runScript}).
 *
 * TRUST: the SAME page-script surface as `eval` (caller JS, loopback-only), NOT
 * the `hands.json` hand-loading / npm-dependency surface — no module is loaded,
 * only a JS source string is read and run (ADR-0012).
 */
export const scriptHand: Hand = ({pwPage, ensureOpen}) => ({
	verbs: {
		async script(source: string, options?: ScriptOptions): Promise<unknown> {
			ensureOpen();
			return runScript(pwPage, source, options);
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
 * The `cookies` + `setCookies` + `clearCookies` verbs. These prove the
 * {@link HandContext} needs the `context`: cookies are a context-level, not
 * page-level, concern, so this hand reaches `ctx.context`, not `ctx.pwPage`.
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
		async clearCookies(filter: CookieFilter): Promise<number> {
			ensureOpen();
			// Validate HERE, through the shared seam validator, so an empty filter can
			// never be read as "clear everything" on any path (in-process or RPC).
			validateCookieFilter(filter);
			// Count by DIFFERENCE rather than trusting the filter: we read the live
			// cookie jar before and after, so the returned number is what the browser
			// actually removed, not what we asked it to. That is the difference between
			// "recovery happened" and "the names were already gone / misspelled".
			//
			// Counting only the cookies the FILTER matches, not the whole jar: a jar-wide
			// difference is wrong under concurrent writes, which is the normal state of a
			// logged-in page. A background XHR setting one cookie mid-clear would
			// under-report; two would turn a successful clear into `cleared: 0`, which the
			// CLI help explicitly reads as "nothing matched, check the names"; a
			// net-positive write would report a NEGATIVE count.
			const matching = (cookies: readonly Cookie[]): number =>
				filter.all === true
					? cookies.length
					: cookies.filter((c) => matchesCookieFilter(c, filter)).length;
			const before = matching(await context.cookies());
			if (filter.all === true) {
				await context.clearCookies();
			} else {
				// Playwright's clearCookies takes ONE name per call and ANDs its fields,
				// so a multi-name filter is one call per name (each still narrowed by
				// domain/path when given). With no names, the domain/path narrowing is
				// the whole filter and a single call does it.
				const scope = {
					...(filter.domain !== undefined ? {domain: filter.domain} : {}),
					...(filter.path !== undefined ? {path: filter.path} : {}),
				};
				const names = filter.names ?? [];
				if (names.length === 0) {
					await context.clearCookies(scope);
				} else {
					for (const name of names) {
						await context.clearCookies({...scope, name});
					}
				}
			}
			const after = matching(await context.cookies());
			// Clamped: a concurrent write that ADDS a matching cookie must not make the
			// reported removal count negative.
			return Math.max(0, before - after);
		},
	},
});

/**
 * True iff `cookie` matches every field a {@link CookieFilter} names (AND), using
 * the same exact-string semantics the verb documents.
 *
 * Kept beside the verb because it exists ONLY to count what was removed: the
 * removal itself is Playwright's, and this must agree with it. `names` is the one
 * OR in the filter ("clear these four"), which is why it is an `includes`.
 */
function matchesCookieFilter(cookie: Cookie, filter: CookieFilter): boolean {
	if (filter.names !== undefined && !filter.names.includes(cookie.name)) {
		return false;
	}
	if (filter.domain !== undefined && cookie.domain !== filter.domain) {
		return false;
	}
	if (filter.path !== undefined && cookie.path !== filter.path) {
		return false;
	}
	return true;
}

/**
 * The Tier-1 read verbs (spec `broaden-agent-verb-surface`, R2): the `query`
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
 * The Tier-2 rich INPUT verbs (spec `broaden-agent-verb-surface`, stories 8-12):
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
		async press(key, target, options?: ActionOptions): Promise<void> {
			ensureOpen();
			if (target === undefined && options?.dom === true) {
				// `--dom` means "fire the event at THIS element without the actionability
				// check", which needs an element. The focused-element form has no target to
				// fire at and waits for nothing anyway, so silently ignoring the flag would
				// leave a caller believing they had used an escape hatch that did not apply.
				throw new Error(
					'press --dom needs a --locator: the escape dispatches key events AT an ' +
						'element. Without a locator the key goes to the focused element, which ' +
						'involves no actionability check to escape, so drop --dom.',
				);
			}
			if (target !== undefined) {
				if (options?.dom === true) {
					// DOM escape: dispatch the key event trio at the element without
					// requiring it to be actionable (see dispatchKeyToLocator).
					await dispatchKeyToLocator(pwPage, target, key, options);
					return;
				}
				// At a locator: Playwright focuses the element first, then presses
				// (the `locator.press` semantics).
				await resolveLocator(pwPage, target).press(key, timeoutOption(options));
				return;
			}
			// No locator: the page's currently focused element receives the key.
			await pwPage.keyboard.press(key);
		},
		async hover(target, options?: ActionOptions): Promise<void> {
			ensureOpen();
			if (options?.dom === true) {
				await dispatchHoverToLocator(pwPage, target, options);
				return;
			}
			await resolveLocator(pwPage, target).hover(timeoutOption(options));
		},
		async select(
			target,
			choice: SelectChoice,
			options?: ActionOptions,
		): Promise<void> {
			ensureOpen();
			if (options?.dom === true) {
				await dispatchSelectToLocator(pwPage, target, choice, options);
				return;
			}
			// EXACTLY ONE of value/label (the seam type enforces it); map to
			// Playwright's `selectOption({value})` / `selectOption({label})`.
			const option =
				'value' in choice ? {value: choice.value} : {label: choice.label};
			await resolveLocator(pwPage, target).selectOption(
				option,
				timeoutOption(options),
			);
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
		async drag(source, target, options?: ActionOptions): Promise<void> {
			ensureOpen();
			// NO `dom` escape for drag, deliberately. A faithful synthetic drag needs a
			// dragstart/dragover/drop/dragend sequence with a populated DataTransfer,
			// and real HTML5 drop targets frequently ignore a hand-rolled one, so the
			// "escape" would fail silently more often than it worked. A hidden drag
			// source is also not the real-world case `--dom` exists for (hidden radios
			// and checkboxes are). `--timeout` still applies.
			await resolveLocator(pwPage, source).dragTo(
				resolveLocator(pwPage, target),
				timeoutOption(options),
			);
		},
	},
});

/**
 * The Tier-4 COORDINATE + SCREENSHOT hand (spec `broaden-agent-verb-surface`,
 * R3; stories 17-19): the `mouse` coordinate-input verb and the `screenshot`
 * path-returning verb, the look-then-click pair that lets a seam-only agent
 * handle the VISION/TILE captcha family and any visual task.
 *
 * The seam stays ADR-0003-clean (as amended by the Tier-4 ADR) by passing ONLY
 * numbers + a string enum (`mouse`) and returning ONLY a file PATH + dimensions
 * (`screenshot`): NO image bytes and NO Playwright/CDP type cross the seam.
 *
 * - `mouse` drives Playwright `page.mouse` at VIEWPORT CSS-pixels (NOT OS-level
 *   input). A VIEWPORT screenshot's pixels map directly to these coordinates
 *   (the look-then-click contract); a FULL-PAGE shot does not.
 * - `screenshot` MINTS a PNG under the managed {@link HandContext.screenshotsDir}
 *   and returns its path. The `element` scope clips to a locator (resolved
 *   through the SAME {@link resolveLocator}, so a cross-origin `frameLocator(...)`
 *   widget shot Just Works). A caller `out` override is validated to stay under
 *   the managed dir ({@link ScreenshotPathError}).
 */
export const coordinateHand: Hand = ({pwPage, ensureOpen, screenshotsDir}) => ({
	verbs: {
		async mouse(input: MouseInput): Promise<void> {
			ensureOpen();
			await doMouse(pwPage, input);
		},
		async screenshot(options?: ScreenshotOptions): Promise<Screenshot> {
			ensureOpen();
			return takeScreenshot(pwPage, screenshotsDir, options);
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
	scriptHand,
	waitHand,
	cookiesHand,
	queryHand,
	inputHand,
	coordinateHand,
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
 * Run the `wait` verb's three forms (SPEC story 10) against a Playwright page.
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
 * Run the `eval` verb against a Playwright page (SPEC story 9; frame scope from
 * spec `broaden-agent-verb-surface`, Tier-3), shared by both Playwright
 * transports (via the built-in eval hand) so the verb behaves identically (no
 * parallel second implementation).
 *
 * With no `frame`, this is the top-document escape hatch: Playwright's
 * `evaluate` IS the seam's serialization contract (see {@link WebHandsPage.eval}):
 * it passes a string as an expression, awaits a returned Promise, and
 * structurally clones the result out of the page by VALUE. That clone is richer
 * than JSON: it preserves NaN/Infinity/BigInt and circular structures (back-refs
 * become a `[Circular]` marker), yields `undefined` for functions/symbols, and
 * returns an opaque preview string for a live host object (a DOM node never
 * crosses the process boundary). A page-side throw rejects. We pass it straight
 * through rather than re-encode it: wrapping the value in a transport-specific
 * envelope would invent a dialect the seam deliberately avoids. The thrown error
 * is a plain `Error`, so no Playwright/CDP type leaks across the seam (ADR-0003).
 *
 * With a `frame` selector, the SAME structured-clone contract holds, but the
 * expression runs in the named SAME-ORIGIN child frame (resolved through the
 * single {@link resolveSameOriginFrame}, which reuses the same
 * {@link resolveLocator} the locator-taking verbs use). A cross-origin frame
 * REJECTS with a typed {@link CrossOriginFrameError} (see that resolver).
 */
export async function evalExpression(
	page: Page,
	expression: string,
	options?: EvalOptions,
): Promise<unknown> {
	if (options?.frame === undefined) {
		return page.evaluate(expression);
	}
	const frame = await resolveSameOriginFrame(page, options.frame);
	// `frame.evaluate` honours the SAME structured-clone contract as
	// `page.evaluate` (it is the same Playwright serialization), so the
	// frame-scoped result crosses the seam by value exactly as the top-document
	// `eval` does.
	return frame.evaluate(expression);
}

/**
 * Run the `script` verb against a Playwright page: the DRIVER-CONTEXT batch
 * escape hatch (idea `webhands-execute-script-verb`, ADR-0012). Shared by both
 * Playwright transports (via the built-in {@link scriptHand}) so the verb
 * behaves identically (mirrors {@link evalExpression}; no parallel second
 * implementation).
 *
 * `source` is JS that EVALUATES TO A FUNCTION of the page, e.g.
 * `async (page) => { await page.fill('#user', 'u'); return await
 * page.locator('.list').count(); }`. We evaluate the source as an EXPRESSION (so
 * the value is the function) in a tiny sandbox where `page`/`p` is bound — the
 * SAME `new Function('page', 'p', 'return (...)')` shape {@link resolveLocator}
 * uses for a locator expression — then INVOKE that function with the live page
 * and AWAIT its result. A sync function works too (its return is awaited
 * harmlessly). Binding `page`/`p` in the factory means a bare statement body
 * that already references `page` (e.g. `() => page.title()`) resolves it, but
 * the contract is the function-of-page form so the script names its own
 * parameter.
 *
 * The DRIVER context is deliberate: the script gets the FULL Playwright `page`
 * (real locators + actions + auto-waiting), NOT a page-world `evaluate`. That
 * `page` is in-process Node JS the script closes over, so the API it CALLS is
 * NOT an ADR-3 seam surface (no constraint on what Playwright methods it uses).
 *
 * SEAM BOUNDARY (ADR-0003, the load-bearing rule). The script's RETURN VALUE is
 * what crosses the seam (and the RPC wire for the served session), so it must be
 * SEAM-CLEAN: a serializable value with no Playwright/CDP type. We DO NOT clone
 * or re-encode it here (a returned plain value is already serializable; a
 * returned live Playwright handle is a CALLER error that simply will not
 * round-trip over the wire, the same way `eval` returning a DOM node hands back
 * an opaque preview). The thrown error is a plain `Error` (we surface the
 * underlying message), so a throwing script REJECTS cleanly with no
 * Playwright/CDP type leaking across the seam, exactly as `eval` does.
 */
export async function runScript(
	page: Page,
	source: string,
	_options?: ScriptOptions,
): Promise<unknown> {
	// Compiling the source to its function value lives in `script-source.ts`,
	// which accepts BOTH the bare-expression spelling and the module-style one (a
	// trailing semicolon, top-level consts before the final expression, a leading
	// `export default`) and raises the explaining InvalidScriptSourceError when the
	// file genuinely cannot be a function of the page. The contract is unchanged
	// (ADR-0012: the file's VALUE is the function); only the compile tolerates the
	// shapes a human naturally writes.
	const fn: unknown = compileScriptSource(source, {page, p: page});
	if (typeof fn !== 'function') {
		throw new Error(
			`script: the source must evaluate to a function of the page ` +
				`(got ${typeof fn}), e.g. async (page) => { ... }.`,
		);
	}
	// Invoke the caller's function with the live page and await its result, so a
	// returned Promise resolves before the value crosses the seam (the same
	// await-the-result contract `eval` has for a Promise expression).
	return await (fn as (page: Page) => unknown)(page);
}

/**
 * Resolve a `frame` SELECTOR string to a live, SAME-ORIGIN Playwright
 * {@link Frame} for a frame-scoped `eval` (spec `broaden-agent-verb-surface`,
 * Tier-3, R1). This is the SINGLE frame resolver: it reuses the very same
 * {@link resolveLocator} the locator-taking verbs use (a `frameLocator(...)`
 * over the selector), then walks the iframe element handle to its content
 * frame — there is no parallel frame-addressing scheme.
 *
 * SAME-ORIGIN ONLY, enforced LOUD. Playwright will happily `evaluate` inside a
 * CROSS-ORIGIN OOPIF (it attaches out-of-band), so a cross-origin frame would
 * NOT throw on its own — it would silently succeed, which is exactly the
 * contract violation this verb forbids (page-world JS cannot cross a security
 * boundary; the seam is same-origin only). So we DETECT cross-origin by
 * comparing the frame's origin to the page's main-frame origin and reject with a
 * typed {@link CrossOriginFrameError} when they differ, never returning a frame
 * the page world could not legitimately reach.
 *
 * Failure modes are loud/typed: a selector that matches NO iframe element
 * rejects (the locator resolves nothing); a matched frame with no content frame
 * rejects; a cross-origin frame rejects with {@link CrossOriginFrameError}.
 */
export async function resolveSameOriginFrame(
	page: Page,
	selector: string,
): Promise<Frame> {
	// Reuse the ONE resolver: treat the selector as the argument to
	// `frameLocator(...)`, exactly how a locator-taking verb would frame-hop. We
	// build the expression with a JSON-encoded selector so an arbitrary CSS
	// selector cannot break out of the call.
	const frameLocator = resolveLocator(
		page,
		`p.frameLocator(${JSON.stringify(selector)})`,
	) as unknown as {owner(): Locator};
	// Bound the resolve: a selector that matches NO iframe must fail LOUD quickly
	// rather than burn Playwright's 30s default auto-wait (mirrors the short
	// bound `clickLocator` uses for a non-actionable element). `elementHandle`
	// throws a TimeoutError on no match within the bound; we map it to a clear
	// "no iframe matched" error.
	let handle: Awaited<ReturnType<Locator['elementHandle']>>;
	try {
		handle = await frameLocator
			.owner()
			.elementHandle({timeout: FRAME_RESOLVE_TIMEOUT_MS});
	} catch (cause) {
		if (isTimeoutError(cause)) {
			throw new Error(
				`eval --frame: no iframe element matched selector ${JSON.stringify(
					selector,
				)}.`,
			);
		}
		throw cause;
	}
	if (handle === null) {
		throw new Error(
			`eval --frame: no iframe element matched selector ${JSON.stringify(
				selector,
			)}.`,
		);
	}
	try {
		const frame = await handle.contentFrame();
		if (frame === null) {
			throw new Error(
				`eval --frame: the element matched by selector ${JSON.stringify(
					selector,
				)} is not a frame.`,
			);
		}
		const pageOrigin = originOf(page.mainFrame().url());
		const frameOrigin = originOf(frame.url());
		if (frameOrigin === null || frameOrigin !== pageOrigin) {
			throw new CrossOriginFrameError(selector, {
				frameOrigin: frameOrigin ?? undefined,
				pageOrigin: pageOrigin ?? undefined,
			});
		}
		return frame;
	} finally {
		await handle.dispose();
	}
}

/**
 * The origin (`scheme://host:port`) of a frame/page URL, or `null` when the URL
 * has no parseable origin (e.g. `about:blank`). Used to compare a child frame's
 * origin against the page's, the same-origin check the frame-scoped `eval`
 * enforces. An unparseable / opaque origin reads as NOT same-origin (loud over
 * silent): the frame is not provably reachable, so we treat it as cross-origin.
 */
function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
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
 * Run the `click` verb against a Playwright page (SPEC story 8), shared by both
 * Playwright transports (via the built-in interaction hand) so the verb behaves
 * identically (mirrors {@link waitFor}; no parallel second implementation).
 *
 * First try a normal `Locator.click()`, which AUTO-WAITS for the element to be
 * visible and actionable — the right behaviour for a real button. A hidden
 * custom input (the case the spec calls out) NEVER becomes actionable, so that
 * click times out; on a Playwright `TimeoutError` we fall back to
 * `dispatchEvent('click')`, which fires a click WITHOUT the actionability
 * checks. The fallback is deliberately the documented Playwright escape (a
 * sibling to the `eval` hatch, ADR-0004), not a reimplemented click: we keep
 * the locator a raw resolved expression and only change HOW the resolved
 * locator is clicked.
 *
 * Only a timeout triggers the fallback. The fallback `dispatchEvent` is itself
 * bounded by the same short timeout (passed in its OPTIONS argument, which is the
 * only place Playwright reads it), so a locator that resolves NO element (a bad
 * locator) surfaces its timeout quickly instead of hanging the dispatch on
 * Playwright's 30s default — the dispatch escape is for elements that EXIST but
 * are not actionable (hidden custom inputs), not for absent ones.
 *
 * The happy-path click passes `noWaitAfter: true` on purpose. Playwright's
 * `Locator.click()` normally clicks AND THEN auto-waits for any navigation the
 * click scheduled to finish, and that post-click wait counts against the same
 * timeout. A real submit button whose navigation takes longer than
 * {@link NORMAL_CLICK_TIMEOUT_MS} would therefore have its (already-performed)
 * click reported as a `TimeoutError` and be wrongly routed to the dispatch
 * escape, which then re-clicks a page that is already navigating away. We only
 * want the short budget to measure ACTIONABILITY (can we click it?), not how
 * long the resulting navigation takes — `noWaitAfter` returns as soon as the
 * click is performed, so a slow-but-successful submit no longer trips the
 * fallback. A genuinely non-actionable hidden input still cannot be clicked
 * within the budget and still falls through to `dispatchEvent` as before.
 */
export async function clickLocator(
	page: Page,
	expression: string,
	options?: ActionOptions,
): Promise<ClickResult> {
	const target = resolveLocator(page, expression);
	// The actionability budget: the caller's `--timeout` when given, else the short
	// default. A hidden control never becomes actionable, so there is nothing to
	// gain by waiting longer than it takes to be sure.
	const timeout = usableTimeoutMs(options) ?? NORMAL_CLICK_TIMEOUT_MS;
	if (options?.dom === true) {
		// EXPLICIT escape: the caller already knows the control is hidden behind a
		// label, so skip the wait entirely rather than paying the budget to rediscover
		// it. `dispatchEvent` still waits for the element to EXIST, so a wrong locator
		// fails loudly instead of silently doing nothing.
		await target.dispatchEvent('click', {}, {timeout});
		return {via: 'dispatch'};
	}
	try {
		await target.click({timeout, noWaitAfter: true});
		return {via: 'click'};
	} catch (cause) {
		if (!isTimeoutError(cause)) {
			throw cause;
		}
		// The element never became actionable (e.g. a hidden custom input). Fire
		// the click without actionability checks, the spec's explicit escape path.
		// The RESULT reports that this happened: the caller asked to click a button
		// and got a dispatched event at something a user could not have clicked,
		// which they may well want to treat differently (it can be a honeypot).
		//
		// NOTE the THIRD argument. `dispatchEvent(type, eventInit?, options?)` takes
		// the timeout in its OPTIONS, not its event init. This used to read
		// `dispatchEvent('click', {timeout})`, which passed the bound as an event
		// FIELD and silently left Playwright's 30s default in place, so a bad locator
		// hung for 30s here while the comment promised it failed fast (measured: 30.4s
		// against a locator matching nothing; ~1s now).
		await target.dispatchEvent('click', {}, {timeout});
		return {via: 'dispatch'};
	}
}

/**
 * Playwright's per-action `{timeout}` option for an {@link ActionOptions}, or
 * `undefined` to keep the action's own default.
 *
 * One helper so every acting verb spells the override the same way, and so
 * omitting `--timeout` provably changes nothing (no key is passed at all).
 */
function timeoutOption(options?: ActionOptions): {timeout: number} | undefined {
	const ms = usableTimeoutMs(options);
	return ms !== undefined ? {timeout: ms} : undefined;
}

/**
 * The caller's `timeoutMs` if it is a usable bound, else `undefined`.
 *
 * Non-positive values are DROPPED rather than forwarded, because Playwright reads
 * `timeout: 0` as "disable the timeout", i.e. wait forever. A caller writing
 * `--timeout 0` plainly means "do not wait", so honouring it literally would hang
 * the single served session on a bad locator and, for `click`, skip the dispatch
 * fallback entirely. The CLI rejects non-positive values at the flag; this is the
 * belt for every OTHER caller (an untyped RPC client, a programmatic user).
 */
function usableTimeoutMs(options?: ActionOptions): number | undefined {
	const ms = options?.timeoutMs;
	return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
		? ms
		: undefined;
}

/**
 * The budget a `dom` escape waits for the element to EXIST (not to be
 * actionable). Short by design: the caller has already told us actionability is
 * not coming, so the only thing left to wait for is the node being in the DOM, and
 * a locator that matches nothing should say so fast.
 */
const DOM_ESCAPE_TIMEOUT_MS = 1_000;

/** The existence budget for a `dom` escape: the caller's override, else short. */
function domEscapeTimeout(options?: ActionOptions): number {
	return usableTimeoutMs(options) ?? DOM_ESCAPE_TIMEOUT_MS;
}

/**
 * Run the `type` verb: fill the addressed element, or with `{dom: true}` SET its
 * value and fire the events a page listens for.
 *
 * The `dom` path is honestly weaker than `click`'s, which is why it is opt-in and
 * documented as such: setting `.value` and dispatching `input` + `change` is what
 * React/Vue controlled inputs and most validation listen to, but it does NOT
 * produce keystrokes, so a field that keys off `keydown`/`keypress` (input masks,
 * some autocompletes, keyboard-shortcut handlers) can behave differently from a
 * human typing. Use it for a hidden/readonly-ish field that refuses a real fill,
 * not as a default.
 */
export async function typeIntoLocator(
	page: Page,
	expression: string,
	value: string,
	options?: ActionOptions,
): Promise<void> {
	const target = resolveLocator(page, expression);
	if (options?.dom !== true) {
		await target.fill(value, timeoutOption(options));
		return;
	}
	await target.evaluate(
		(el, v: string) => {
			const node = el as HTMLInputElement;
			// Use the native value SETTER so frameworks that patch the property (React
			// tracks the last value it set) still see the change; assigning `.value`
			// directly is the classic way this silently fails to register.
			const proto =
				node instanceof HTMLTextAreaElement
					? HTMLTextAreaElement.prototype
					: HTMLInputElement.prototype;
			const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
			if (setter !== undefined) {
				setter.call(node, v);
			} else {
				node.value = v;
			}
			node.dispatchEvent(new Event('input', {bubbles: true}));
			node.dispatchEvent(new Event('change', {bubbles: true}));
		},
		value,
		{timeout: domEscapeTimeout(options)},
	);
}

/**
 * The `press --dom` escape: dispatch `keydown` + `keypress` + `keyup` at the
 * element without requiring it to be actionable.
 *
 * Weaker than a real `press` and deliberately so: the events carry the key name
 * but no real input state, so they will NOT insert text into a field (the browser
 * does that only for trusted key events) and will not move the caret. They DO run
 * a page's key handlers, which is the case this escape exists for (a shortcut
 * bound to a hidden element).
 */
async function dispatchKeyToLocator(
	page: Page,
	expression: string,
	key: string,
	options?: ActionOptions,
): Promise<void> {
	const target = resolveLocator(page, expression);
	const timeout = domEscapeTimeout(options);
	for (const type of ['keydown', 'keypress', 'keyup']) {
		// `key` only, deliberately no `code`. `KeyboardEvent.code` is a PHYSICAL key
		// name (`KeyA`, `Enter`), so setting it to the key VALUE (`a`) would produce a
		// combination no real keyboard can emit, and a handler branching on `e.code`
		// would see a value it can never otherwise see. Omitting it is the honest
		// synthetic event: a handler reading `e.key` works, one reading `e.code` sees
		// nothing rather than a lie.
		await target.dispatchEvent(type, {key}, {timeout});
	}
}

/**
 * The `hover --dom` escape: dispatch the pointer-enter sequence at the element.
 *
 * Weaker than a real `hover`: there is no mouse POSITION, so a menu that opens on
 * `mousemove` at coordinates, or one that checks `:hover` in CSS, will not react.
 * `mouseover`/`mouseenter` cover the common JS-handler case.
 */
async function dispatchHoverToLocator(
	page: Page,
	expression: string,
	options?: ActionOptions,
): Promise<void> {
	const target = resolveLocator(page, expression);
	const timeout = domEscapeTimeout(options);
	// `mouseenter` is deliberately absent. Playwright's event-type map does not carry
	// it (an upstream typo, `mouseeenter`, in playwright-core 1.61.1), so dispatching
	// it yields a GENERIC bubbling Event, while a real `mouseenter` never bubbles:
	// ancestor handlers would fire spuriously, which is worse than not firing the
	// event at all. `mouseover` already covers the JS-handler case this escape exists
	// for.
	for (const type of ['pointerover', 'mouseover', 'mousemove']) {
		await target.dispatchEvent(type, {}, {timeout});
	}
}

/**
 * The `select --dom` escape: set the `<select>`'s value and fire `change`.
 *
 * The most faithful of the escapes after `click`: choosing an option IS setting
 * the value, and `change` is what a page listens for. Resolving a LABEL happens in
 * the page (match an option's visible text), so a label with no matching option
 * fails LOUD rather than silently selecting nothing.
 */
async function dispatchSelectToLocator(
	page: Page,
	expression: string,
	choice: SelectChoice,
	options?: ActionOptions,
): Promise<void> {
	const target = resolveLocator(page, expression);
	const picked = await target.evaluate(
		(el, c: SelectChoice) => {
			const select = el as HTMLSelectElement;
			const options_ = Array.from(select.options);
			const match =
				'value' in c
					? options_.find((o) => o.value === c.value)
					: options_.find((o) => (o.textContent ?? '').trim() === c.label);
			if (match === undefined) {
				return false;
			}
			select.value = match.value;
			select.dispatchEvent(new Event('input', {bubbles: true}));
			select.dispatchEvent(new Event('change', {bubbles: true}));
			return true;
		},
		choice,
		{timeout: domEscapeTimeout(options)},
	);
	if (!picked) {
		throw new Error(
			`select --dom: no <option> matched ${
				'value' in choice
					? `value ${JSON.stringify(choice.value)}`
					: `label ${JSON.stringify(choice.label)}`
			} in ${expression}.`,
		);
	}
}

/**
 * Run the `query` verb (spec `broaden-agent-verb-surface`, R2) against a
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
	const withRefs = options?.refs === true;
	const base = resolveLocator(page, expression);
	const total = await base.count();
	const limit =
		options?.limit !== undefined ? Math.max(0, options.limit) : total;
	const rowCount = Math.min(total, limit);

	// Refs are single-`query`-scoped: each `refs: true` query SWEEPS the PRIOR
	// query's minted attributes FIRST (page-wide), so a ref can never resolve a
	// stale element minted two queries ago. Reused stable attrs (ladder step 1)
	// are the framework's own and are untouched. Done once, before iterating.
	if (withRefs) {
		await sweepPriorMints(page);
	}

	const rows: QueryRow[] = [];
	for (let i = 0; i < rowCount; i++) {
		rows.push(await readRow(base.nth(i), attrs, props, pw, withRefs));
	}
	return rows;
}

/**
 * The namespaced attribute the MINT fallback (ladder step 2) stamps on an
 * anonymous element. A `query({refs: true})` sweeps every node carrying it
 * before re-minting, so mints stay single-query-scoped.
 */
const REF_MINT_ATTR = 'data-webhands-ref';

/**
 * Remove EVERY {@link REF_MINT_ATTR} attribute currently in the document, the
 * single-`query`-scope sweep run at the start of each `refs: true` query. This
 * touches ONLY webhands' own minted attribute — never a framework's stable attrs
 * (ladder step 1 reuses those, it does not stamp them), so a sweep cannot break
 * a reused-attribute ref.
 */
async function sweepPriorMints(page: Page): Promise<void> {
	await page.evaluate((attr) => {
		document.querySelectorAll('[' + attr + ']').forEach((el) => {
			el.removeAttribute(attr);
		});
	}, REF_MINT_ATTR);
}

/**
 * Compute the durable {@link QueryRow.ref} for ONE matched element by the R4
 * PREFERENCE LADDER, in page-world (the finding
 * `query-ref-mint-mechanism-attribute-beats-weakmap` settled the mechanism: a
 * `data-webhands-ref` ATTRIBUTE, not a WeakMap).
 *
 * Returns the ref as a LOCATOR EXPRESSION the ONE existing {@link resolveLocator}
 * resolves — `p.locator('<css>')` — NOT a bare CSS string, so `click`/`type`
 * feed it back through the exact same resolver path as any other locator (no new
 * addressing engine, R1). The human-legible CSS the ladder picks rides INSIDE
 * that expression (`p.locator('#buy-charlie')`).
 *
 * Ladder:
 * 1. REUSE the element's own stable, VERIFIED-UNIQUE attribute, in priority
 *    `id` > `data-testid`/`data-test`/`data-id` > `name` > a link's `href` >
 *    a unique `aria-label`. The CSS IS the element's real address: durable
 *    across reconciliation (the framework keeps its OWN attrs), legible, ZERO
 *    DOM mutation. Uniqueness is VERIFIED with
 *    `querySelectorAll(...).length === 1`; a duplicate (e.g. two equal ids)
 *    FALLS THROUGH to the next rung.
 * 2. MINT a namespaced {@link REF_MINT_ATTR} as the fallback for an anonymous
 *    element with no stable unique address, addressed by
 *    `[data-webhands-ref="<id>"]`.
 *
 * The minted-id counter lives on `window` so ids are unique within the page for
 * the life of the document (the sweep clears stale ATTRIBUTES, not the counter,
 * so a re-mint never reuses an id a still-resolvable ref might hold).
 */
async function computeRef(cell: Locator): Promise<string> {
	const css = await cell.evaluate((el: Element, attr: string): string => {
		const cssEscape = (v: string): string =>
			typeof (window as {CSS?: {escape?: (s: string) => string}}).CSS
				?.escape === 'function'
				? (
						window as unknown as {CSS: {escape: (s: string) => string}}
					).CSS.escape(v)
				: v.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
		const uniq = (selector: string): boolean =>
			document.querySelectorAll(selector).length === 1;

		// Ladder step 1: reuse a stable, VERIFIED-UNIQUE existing attribute.
		const id = el.getAttribute('id');
		if (id !== null && id !== '') {
			const sel = '#' + cssEscape(id);
			if (uniq(sel)) return sel;
		}
		for (const name of ['data-testid', 'data-test', 'data-id', 'name']) {
			const value = el.getAttribute(name);
			if (value !== null && value !== '') {
				const sel = '[' + name + '="' + value.replace(/"/g, '\\"') + '"]';
				if (uniq(sel)) return sel;
			}
		}
		// A link's href (only meaningful on an anchor).
		if (el.tagName === 'A') {
			const href = el.getAttribute('href');
			if (href !== null && href !== '') {
				const sel = 'a[href="' + href.replace(/"/g, '\\"') + '"]';
				if (uniq(sel)) return sel;
			}
		}
		// A unique aria-label.
		const aria = el.getAttribute('aria-label');
		if (aria !== null && aria !== '') {
			const sel = '[aria-label="' + aria.replace(/"/g, '\\"') + '"]';
			if (uniq(sel)) return sel;
		}

		// Ladder step 2: MINT the namespaced attribute (the fallback).
		const w = window as unknown as {__webhandsRefSeq?: number};
		w.__webhandsRefSeq = (w.__webhandsRefSeq ?? 0) + 1;
		const mintedId = 'wr' + w.__webhandsRefSeq;
		el.setAttribute(attr, mintedId);
		return '[' + attr + '="' + mintedId + '"]';
	}, REF_MINT_ATTR);
	// Wrap the chosen CSS in a `p.locator(...)` expression so the ref resolves
	// through the SAME resolver as every other locator. JSON-encode the CSS so a
	// quote/backslash in a reused attribute value cannot break out of the call.
	return `p.locator(${JSON.stringify(css)})`;
}

/**
 * A bare `snapshot` ref id (`e1`, `e42`), as Playwright's `ariaSnapshot({mode:
 * 'ai'})` tags every node `[ref=eN]`. The actionable-snapshot-ref path accepts
 * this form (and the fuller `aria-ref=eN`) and rewrites it to the `aria-ref=`
 * locator engine (ADR-0013).
 */
const SNAPSHOT_REF_ID = /^e\d+$/;

/**
 * Normalize a `{byRef: true}` target to a locator EXPRESSION the ONE
 * {@link resolveLocator} resolves (ADR-0013). A `--by-ref` target is one of two
 * kinds of ref, and this is the single point that unifies them onto the same
 * resolver + the same loud-stale guard:
 *
 * - a `snapshot` `[ref=eN]` ref — a bare `eN` or the fuller `aria-ref=eN` — is
 *   rewritten to `p.locator("aria-ref=eN")`, Playwright's native snapshot-ref
 *   locator engine (the spike in the task confirmed `page.locator('aria-ref=eN')`
 *   resolves the element a snapshot just showed). The id is JSON-encoded into
 *   the call so nothing can break out of the expression. This is the SNAPSHOT
 *   ref made first-class actionable: "read the page with `snapshot`, act on what
 *   you read" in one loop, no `query --with-refs` / `eval` detour.
 * - a durable `query` ref — already a `p.locator(...)` expression minted by
 *   {@link computeRef} — is passed through UNCHANGED, so the durable-ref path and
 *   its loud-stale safety are byte-for-byte the same as before.
 *
 * The two are honestly DIFFERENT in durability (the snapshot ref is
 * snapshot-scoped — Playwright re-keys `eN` on each `ariaSnapshot`, so it is an
 * "act on what I just saw" handle; the durable ref survives list mutation), but
 * they share the SAME `{byRef: true}` flag and the SAME exactly-one fail-loud
 * contract ({@link assertRefResolvesToOne} / {@link StaleRefError}), so neither
 * silently does the other's job and neither silently acts on the wrong element.
 * Nothing Playwright-shaped crosses the seam: the ref arrives as an opaque
 * string and stays a string (ADR-0003); it resolves through the same
 * locator-expression addressing as every other verb (ADR-0004).
 */
export function normalizeRefToLocator(ref: string): string {
	if (SNAPSHOT_REF_ID.test(ref)) {
		return `p.locator(${JSON.stringify(`aria-ref=${ref}`)})`;
	}
	const ariaRefMatch = /^aria-ref=(e\d+)$/.exec(ref);
	if (ariaRefMatch !== null) {
		return `p.locator(${JSON.stringify(`aria-ref=${ariaRefMatch[1]}`)})`;
	}
	// A durable `query` ref is already a `p.locator(...)` expression — unchanged.
	return ref;
}

/**
 * Resolve a durable `query` `ref` and assert it matches EXACTLY ONE element,
 * else throw a typed {@link StaleRefError} (resolve-to-ZERO = removed/replaced;
 * resolve-to-MANY = a cloned subtree / non-unique attribute). The loud-stale
 * guard `click`/`type` run BEFORE acting when `{byRef: true}`, so a stale or
 * ambiguous ref NEVER silently acts on the wrong element (the safety a ref has
 * over a positional `.nth(i)`). Resolved through the SAME {@link resolveLocator}
 * the verbs already use — no parallel addressing path.
 */
export async function assertRefResolvesToOne(
	page: Page,
	ref: string,
	verb: string,
): Promise<void> {
	const matched = await resolveLocator(page, ref).count();
	if (matched !== 1) {
		throw new StaleRefError(ref, matched, verb);
	}
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
	withRef: boolean,
): Promise<QueryRow> {
	const row: {
		attrs?: Record<string, string | null>;
		props?: Record<string, unknown>;
		pw?: {visible?: boolean; bbox?: BoundingBox | null};
		ref?: string;
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

	// The durable handle (opt-in). Computed by the R4 ladder in page-world:
	// reuse a stable unique attribute, else mint `data-webhands-ref`. Done after
	// the reads so a mint can never perturb an attr/prop read of this row.
	if (withRef) {
		row.ref = await computeRef(cell);
	}

	return row;
}

/**
 * Run the `mouse` verb (spec `broaden-agent-verb-surface`, Tier-4, R3) against a
 * Playwright page: drive `page.mouse` at the given VIEWPORT CSS-pixel
 * coordinate. Viewport-relative, NOT OS-level input — the same coordinate frame
 * a VIEWPORT `screenshot` is captured in, so a pixel an agent saw maps directly
 * to the click. Shared by both transports (via the coordinate hand) so the verb
 * behaves identically. Plain numbers + a string enum only (ADR-0003 as amended).
 */
export async function doMouse(page: Page, input: MouseInput): Promise<void> {
	const button = input.button ?? 'left';
	switch (input.action) {
		case 'move':
			// A bare move takes no button (it is a pointer move, not a press).
			await page.mouse.move(input.x, input.y);
			return;
		case 'click':
			await page.mouse.click(input.x, input.y, {button});
			return;
		case 'down':
			// down/up press/release at the CURRENT pointer position, so move there
			// first to honour the (x, y) the caller named (the two halves of a manual
			// drag both land at the intended spot).
			await page.mouse.move(input.x, input.y);
			await page.mouse.down({button});
			return;
		case 'up':
			await page.mouse.move(input.x, input.y);
			await page.mouse.up({button});
			return;
	}
}

/**
 * Run the `screenshot` verb (spec `broaden-agent-verb-surface`, Tier-4, R3;
 * stories 17-19) against a Playwright page: capture the requested SCOPE to a PNG
 * FILE under the managed `screenshotsDir` and return `{path, width, height}` —
 * NEVER image bytes (the load-bearing ADR-0003-as-amended choice). Shared by
 * both transports (via the coordinate hand).
 *
 * Scopes:
 * - `viewport` (default) — the visible viewport, COORDINATE-MATCHED to `mouse`.
 * - `full` — the whole scrollable page (`fullPage: true`), NOT coordinate-matched.
 * - `element` — clipped to the locator's element (REQUIRED; resolved through the
 *   SAME {@link resolveLocator}, so a `frameLocator(...)` frame widget works even
 *   cross-origin). A missing locator for `element`, or a stray locator on a
 *   non-`element` scope, is a LOUD validation error (mirrors `wait`).
 *
 * The PNG is written by Playwright to a path webhands MINTS under the managed
 * dir (or a caller `out` override VALIDATED to stay under it, else
 * {@link ScreenshotPathError}). We read the PNG's IHDR for the real pixel
 * dimensions (so the number is the image's, not an assumed viewport size).
 */
export async function takeScreenshot(
	page: Page,
	screenshotsDir: string,
	options?: ScreenshotOptions,
): Promise<Screenshot> {
	const scope = options?.scope ?? 'viewport';
	// LOUD scope/locator validation (mirrors `wait`'s exactly-one-of): `element`
	// MUST carry a locator; the other scopes must NOT (a stray locator is a
	// caller mistake, not a silent no-op).
	if (scope === 'element' && options?.locator === undefined) {
		throw new Error(
			'screenshot --scope element requires --locator <expr> (the element to clip to).',
		);
	}
	if (scope !== 'element' && options?.locator !== undefined) {
		throw new Error(
			`screenshot --locator is only valid with --scope element (got scope ${JSON.stringify(
				scope,
			)}).`,
		);
	}

	const path = await resolveScreenshotPath(screenshotsDir, options?.out);
	await mkdir(screenshotsDir, {recursive: true});

	let buffer: Buffer;
	if (scope === 'element') {
		// Clip to just the element (the captcha widget). Resolve through the ONE
		// shared resolver so a `frameLocator(...)` hop reaches a frame widget,
		// including cross-origin (Playwright `frameLocator` crosses; the spike).
		buffer = await resolveLocator(page, options!.locator!)
			.first()
			.screenshot({path, type: 'png'});
	} else {
		buffer = await page.screenshot({
			path,
			type: 'png',
			fullPage: scope === 'full',
		});
	}

	const {width, height} = pngDimensions(buffer, path);
	return {path, width, height};
}

/**
 * The PNG magic + IHDR layout: an 8-byte signature, then the IHDR chunk whose
 * width/height are big-endian uint32s at byte offsets 16 and 20. Reading them is
 * how we report the image's REAL pixel dimensions without decoding the whole
 * PNG or assuming a viewport size.
 */
function pngDimensions(
	buffer: Buffer,
	path: string,
): {width: number; height: number} {
	const PNG_SIGNATURE = '89504e470d0a1a0a';
	if (
		buffer.length < 24 ||
		buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE
	) {
		throw new Error(
			`screenshot: the file written at ${path} is not a valid PNG (no PNG signature).`,
		);
	}
	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20),
	};
}

/**
 * Resolve the PNG output path: a caller `out` override (VALIDATED to stay under
 * the managed dir) or a freshly MINTED unique path under it. A relative `out` is
 * resolved against the managed dir; an absolute (or `..`-escaping) `out` that
 * lands outside it is refused with {@link ScreenshotPathError} — webhands never
 * writes a screenshot to an arbitrary location.
 */
async function resolveScreenshotPath(
	screenshotsDir: string,
	out?: string,
): Promise<string> {
	if (out === undefined || out === '') {
		return join(screenshotsDir, mintScreenshotName());
	}
	const managedRoot = resolvePath(screenshotsDir);
	const candidate = isAbsolute(out)
		? resolvePath(out)
		: resolvePath(managedRoot, out);
	const rel = relative(managedRoot, candidate);
	// `rel` starting with `..` (or being absolute on a different root) means the
	// candidate escapes the managed dir.
	if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
		throw new ScreenshotPathError(out, managedRoot);
	}
	return candidate;
}

/**
 * Mint a unique PNG filename: a timestamp plus random suffix, so concurrent /
 * rapid shots never collide and the name is sortable by capture time.
 */
function mintScreenshotName(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const rand = Math.random().toString(36).slice(2, 10);
	return `webhands-${stamp}-${rand}.png`;
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
