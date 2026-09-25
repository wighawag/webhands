import {request as httpRequest} from 'node:http';
import {
	callHandVerb,
	makeRpcPage,
	SESSION_RPC_PATH,
	SESSION_TRACE_PATH,
	type SessionRpcRequest,
	type SessionRpcResponse,
} from './session-rpc.js';
import {NoLiveServerError} from './errors.js';
import type {Session} from './seam.js';
import type {VerbTraceEntry} from './verb-trace.js';

/**
 * WHERE a client reaches the served session: a TCP base URL, or a unix socket
 * path (ADR-0017). Structurally satisfied by a read `SessionEndpoint`, so the
 * normal call is `connectRemoteSession(await readSessionEndpoint())` and
 * DISCOVERY stays the single source of truth for the transport: no verb takes a
 * `--socket` flag, and no verb can choose TCP when a socket is advertised.
 */
export type SessionAddress =
	| {readonly url: string; readonly socket?: undefined}
	| {readonly socket: string; readonly url?: undefined};

/** A base URL string (the pre-ADR-0017 argument) or an address object. */
export type SessionTarget = string | SessionAddress;

/** An address resolved to the one transport it names. */
type ResolvedAddress =
	| {readonly kind: 'url'; readonly base: string}
	| {readonly kind: 'socket'; readonly socketPath: string};

/**
 * Resolve a {@link SessionTarget} to its transport, or raise the TYPED
 * {@link NoLiveServerError}.
 *
 * The error path is a compatibility guarantee, not defensiveness (ADR-0017). A
 * url-only caller written against the old shape reaches here as
 * `connectRemoteSession(endpoint.url)`, and for a socket-served session that
 * argument is `undefined`. Without this it would land in `new URL(path,
 * undefined)` and surface as a raw `TypeError: Invalid base URL`, which tells
 * the user nothing. It is the same conclusion the old ENDPOINT READER reaches
 * from the other direction (a file with no `url` reads as "no live server"), so
 * both halves of the old url-only path degrade to the one actionable error.
 *
 * A socket WINS over a url, matching `readSessionEndpoint`: socket mode exists
 * because loopback is unreachable, so preferring TCP would pick the one address
 * that cannot work.
 */
function resolveAddress(target: SessionTarget | undefined): ResolvedAddress {
	if (typeof target === 'string') {
		if (target === '') {
			throw new NoLiveServerError(
				'No session address was given (an empty base URL). Start a server ' +
					'with `serve` first.',
			);
		}
		return {kind: 'url', base: target};
	}
	if (target !== undefined && target !== null) {
		if (typeof target.socket === 'string' && target.socket !== '') {
			return {kind: 'socket', socketPath: target.socket};
		}
		if (typeof target.url === 'string' && target.url !== '') {
			return {kind: 'url', base: target.url};
		}
	}
	throw new NoLiveServerError(
		'No reachable session address was found: the advertised endpoint carries ' +
			'no `url`, which is how a session served over a UNIX SOCKET appears to a ' +
			'client that can only dial a URL. Pass the whole endpoint (it names its ' +
			'own transport), or start a TCP server with `serve`.',
	);
}

/** How an address reads in an error message (the url, or the socket path). */
function describeAddress(address: ResolvedAddress): string {
	return address.kind === 'url'
		? address.base
		: `unix socket ${address.socketPath}`;
}

/**
 * One request/response against the served session, over whichever transport the
 * address names. Returns the raw response body; the callers parse the RPC
 * envelope.
 *
 * The socket branch uses `node:http`'s `request({socketPath})` rather than
 * `fetch`. `fetch` cannot be pointed at a unix socket without undici's `Agent`,
 * which Node does not re-export from any builtin, so the alternative is a
 * DEPENDENCY on undici for two call sites (this and the trace GET) in a package
 * whose client half currently has none. The builtin is the smaller change.
 */
function sendHttp(
	address: ResolvedAddress,
	path: string,
	method: 'GET' | 'POST',
	body?: string,
): Promise<string> {
	if (address.kind === 'url') {
		const endpoint = new URL(path, address.base).toString();
		return fetch(endpoint, {
			method,
			...(body !== undefined
				? {headers: {'content-type': 'application/json'}, body}
				: {}),
		}).then((res) => res.text());
	}
	return new Promise<string>((resolve, reject) => {
		const req = httpRequest(
			{
				socketPath: address.socketPath,
				path,
				method,
				...(body !== undefined
					? {
							headers: {
								'content-type': 'application/json',
								'content-length': Buffer.byteLength(body),
							},
						}
					: {}),
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
				res.on('error', reject);
			},
		);
		req.on('error', reject);
		if (body !== undefined) req.write(body);
		req.end();
	});
}

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
	target: SessionTarget,
	handVerbs: readonly string[] = [],
): Session {
	const address = resolveAddress(target);

	const send = async (request: SessionRpcRequest): Promise<unknown> => {
		let text: string;
		try {
			text = await sendHttp(
				address,
				SESSION_RPC_PATH,
				'POST',
				JSON.stringify(request),
			);
		} catch (cause) {
			// The advertised server is unreachable (it died without clearing its
			// endpoint file, say). Surface a plain Error; the CLI maps the discovery
			// MISS (no endpoint file) to "run serve first", but a stale-but-present
			// endpoint that no longer answers is a genuine connection failure.
			const message = cause instanceof Error ? cause.message : String(cause);
			throw new Error(
				`could not reach the session server at ${describeAddress(address)}: ` +
					`${message}`,
			);
		}
		const reply = JSON.parse(text) as SessionRpcResponse;
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
	target: SessionTarget,
): Promise<readonly VerbTraceEntry[]> {
	const address = resolveAddress(target);
	let text: string;
	try {
		text = await sendHttp(address, SESSION_TRACE_PATH, 'GET');
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		throw new Error(
			`could not reach the session server at ${describeAddress(address)}: ` +
				`${message}`,
		);
	}
	const reply = JSON.parse(text) as SessionRpcResponse;
	if (reply.ok) {
		return (reply.value ?? []) as readonly VerbTraceEntry[];
	}
	throw new Error(reply.error);
}
