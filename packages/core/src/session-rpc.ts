import {
	locator,
	type Cookie,
	type Snapshot,
	type WaitCondition,
} from './seam.js';
import type {Page} from './seam.js';

/**
 * The wire protocol for driving the long-lived session over HTTP (ADR-0005).
 *
 * The served process holds ONE live {@link Page} in memory; a thin client verb
 * cannot hold a JS reference to it across the process boundary, so each verb
 * call is sent as a small JSON request to the server, which runs it against its
 * live page and returns the result. This module is the SINGLE source of truth
 * for that request/response shape, imported by BOTH the server handler and the
 * client proxy so they cannot drift (mirrors how `serializeCookies` is shared
 * by the cookies verb and its test).
 *
 * It is a thin transport detail, NOT a second verb surface: every request maps
 * 1:1 to a {@link Page} method, and the seam's verb semantics (ADR-0003/0004)
 * are unchanged. The {@link LocatorString} brand and the structured
 * {@link WaitCondition} cross as plain JSON and are re-branded on the server
 * with {@link locator}; no Playwright/CDP type is ever named here.
 */

/** The path the session RPC is served under, below the server's base URL. */
export const SESSION_RPC_PATH = '/session/call';

/** A single verb call to run against the served live page. */
export type SessionRpcRequest =
	| {readonly verb: 'navigate'; readonly url: string}
	| {readonly verb: 'snapshot'; readonly full?: boolean}
	| {readonly verb: 'click'; readonly locator: string}
	| {readonly verb: 'type'; readonly locator: string; readonly text: string}
	| {readonly verb: 'eval'; readonly expression: string}
	| {readonly verb: 'wait'; readonly condition: WaitCondition}
	| {readonly verb: 'cookies'}
	| {readonly verb: 'setCookies'; readonly cookies: readonly Cookie[]};

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
 * Run one {@link SessionRpcRequest} against a live {@link Page}, returning the
 * value the wire should carry back. The server's HTTP handler is just this plus
 * JSON framing; keeping the dispatch here (not inline in the handler) means the
 * verb-to-page mapping is in one place and unit-testable without HTTP.
 *
 * The locator string and wait condition arrive as plain JSON; we re-brand the
 * locator with {@link locator} before handing it to the page so the seam's
 * branded-string contract holds.
 */
export async function applySessionRpc(
	page: Page,
	request: SessionRpcRequest,
): Promise<unknown> {
	switch (request.verb) {
		case 'navigate':
			await page.navigate(request.url);
			return undefined;
		case 'snapshot':
			return page.snapshot({full: request.full});
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
	}
}

/**
 * A {@link Page} whose verbs forward to a server via the supplied transport.
 *
 * Used by the client-side proxy (see `remote-session.ts`): each verb builds a
 * {@link SessionRpcRequest}, hands it to `send`, and shapes the reply back into
 * the verb's return type. The `send` function owns the actual HTTP; this keeps
 * the verb-to-request mapping (the other half of {@link applySessionRpc}) in
 * one place so request and response shapes cannot drift between the two sides.
 */
export function makeRpcPage(
	send: (request: SessionRpcRequest) => Promise<unknown>,
): Page {
	return {
		async navigate(url) {
			await send({verb: 'navigate', url});
		},
		async snapshot(options) {
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
	};
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
