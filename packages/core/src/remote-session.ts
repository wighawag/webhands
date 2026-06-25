import {
	makeRpcPage,
	SESSION_RPC_PATH,
	type SessionRpcRequest,
	type SessionRpcResponse,
} from './session-rpc.js';
import type {Session} from './seam.js';

/**
 * A client-side {@link Session} that drives a session living in a SEPARATE
 * long-lived `serve` process over HTTP (ADR-0005).
 *
 * Each `webhands <verb>` is a thin client: it cannot hold a JS
 * reference to the server's live page, so this proxy turns every {@link Page}
 * verb into a session-RPC call to the running server (see `session-rpc.ts`) and
 * returns the result. The verb command code is UNCHANGED — it still calls
 * `provider(target)` then runs verbs against the returned `Session.page` then
 * calls `Session.close()`; only WHAT the session is changes.
 *
 * The critical difference from a local session: {@link Session.close} here is a
 * NO-OP. The served process owns the single live session's lifetime; a thin
 * client closing after one verb must NOT tear down the shared browser, or the
 * next verb invocation would have nothing to drive. Teardown is explicit
 * (`stop`), exactly as ADR-0005 requires. This is the whole reason cross-
 * invocation persistence works: the page state survives because the client's
 * `close()` does not reach across to the server's session.
 */
export function connectRemoteSession(baseUrl: string): Session {
	const endpoint = new URL(SESSION_RPC_PATH, baseUrl).toString();

	const send = async (request: SessionRpcRequest): Promise<unknown> => {
		let res: Response;
		try {
			res = await fetch(endpoint, {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify(request),
			});
		} catch (cause) {
			// The advertised server is unreachable (it died without clearing its
			// endpoint file, say). Surface a plain Error; the CLI maps the discovery
			// MISS (no endpoint file) to "run serve first", but a stale-but-present
			// endpoint that no longer answers is a genuine connection failure.
			const message = cause instanceof Error ? cause.message : String(cause);
			throw new Error(
				`could not reach the session server at ${baseUrl}: ${message}`,
			);
		}
		const reply = (await res.json()) as SessionRpcResponse;
		if (reply.ok) {
			return reply.value;
		}
		// Re-throw a faithful Error so a page-side throw REJECTS on the client too,
		// preserving the seam's `eval` "a page throw rejects" contract across the
		// process boundary.
		throw new Error(reply.error);
	};

	let resolveClosed!: () => void;
	const closedSignal = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});

	return {
		page: makeRpcPage(send),
		async close() {
			// Intentionally a no-op against the SERVER: the served process owns the
			// session's lifetime (see this module's overview). Teardown is the
			// explicit `stop` verb. We still resolve the local close signal so a
			// caller awaiting waitForClose() on this client handle unblocks.
			resolveClosed();
		},
		waitForClose(): Promise<void> {
			// A client never waits on the user closing the window — that is the
			// server's concern; this resolves on a local close() call.
			return closedSignal;
		},
	};
}
