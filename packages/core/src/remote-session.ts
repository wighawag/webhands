import {
	callHandVerb,
	makeRpcPage,
	SESSION_RPC_PATH,
	SESSION_TRACE_PATH,
	type SessionRpcRequest,
	type SessionRpcResponse,
} from './session-rpc.js';
import type {Session} from './seam.js';
import type {VerbTraceEntry} from './verb-trace.js';

/**
 * A client-side {@link Session} that drives a session living in a SEPARATE
 * long-lived `serve` process over HTTP (ADR-0005).
 *
 * Each `webhands <verb>` is a thin client: it cannot hold a JS
 * reference to the server's live page, so this proxy turns every {@link WebHandsPage}
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
 *
 * THIRD-PARTY HAND VERBS (Phase 2, Model B; ADR-0007). Pass the NAMES of the
 * hand verbs the served process loaded as `handVerbs`; each is attached to the
 * returned `page` as a dynamic method forwarding over the RPC via
 * {@link callHandVerb}, so the agent gains those tools WITHOUT ever holding a
 * live page handle. They are NOT on the seam `WebHandsPage` type (the seam knows only
 * the eight built-ins), so a caller reaches them through a cast, exactly as a
 * third-party hand verb is reached on the in-process composed page. The result
 * crosses the wire as a serializable value and a page/in-hand throw rejects
 * faithfully, the same contract as the built-in verbs.
 */
export function connectRemoteSession(
	baseUrl: string,
	handVerbs: readonly string[] = [],
): Session {
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

	// (readSessionTrace lives below; see its own doc.)

	let resolveClosed!: () => void;
	const closedSignal = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});

	const page = makeRpcPage(send);
	// Attach each loaded hand verb as a dynamic method that forwards over the same
	// RPC `send`. The seam `WebHandsPage` type names only the built-ins, so these live on
	// the runtime object alongside them (mirroring how a hand verb composes into
	// the in-process page object); callers reach them through a cast.
	const pageWithHands = page as unknown as Record<string, unknown>;
	for (const name of handVerbs) {
		pageWithHands[name] = (...args: readonly unknown[]): Promise<unknown> =>
			callHandVerb(send, name, ...args);
	}

	return {
		page,
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

/**
 * Read the running session's ordered VERB TRACE over the session server's
 * read-only trace route (task `distill-verb-emits-hand-scaffold`).
 *
 * The thin-client `distill` verb runs in a SEPARATE process (like every other
 * verb) and cannot hold a JS reference to the server's in-memory trace, so it
 * fetches the SAME session's ordered {@link VerbTraceEntry} list over HTTP,
 * exactly as the verb proxy fetches results. This is a READ ONLY: it never
 * drives the page and never mutates the trace; it is the client mirror of the
 * server's {@link SESSION_TRACE_PATH} handler. A stale/unreachable advertised
 * endpoint surfaces a plain connection Error (mirrors `connectRemoteSession`'s
 * `send`).
 */
export async function readSessionTrace(
	baseUrl: string,
): Promise<readonly VerbTraceEntry[]> {
	const endpoint = new URL(SESSION_TRACE_PATH, baseUrl).toString();
	let res: Response;
	try {
		res = await fetch(endpoint, {method: 'GET'});
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		throw new Error(
			`could not reach the session server at ${baseUrl}: ${message}`,
		);
	}
	const reply = (await res.json()) as SessionRpcResponse;
	if (reply.ok) {
		return (reply.value ?? []) as readonly VerbTraceEntry[];
	}
	throw new Error(reply.error);
}
