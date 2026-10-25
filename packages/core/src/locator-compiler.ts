import {UnsupportedByTransportError} from './errors.js';

/**
 * Compile a raw Playwright locator EXPRESSION (ADR-0004) into Playwright's own
 * internal SELECTOR string, without a browser.
 *
 * WHY. The Playwright transports evaluate the expression against a live `Page`
 * (`resolveLocator` in `hand-host.ts`), and Playwright turns each `getByRole`,
 * `.filter`, `.nth`, `frameLocator` call into a selector such as
 * `internal:role=button[name="Search"i] >> nth=0`, which its injected script then
 * resolves in the page. The extension transport has no Playwright `Page`, but it
 * runs that SAME injected script in its content scripts (ADR-0018). So the only
 * missing piece is the client half: turning the expression into the selector.
 * This module is that half. The expression is evaluated exactly as the Playwright
 * transports evaluate it (`new Function('page', 'p', ...)`), so the accepted
 * spelling is identical, against a RECORDING page whose methods only concatenate
 * selector strings.
 *
 * FIDELITY. The construction rules below mirror Playwright 1.61's client
 * `Locator` / `FrameLocator` and `isomorphic/locatorUtils` + `stringUtils`
 * (Apache-2.0, Copyright Microsoft Corporation), ported verbatim in behaviour.
 * The test suite checks each rule against the selector a real Playwright
 * `Locator` produces for the same expression, so a drift on a Playwright bump
 * shows up as a failing test rather than as a wrong element.
 *
 * LOUD, NEVER SILENT. A locator method that does not BUILD a selector (an action
 * like `.click()`, a read like `.evaluate()`, `.page()`), or any property this
 * recorder does not know, throws {@link UnsupportedByTransportError} at compile
 * time. A typo'd or unsupported call can never degrade into "some other element".
 */

/** The ONE token Playwright uses to step into a child frame's document. */
export const ENTER_FRAME = 'internal:control=enter-frame';

/** The test-id attribute Playwright defaults to (and webhands never changes). */
const TEST_ID_ATTRIBUTE = 'data-testid';

const SELECTOR = Symbol('webhands.selector');
const KIND = Symbol('webhands.kind');

/** Options accepted by `locator()` / `filter()` (Playwright's `LocatorOptions`). */
interface LocatorOptions {
	readonly hasText?: string | RegExp;
	readonly hasNotText?: string | RegExp;
	readonly has?: unknown;
	readonly hasNot?: unknown;
	readonly visible?: boolean;
}

interface TextOptions {
	readonly exact?: boolean;
}

interface RoleOptions {
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly selected?: boolean;
	readonly expanded?: boolean;
	readonly includeHidden?: boolean;
	readonly level?: number;
	readonly name?: string | RegExp;
	readonly description?: string | RegExp;
	readonly exact?: boolean;
	readonly pressed?: boolean;
}

function escapeRegexForSelector(re: RegExp): string {
	if (re.unicode || (re as RegExp & {unicodeSets?: boolean}).unicodeSets) {
		return String(re);
	}
	return String(re)
		.replace(/(^|[^\\])(\\\\)*(["'`])/g, '$1$2\\$3')
		.replace(/>>/g, '\\>\\>');
}

function escapeForTextSelector(text: string | RegExp, exact: boolean): string {
	if (typeof text !== 'string') return escapeRegexForSelector(text);
	return `${JSON.stringify(text)}${exact ? 's' : 'i'}`;
}

function escapeForAttributeSelector(
	value: string | RegExp,
	exact: boolean,
): string {
	if (typeof value !== 'string') return escapeRegexForSelector(value);
	return `"${value.replace(/\\/g, '\\\\').replace(/["]/g, '\\"')}"${exact ? 's' : 'i'}`;
}

function getByAttributeTextSelector(
	attrName: string,
	text: string | RegExp,
	options?: TextOptions,
): string {
	return `internal:attr=[${attrName}=${escapeForAttributeSelector(text, options?.exact ?? false)}]`;
}

function getByTestIdSelector(testId: string | RegExp): string {
	return `internal:testid=[${TEST_ID_ATTRIBUTE}=${escapeForAttributeSelector(testId, true)}]`;
}

function getByLabelSelector(text: string | RegExp, options?: TextOptions) {
	return 'internal:label=' + escapeForTextSelector(text, !!options?.exact);
}

function getByTextSelector(text: string | RegExp, options?: TextOptions) {
	return 'internal:text=' + escapeForTextSelector(text, !!options?.exact);
}

function getByRoleSelector(role: string, options: RoleOptions = {}): string {
	const props: [string, string][] = [];
	if (options.checked !== undefined)
		props.push(['checked', String(options.checked)]);
	if (options.disabled !== undefined)
		props.push(['disabled', String(options.disabled)]);
	if (options.selected !== undefined)
		props.push(['selected', String(options.selected)]);
	if (options.expanded !== undefined)
		props.push(['expanded', String(options.expanded)]);
	if (options.includeHidden !== undefined)
		props.push(['include-hidden', String(options.includeHidden)]);
	if (options.level !== undefined) props.push(['level', String(options.level)]);
	if (options.name !== undefined)
		props.push([
			'name',
			escapeForAttributeSelector(options.name, !!options.exact),
		]);
	if (options.description !== undefined)
		props.push([
			'description',
			escapeForAttributeSelector(options.description, !!options.exact),
		]);
	if (options.pressed !== undefined)
		props.push(['pressed', String(options.pressed)]);
	return `internal:role=${role}${props.map(([n, v]) => `[${n}=${v}]`).join('')}`;
}

function selectorOf(value: unknown, what: string): string {
	if (
		typeof value === 'object' &&
		value !== null &&
		(value as {[KIND]?: string})[KIND] === 'locator'
	) {
		return (value as {[SELECTOR]: string})[SELECTOR];
	}
	throw new Error(
		`${what} must be a locator built from the same page (e.g. page.getByText('x'))`,
	);
}

/** The selector-building methods shared by a page, a locator and a frame locator. */
function getByMethods(make: (selector: string) => unknown) {
	return {
		getByTestId: (testId: string | RegExp) => make(getByTestIdSelector(testId)),
		getByAltText: (text: string | RegExp, o?: TextOptions) =>
			make(getByAttributeTextSelector('alt', text, o)),
		getByLabel: (text: string | RegExp, o?: TextOptions) =>
			make(getByLabelSelector(text, o)),
		getByPlaceholder: (text: string | RegExp, o?: TextOptions) =>
			make(getByAttributeTextSelector('placeholder', text, o)),
		getByText: (text: string | RegExp, o?: TextOptions) =>
			make(getByTextSelector(text, o)),
		getByTitle: (text: string | RegExp, o?: TextOptions) =>
			make(getByAttributeTextSelector('title', text, o)),
		getByRole: (role: string, o: RoleOptions = {}) =>
			make(getByRoleSelector(role, o)),
	};
}

/**
 * Wrap a recorder object so ANY property it does not define throws a typed
 * error naming that property. `then` reads as `undefined` (so an accidental
 * `await` of a locator does not throw a confusing error) and symbols pass
 * through.
 */
function strict<T extends object>(target: T, what: string): T {
	return new Proxy(target, {
		get(obj, prop, receiver) {
			if (typeof prop === 'symbol' || prop in obj) {
				return Reflect.get(obj, prop, receiver);
			}
			if (prop === 'then') return undefined;
			throw new UnsupportedByTransportError(
				`${what}.${prop}`,
				'extension',
				`only selector-building ${what} methods can appear in a locator ` +
					`expression on this transport (getBy*, locator, filter, nth, first, ` +
					`last, and, or, frameLocator, contentFrame, owner); the verb itself ` +
					`performs the action`,
			);
		},
	});
}

function makeLocator(selector: string, options?: LocatorOptions): unknown {
	let s = selector;
	if (options?.hasText)
		s += ` >> internal:has-text=${escapeForTextSelector(options.hasText, false)}`;
	if (options?.hasNotText)
		s += ` >> internal:has-not-text=${escapeForTextSelector(options.hasNotText, false)}`;
	if (options?.has)
		s += ` >> internal:has=` + JSON.stringify(selectorOf(options.has, 'has'));
	if (options?.hasNot)
		s +=
			` >> internal:has-not=` +
			JSON.stringify(selectorOf(options.hasNot, 'hasNot'));
	if (options?.visible !== undefined)
		s += ` >> visible=${options.visible ? 'true' : 'false'}`;
	const self: Record<string | symbol, unknown> = {
		[KIND]: 'locator',
		[SELECTOR]: s,
		locator: (sel: unknown, o?: LocatorOptions) =>
			typeof sel === 'string'
				? makeLocator(s + ' >> ' + sel, o)
				: makeLocator(
						s +
							' >> internal:chain=' +
							JSON.stringify(selectorOf(sel, 'locator')),
						o,
					),
		...getByMethods((sel) => makeLocator(s + ' >> ' + sel)),
		frameLocator: (sel: string) => makeFrameLocator(s + ' >> ' + sel),
		contentFrame: () => makeFrameLocator(s),
		filter: (o?: LocatorOptions) => makeLocator(s, o),
		first: () => makeLocator(s + ' >> nth=0'),
		last: () => makeLocator(s + ' >> nth=-1'),
		nth: (index: number) => makeLocator(s + ` >> nth=${index}`),
		and: (other: unknown) =>
			makeLocator(
				s + ' >> internal:and=' + JSON.stringify(selectorOf(other, 'and')),
			),
		or: (other: unknown) =>
			makeLocator(
				s + ' >> internal:or=' + JSON.stringify(selectorOf(other, 'or')),
			),
		describe: (description: string) =>
			makeLocator(s + ' >> internal:describe=' + JSON.stringify(description)),
	};
	return strict(self, 'locator');
}

function makeFrameLocator(frameSelector: string): unknown {
	const enter = (sel: string) => `${frameSelector} >> ${ENTER_FRAME} >> ${sel}`;
	const self: Record<string | symbol, unknown> = {
		[KIND]: 'frameLocator',
		[SELECTOR]: frameSelector,
		locator: (sel: unknown, o?: LocatorOptions) =>
			makeLocator(
				enter(typeof sel === 'string' ? sel : selectorOf(sel, 'locator')),
				o,
			),
		...getByMethods((sel) => makeLocator(enter(sel))),
		owner: () => makeLocator(frameSelector),
		frameLocator: (sel: string) => makeFrameLocator(enter(sel)),
		first: () => makeFrameLocator(frameSelector + ' >> nth=0'),
		last: () => makeFrameLocator(frameSelector + ' >> nth=-1'),
		nth: (index: number) =>
			makeFrameLocator(frameSelector + ` >> nth=${index}`),
	};
	return strict(self, 'frameLocator');
}

function makePage(): unknown {
	const self: Record<string, unknown> = {
		locator: (sel: unknown, o?: LocatorOptions) =>
			makeLocator(
				typeof sel === 'string' ? sel : selectorOf(sel, 'locator'),
				o,
			),
		...getByMethods((sel) => makeLocator(sel)),
		frameLocator: (sel: string) => makeFrameLocator(sel),
	};
	return strict(self, 'page');
}

/**
 * Compile `expression` to Playwright's selector string.
 *
 * @throws UnsupportedByTransportError for a non-selector-building method.
 * @throws Error when the expression does not evaluate to a locator (e.g. a
 *   frame locator with no element step, or a syntax error).
 */
export function compileLocator(expression: string): string {
	let value: unknown;
	try {
		// The SAME evaluation the Playwright transports use (`resolveLocator`), so
		// a locator string means the same thing on every transport.
		// eslint-disable-next-line no-new-func
		const factory = new Function('page', 'p', `return (${expression});`) as (
			page: unknown,
			p: unknown,
		) => unknown;
		const page = makePage();
		value = factory(page, page);
	} catch (cause) {
		if (cause instanceof UnsupportedByTransportError) throw cause;
		throw new Error(
			`invalid locator expression ${JSON.stringify(expression)}: ${
				cause instanceof Error ? cause.message : String(cause)
			}`,
			{cause},
		);
	}
	const kind =
		typeof value === 'object' && value !== null
			? (value as {[KIND]?: string})[KIND]
			: undefined;
	if (kind !== 'locator') {
		throw new Error(
			`locator expression ${JSON.stringify(expression)} does not evaluate to ` +
				`a locator${kind === 'frameLocator' ? ' (it ends at a frameLocator: add an element step such as .locator(...) or .getByRole(...))' : ''}`,
		);
	}
	return (value as {[SELECTOR]: string})[SELECTOR];
}

/**
 * Split a selector at its frame hops, the way Playwright's server does before it
 * hands each part to the injected script of the right frame: every element
 * except the last addresses an `<iframe>` in the previous frame's document, and
 * the last addresses the target inside the innermost frame.
 *
 * The split is on the exact ` >> internal:control=enter-frame >> ` token the
 * compiler emits, at TOP level only: an `enter-frame` inside a quoted nested
 * selector (`internal:has="..."`) is JSON-escaped and never matches.
 */
export function splitFrameHops(selector: string): string[] {
	const parts = selector.split(` >> ${ENTER_FRAME} >> `);
	for (const part of parts) {
		if (part.includes(ENTER_FRAME)) {
			throw new UnsupportedByTransportError(
				'frame hop',
				'extension',
				`a frame step that is not followed by an element step (${JSON.stringify(selector)})`,
			);
		}
	}
	return parts;
}
