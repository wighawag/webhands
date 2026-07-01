import {createServer, type Server} from 'node:http';
import {SessionAlreadyActiveError} from './errors.js';
import type {ProfileLocationOptions} from './profile-location.js';
import {
	clearSessionEndpoint,
	writeSessionEndpoint,
	type SessionEndpoint,
} from './session-endpoint.js';
import {
	applySessionRpc,
	SESSION_RPC_PATH,
	SESSION_TRACE_PATH,
	type SessionRpcRequest,
	type SessionRpcResponse,
} from './session-rpc.js';
import type {OpenTarget, Session, Transport} from './seam.js';
import {createVerbTrace, type VerbTrace} from './verb-trace.js';

/**
 * The long-lived host that keeps ONE browser session alive between separate CLI
 * invocations (ADR-0005; ADR-0001's control loop made concrete).
 *
 * This IS the controller: it opens the single live {@link Session} ONCE through
 * a {@link Transport} and then serves that already-live page over HTTP, so each
 * `webhands <verb>` thin-client process drives the SAME page state
 * (not just the on-disk profile) and exits. The browser is launched once here,
 * never per verb. It owns three things ADR-0005 calls out:
 *
 * 1. **Single session.** It holds exactly one session; a second {@link open}
 *    while one is live is a {@link SessionAlreadyActiveError}, not a second
 *    browser.
 * 2. **Discovery.** On start it writes its endpoint (the bound URL + pid) under
 *    the config dir so client verbs can find it; on stop it clears that file.
 * 3. **Explicit teardown.** {@link stop} closes the browser and stops the
 *    listener; nothing auto-spawns and nothing auto-tears-down.
 *
 * The HTTP surface here is the small session RPC (`/session/call`, see
 * `session-rpc.ts`), deliberately SEPARATE from incur's per-verb commands: a
 * verb command opens-and-closes a session per call, which is exactly what
 * cross-invocation persistence must NOT do. The CLI's `serve` command wraps
 * this server; the CLI's verb commands become thin clients of it.
 *
 * Shared-write isolation: the endpoint file lives under the controller home
 * root, so a {@link SessionServer} created with a temp `root`/`env` (via
 * {@link SessionServerOptions}) writes only there, and tests assert the real
 * `~/.webhands` is untouched.
 */
export interface SessionServerOptions extends ProfileLocationOptions {
	/**
	 * The transport that opens the single live session (defaults to the caller's
	 * choice of launch/attach transport). Injectable so a test drives the server
	 * with any seam transport (e.g. a real Playwright launch against the local
	 * fixture profile) without the server hard-coding one.
	 */
	readonly transport: Transport;
	/**
	 * Host to bind the HTTP listener to. Defaults to loopback (`127.0.0.1`): the
	 * server is a LOCAL tool on the user's machine (PRD "Out of Scope": not a
	 * hosted service), so it never listens on a public interface.
	 */
	readonly host?: string;
	/** TCP port to bind. Defaults to `0` (an OS-assigned ephemeral port). */
	readonly port?: number;
	/**
	 * OPTIONAL resolver for the served browser's CDP / remote-debugging endpoint,
	 * to advertise a SHARED driving surface (finding
	 * `baseline-comparison-needs-a-shared-driving-surface-not-two-browsers`).
	 * Called AFTER the session opens (so the transport has resolved its debugging
	 * port); its result is folded into the written {@link SessionEndpoint} as
	 * `cdpEndpoint`. Kept as a resolver (not a value) so the CDP endpoint stays a
	 * CONCRETE-transport detail off the verb seam (ADR-0003: no CDP type on
	 * {@link Transport}/{@link Session}). Omit (or resolve `undefined`) for the
	 * default no-shared-surface serve.
	 */
	readonly cdpEndpoint?: () => string | undefined;
}

/** A running {@link SessionServer}: its advertised endpoint and how to stop it. */
export interface RunningSessionServer {
	/** The endpoint advertised under the config dir for client discovery. */
	readonly endpoint: SessionEndpoint;
	/**
	 * The per-session VERB TRACE (task `serve-session-verb-trace`): the ordered,
	 * in-memory record of the verbs that drove this session's live page, read
	 * in-process by the future `distill` verb from the SAME live session. It is a
	 * READ-ONLY {@link VerbTrace} view (the recorder side stays with the server's
	 * RPC dispatch), so a reader can only read the ordered steps, not append. The
	 * trace lives only in memory for the session's lifetime; nothing persists it.
	 */
	readonly trace: VerbTrace;
	/**
	 * Tear the session down: close the browser, stop the HTTP listener, and clear
	 * the endpoint file. Idempotent.
	 */
	stop(): Promise<void>;
}

/**
 * Start the long-lived session server: open the single session via the
 * transport, bind the HTTP listener, advertise the endpoint, and serve the
 * session RPC. Returns once the server is live and discoverable.
 *
 * Enforces the single-session invariant ACROSS processes via the endpoint file:
 * if a live endpoint is already advertised, this refuses with
 * {@link SessionAlreadyActiveError} rather than opening a second browser. (The
 * caller checks discovery first; this is the last-line guard.)
 */
export async function startSessionServer(
	target: OpenTarget,
	options: SessionServerOptions,
): Promise<RunningSessionServer> {
	const {
		transport,
		host = '127.0.0.1',
		port = 0,
		cdpEndpoint,
		...location
	} = options;

	// Open the ONE live session up front: the browser launches here, once.
	const session: Session = await transport.open(target);

	// The per-session verb trace: one in-memory recorder for this session's whole
	// lifetime (task `serve-session-verb-trace`). Every verb dispatched against
	// this session's page appends to it (see `handleRequest`), and the read-only
	// view is exposed on the returned server for the in-process `distill` reader.
	const trace = createVerbTrace();

	// Resolve the shared-driving-surface CDP endpoint AFTER open (the transport
	// has its debugging port by now), if a resolver was supplied. Undefined when
	// not requested or unavailable (e.g. an attach session).
	const cdp = cdpEndpoint?.();

	let server: Server;
	try {
		server = createServer((req, res) => {
			handleRequest(session, trace, req, res);
		});
		await listen(server, port, host);
	} catch (cause) {
		// Binding failed after we opened the browser; do not leak the session.
		await session.close();
		throw cause;
	}

	const address = server.address();
	if (address === null || typeof address === 'string') {
		await stopServer(server);
		await session.close();
		throw new Error('session server failed to bind to a TCP port');
	}

	const endpoint: SessionEndpoint = {
		url: `http://${host}:${address.port}`,
		pid: process.pid,
		...(cdp !== undefined && cdp !== '' ? {cdpEndpoint: cdp} : {}),
	};

	try {
		await writeSessionEndpoint(endpoint, location);
	} catch (cause) {
		await stopServer(server);
		await session.close();
		throw cause;
	}

	let stopped = false;
	return {
		endpoint,
		trace,
		async stop() {
			if (stopped) return;
			stopped = true;
			await clearSessionEndpoint(location);
			await stopServer(server);
			await session.close();
		},
	};
}

/**
 * Guard the single-session invariant against double-open. The mechanism a
 * caller actually relies on is discovery (no endpoint file ⇒ no live server);
 * this is the explicit error a caller raises when it finds one already live and
 * wants to refuse rather than open a second.
 */
export function sessionAlreadyActive(): SessionAlreadyActiveError {
	return new SessionAlreadyActiveError();
}

/** Handle one session-RPC HTTP request against the live session's page. */
function handleRequest(
	session: Session,
	trace: import('./verb-trace.js').MutableVerbTrace,
	req: import('node:http').IncomingMessage,
	res: import('node:http').ServerResponse,
): void {
	const url = req.url ?? '/';
	const path = url.split('?')[0];
	// GET the in-memory verb trace: the thin-client `distill` verb reads the SAME
	// session's ordered trace over this route (task
	// `distill-verb-emits-hand-scaffold`). Read-only; returns the entries as JSON.
	if (req.method === 'GET' && path === SESSION_TRACE_PATH) {
		writeJson(res, 200, {ok: true, value: trace.entries()});
		return;
	}
	if (req.method !== 'POST' || path !== SESSION_RPC_PATH) {
		writeJson(res, 404, {
			ok: false,
			error: `no route for ${req.method} ${path}`,
		});
		return;
	}

	collectBody(req)
		.then(async (body) => {
			let request: SessionRpcRequest;
			try {
				request = JSON.parse(body) as SessionRpcRequest;
			} catch {
				writeJson(res, 400, {ok: false, error: 'invalid JSON request body'});
				return;
			}
			try {
				// Pass the session's trace so each verb is recorded (in order, with the
				// request as it arrived so `{ENV:NAME}` stays a token) AFTER it runs.
				const value = await applySessionRpc(session.page, request, trace);
				const reply: SessionRpcResponse = {ok: true, value};
				writeJson(res, 200, reply);
			} catch (cause) {
				// A verb that throws in the page (or a closed session) maps to an
				// ok:false reply carrying the message; the client re-throws a faithful
				// Error so the seam's "a page throw rejects" contract holds remotely.
				const message = cause instanceof Error ? cause.message : String(cause);
				const reply: SessionRpcResponse = {ok: false, error: message};
				writeJson(res, 200, reply);
			}
		})
		.catch((cause: unknown) => {
			const message = cause instanceof Error ? cause.message : String(cause);
			writeJson(res, 500, {ok: false, error: message});
		});
}

/** Read a request body to a string. */
function collectBody(
	req: import('node:http').IncomingMessage,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/** Write a JSON response with a status code. */
function writeJson(
	res: import('node:http').ServerResponse,
	status: number,
	body: SessionRpcResponse,
): void {
	res.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
	res.end(JSON.stringify(body));
}

/** Promisified `server.listen`. */
function listen(server: Server, port: number, host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			server.removeListener('error', reject);
			resolve();
		});
	});
}

/** Promisified `server.close`. */
function stopServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
}
