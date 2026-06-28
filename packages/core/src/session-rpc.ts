import {
	locator,
	validateSnapshotOptions,
	type Cookie,
	type QueryOptions,
	type QueryRow,
	type Snapshot,
	type SnapshotOptions,
	type WaitCondition,
} from './seam.js';
import type {WebHandsPage} from './seam.js';

/**
 * The wire protocol for driving the long-lived session over HTTP (ADR-0005).
 *
 * The served process holds ONE live {@link WebHandsPage} in memory; a thin client verb
 * cannot hold a JS reference to it across the process boundary, so each verb
 * call is sent as a small JSON request to the server, which runs it against its
 * live page and returns the result. This module is the SINGLE source of truth
 * for that request/response shape, imported by BOTH the server handler and the
 * client proxy so they cannot drift (mirrors how `serializeCookies` is shared
 * by the cookies verb and its test).
 *
 * It is a thin transport detail, NOT a second verb surface: every built-in
 * request maps 1:1 to a {@link WebHandsPage} method, and the seam's verb semantics
 * (ADR-0003/0004) are unchanged. The {@link LocatorString} brand and the
 * structured {@link WaitCondition} cross as plain JSON and are re-branded on the
 * server with {@link locator}; no Playwright/CDP type is ever named here.
 *
 * THIRD-PARTY HAND VERBS (Phase 2, Model B of the "hands" prd; ADR-0007). The
 * eight built-in verbs stay a CLOSED union (the 1:1 source of truth above). A
 * dynamically-loaded hand contributes a verb whose name `core` does NOT know at
 * compile time, so it cannot be a named member of that closed union without
 * re-meaning "closed". Instead it crosses as a SINGLE generic
 * {@link SessionRpcHandRequest} variant (`{verb: 'hand', name, args}`) that
 * names the contributed verb at runtime and carries its arguments. This is the
 * exact wire parallel of how a hand verb composes into the page object: by name,
 * dynamically, alongside the typed built-ins. The agent thereby gains a new tool
 * over the wire WITHOUT ever holding a live page handle.
 *
 * SERIALIZATION BOUNDARY (the load-bearing rule; prd's resolved Q3). A hand
 * verb's result crosses this RPC, so it MUST be serializable under the same
 * structured-clone contract `eval` documents (see {@link WebHandsPage.eval}): richer
 * than JSON, but a value with no transferable form does not round-trip. This is
 * enforced by CONVENTION + TYPES (a hand author returns serializable values),
 * NOT a blanket runtime clone here — a blanket clone would corrupt legitimate
 * in-process (Model A) returns, where a hand may pass/return live Playwright
 * handles within a single in-process call chain. A host-side runtime clone of
 * agent-verb results is available HARDENING for untrusted hands, not built here.
 * A page/in-hand throw REJECTS faithfully on the client exactly as the `eval`
 * path already does (the server maps it to an `ok: false` reply carrying the
 * message; the client re-throws a faithful `Error`).
 */

/** The path the session RPC is served under, below the server's base URL. */
export const SESSION_RPC_PATH = '/session/call';

/** A single verb call to run against the served live page. */
export type SessionRpcRequest =
	| SessionRpcBuiltInRequest
	| SessionRpcHandRequest;

/**
 * The CLOSED union of webhands' eight built-in verbs. Each variant maps 1:1 to a
 * {@link WebHandsPage} method in {@link applySessionRpc}; this is the single source of
 * truth for the built-in verb surface, shared verbatim by server and client.
 */
export type SessionRpcBuiltInRequest =
	| {readonly verb: 'navigate'; readonly url: string}
	| {readonly verb: 'snapshot'; readonly full?: boolean}
	| {readonly verb: 'click'; readonly locator: string}
	| {readonly verb: 'type'; readonly locator: string; readonly text: string}
	| {readonly verb: 'eval'; readonly expression: string}
	| {readonly verb: 'wait'; readonly condition: WaitCondition}
	| {readonly verb: 'cookies'}
	| {readonly verb: 'setCookies'; readonly cookies: readonly Cookie[]}
	| {
			readonly verb: 'query';
			readonly locator: string;
			readonly options?: QueryOptions;
	  }
	| {readonly verb: 'count'; readonly locator: string}
	| {readonly verb: 'exists'; readonly locator: string}
	| {readonly verb: 'isVisible'; readonly locator: string}
	| {
			readonly verb: 'getAttribute';
			readonly locator: string;
			readonly name: string;
	  };

/**
 * The OPEN escape for a dynamically-loaded third-party hand verb (Phase 2,
 * Model B; ADR-0007). Unlike the closed built-in union, `core` does not know the
 * verb's name at compile time, so it is carried at runtime: `name` is the
 * contributed verb's plain name (exactly as it composed into the page object,
 * not namespaced — a hand may even deliberately override a built-in, the
 * operator's choice per ADR-0007) and `args` are its JSON arguments.
 *
 * The returned value and any thrown error obey the same serialization +
 * rejection contract as `eval` (see this module's overview and {@link WebHandsPage.eval}).
 */
export interface SessionRpcHandRequest {
	readonly verb: 'hand';
	/** The hand-contributed verb's name (as it composed into the page object). */
	readonly name: string;
	/** The verb's arguments, carried as plain JSON (must be serializable). */
	readonly args: readonly unknown[];
}

/**
 * The server's reply to a {@link SessionRpcRequest}. `ok: true` carries the
 * verb's return value (for verbs that return data); `ok: false` carries the
 * page-side error message so the client can re-throw a faithful `Error` (a
 * page throw must REJECT on the client too, per the seam's `eval` contract).
 */
export type SessionRpcResponse =
	| {readonly ok: true; readonly value?: unknown}
	| {readonly ok: false; readonly error: string};

/**
 * Run one {@link SessionRpcRequest} against a live {@link WebHandsPage}, returning the
 * value the wire should carry back. The server's HTTP handler is just this plus
 * JSON framing; keeping the dispatch here (not inline in the handler) means the
 * verb-to-page mapping is in one place and unit-testable without HTTP.
 *
 * The locator string and wait condition arrive as plain JSON; we re-brand the
 * locator with {@link locator} before handing it to the page so the seam's
 * branded-string contract holds.
 */
export async function applySessionRpc(
	page: WebHandsPage,
	request: SessionRpcRequest,
): Promise<unknown> {
	switch (request.verb) {
		case 'navigate':
			await page.navigate(request.url);
			return undefined;
		case 'snapshot':
			// Validate on the SERVER side so a malformed request from ANY client
			// (not just the typed `makeRpcPage`) is rejected faithfully across the
			// seam, mirroring how a page/eval throw rejects. A raw client could POST
			// e.g. `{verb: 'snapshot', view: 'full'}`; we rebuild the snapshot
			// options from the request's non-`verb` keys and reject unknown ones
			// rather than silently dropping them and returning the wrong view.
			return page.snapshot(snapshotOptionsFromRequest(request));
		case 'click':
			await page.click(locator(request.locator));
			return undefined;
		case 'type':
			await page.type(locator(request.locator), request.text);
			return undefined;
		case 'eval':
			return page.eval(request.expression);
		case 'wait':
			await page.wait(rebrandWait(request.condition));
			return undefined;
		case 'cookies':
			return page.cookies();
		case 'setCookies':
			await page.setCookies(request.cookies);
			return undefined;
		case 'query':
			return page.query(locator(request.locator), request.options);
		case 'count':
			return page.count(locator(request.locator));
		case 'exists':
			return page.exists(locator(request.locator));
		case 'isVisible':
			return page.isVisible(locator(request.locator));
		case 'getAttribute':
			return page.getAttribute(locator(request.locator), request.name);
		case 'hand':
			return applyHandVerb(page, request);
	}
}

/**
 * Rebuild and validate the {@link SnapshotOptions} carried by a wire `snapshot`
 * request. The wire flattens `{full}` onto the request alongside `verb`; a raw
 * (untyped) client may also send a misspelled key such as `view`. We collect
 * every non-`verb` key into an options object and run it through the shared
 * {@link validateSnapshotOptions} so the server rejects an unknown/misshapen
 * option exactly as the in-process host does. Returns `undefined` when no
 * options were sent (the bare `snapshot()` case).
 */
function snapshotOptionsFromRequest(
	request: SessionRpcRequest & {readonly verb: 'snapshot'},
): SnapshotOptions | undefined {
	const {verb: _verb, ...rest} = request as Record<string, unknown> & {
		verb: 'snapshot';
	};
	// Drop an explicitly-absent `full` (the typed client always sends the key,
	// even as `undefined`) so a bare `snapshot()` stays `undefined`.
	if ('full' in rest && rest.full === undefined) {
		delete rest.full;
	}
	if (Object.keys(rest).length === 0) {
		return undefined;
	}
	return validateSnapshotOptions(rest as SnapshotOptions);
}

/**
 * Invoke a dynamically-loaded hand verb by name against the live composed page.
 *
 * The composed {@link WebHandsPage} carries the hand's verbs at runtime (the host merged
 * them in by name alongside the built-ins, see `composePage`), even though the
 * seam `WebHandsPage` TYPE only names the eight built-ins. We therefore look the verb up
 * on the page object as a runtime method and invoke it with the request's args.
 * An unknown name is a faithful error (the hand was not loaded / named that
 * verb), surfaced the same way a page-side throw is so the client rejects.
 *
 * The result is returned as-is: the serializable-only boundary is enforced by
 * convention + types on the hand author, NOT a runtime clone here (a blanket
 * clone would corrupt legitimate in-process Model A returns; see this module's
 * overview). What the hand returns is what the wire carries back; the JSON
 * framing in the server handler is the only encoding applied.
 */
async function applyHandVerb(
	page: WebHandsPage,
	request: SessionRpcHandRequest,
): Promise<unknown> {
	const verb = (page as unknown as Record<string, unknown>)[request.name];
	if (typeof verb !== 'function') {
		throw new Error(
			`no such hand verb '${request.name}' on the live page ` +
				`(is the hand loaded and named in config?)`,
		);
	}
	return (verb as (...args: readonly unknown[]) => unknown).call(
		page,
		...request.args,
	);
}

/**
 * A {@link WebHandsPage} whose verbs forward to a server via the supplied transport.
 *
 * Used by the client-side proxy (see `remote-session.ts`): each verb builds a
 * {@link SessionRpcRequest}, hands it to `send`, and shapes the reply back into
 * the verb's return type. The `send` function owns the actual HTTP; this keeps
 * the verb-to-request mapping (the other half of {@link applySessionRpc}) in
 * one place so request and response shapes cannot drift between the two sides.
 */
export function makeRpcPage(
	send: (request: SessionRpcRequest) => Promise<unknown>,
): WebHandsPage {
	return {
		async navigate(url) {
			await send({verb: 'navigate', url});
		},
		async snapshot(options) {
			// Fail fast on the client too, so a typed caller's mistake (e.g.
			// `{view: 'full'}`) is caught before a round-trip. The server
			// re-validates as the load-bearing check for untyped clients.
			validateSnapshotOptions(options);
			return (await send({
				verb: 'snapshot',
				full: options?.full,
			})) as Snapshot;
		},
		async click(target) {
			await send({verb: 'click', locator: target});
		},
		async type(target, text) {
			await send({verb: 'type', locator: target, text});
		},
		async eval(expression) {
			return send({verb: 'eval', expression});
		},
		async wait(condition) {
			await send({verb: 'wait', condition});
		},
		async cookies() {
			return (await send({verb: 'cookies'})) as readonly Cookie[];
		},
		async setCookies(cookies) {
			await send({verb: 'setCookies', cookies});
		},
		async query(target, options) {
			return (await send({
				verb: 'query',
				locator: target,
				options,
			})) as QueryRow[];
		},
		async count(target) {
			return (await send({verb: 'count', locator: target})) as number;
		},
		async exists(target) {
			return (await send({verb: 'exists', locator: target})) as boolean;
		},
		async isVisible(target) {
			return (await send({verb: 'isVisible', locator: target})) as boolean;
		},
		async getAttribute(target, name) {
			return (await send({
				verb: 'getAttribute',
				locator: target,
				name,
			})) as string | null;
		},
	};
}

/**
 * Invoke a dynamically-loaded hand verb over the session RPC by name (Phase 2,
 * Model B; ADR-0007). The client-side mirror of {@link applyHandVerb}: it builds
 * the single generic {@link SessionRpcHandRequest} and hands it to the SAME
 * `send` the built-in verbs use, so request/response shapes cannot drift.
 *
 * This is how the agent gains a new tool over the wire WITHOUT holding a live
 * page handle: it names the contributed verb and passes serializable args; the
 * server runs the hand against its own live page and returns a serializable
 * result. A page/in-hand throw rejects faithfully (the `send` re-throws the
 * server's error message), exactly as the `eval` path does.
 *
 * The result type is `unknown` because the hand decides the shape; callers
 * narrow it (mirrors {@link WebHandsPage.eval}).
 */
export async function callHandVerb(
	send: (request: SessionRpcRequest) => Promise<unknown>,
	name: string,
	...args: readonly unknown[]
): Promise<unknown> {
	return send({verb: 'hand', name, args});
}

/**
 * Re-brand a {@link WaitCondition} that arrived as plain JSON: only the
 * `locator` form carries a branded string, which JSON flattens to a plain
 * `string`, so we re-tag it before it reaches the page.
 */
function rebrandWait(condition: WaitCondition): WaitCondition {
	if (condition.kind === 'locator') {
		return {kind: 'locator', target: locator(condition.target)};
	}
	return condition;
}
