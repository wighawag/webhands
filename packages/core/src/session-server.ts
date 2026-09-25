import {createServer, type Server} from 'node:http';
import {connect} from 'node:net';
import {chmod, mkdir, rm, stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {
	InvalidSocketPathError,
	SessionAlreadyActiveError,
	SocketUnsupportedError,
} from './errors.js';
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
/**
 * Environment variable naming the unix socket path to serve on, the env-var half
 * of `serve --socket <path>` (ADR-0017). Mirrors how `WEBHANDS_HOME` and
 * `WEBHANDS_CHROME` work: the FLAG wins, the env var is for a caller that
 * cannot easily change the command line (a wrapper, a service unit, a jailed
 * shell's profile). Empty or unset means the default TCP listener.
 */
export const SESSION_SOCKET_ENV = 'WEBHANDS_SOCKET';

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
	 * server is a LOCAL tool on the user's machine (SPEC "Out of Scope": not a
	 * hosted service), so it never listens on a public interface.
	 */
	readonly host?: string;
	/** TCP port to bind. Defaults to `0` (an OS-assigned ephemeral port). */
	readonly port?: number;
	/**
	 * Serve on a UNIX SOCKET at this absolute path INSTEAD of a TCP port
	 * (ADR-0017). Omit for the default TCP listener; setting it makes
	 * {@link SessionServerOptions.host}/{@link SessionServerOptions.port} moot
	 * (nothing binds an IP address at all), and the advertised endpoint records
	 * `socket` with NO `url`.
	 *
	 * This exists for a caller that cannot reach loopback: a per-uid packet filter
	 * that drops `127.0.0.0/8` leaves a healthy TCP server unreachable (the SYN is
	 * dropped, so the symptom is a TIMEOUT, not a refusal). A unix socket is not IP
	 * traffic and traverses no filter chain, which is why it is the fix rather than
	 * a different host or port.
	 *
	 * The socket IS the access control: it is created 0600 and owned by the serving
	 * user, because `connect()` needs write permission on the inode. Unix only; on
	 * Windows this raises {@link SocketUnsupportedError} rather than quietly
	 * creating a named pipe with different rules.
	 */
	readonly socketPath?: string;
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
		socketPath,
		cdpEndpoint,
		...location
	} = options;

	// Socket mode is validated and cleared BEFORE the browser opens. A refused
	// path (wrong platform, too long, occupied by a real file) must not first cost
	// the user a browser launch, and the pre-open order means there is no session
	// to leak if it throws.
	if (socketPath !== undefined) {
		await prepareSocketPath(socketPath);
	}

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
		if (socketPath !== undefined) {
			await listenOnSocket(server, socketPath);
		} else {
			await listen(server, port, host);
		}
	} catch (cause) {
		// Binding failed after we opened the browser; do not leak the session.
		await session.close();
		throw cause;
	}

	const cdpPart = cdp !== undefined && cdp !== '' ? {cdpEndpoint: cdp} : {};
	let endpoint: SessionEndpoint;
	if (socketPath !== undefined) {
		// Socket mode advertises the PATH and no url: there is no honest URL for a
		// socket-served session, and the absence is what makes an old url-only
		// client degrade to "run serve first" (ADR-0017).
		endpoint = {socket: socketPath, pid: process.pid, ...cdpPart};
	} else {
		const address = server.address();
		if (address === null || typeof address === 'string') {
			await stopServer(server);
			await session.close();
			throw new Error('session server failed to bind to a TCP port');
		}
		endpoint = {
			url: `http://${host}:${address.port}`,
			pid: process.pid,
			...cdpPart,
		};
	}

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
			try {
				await clearSessionEndpoint(location);
				await stopServer(server);
				// The socket file is part of the advertised state, exactly like the
				// endpoint file, so teardown removes it too. Leaving it behind would
				// hand the next reader a path that looks like a live server.
				if (socketPath !== undefined) {
					await removeSessionSocket(socketPath);
				}
			} finally {
				// The BROWSER closes even if clearing the advertised state threw.
				// Removing the socket can legitimately fail (the path was replaced by
				// something that is not ours to delete) and `stopServer` can reject,
				// and because `stopped` is already set, a throw before this line
				// would leave an orphan browser that NO retry of `stop()` could ever
				// close. The error still propagates; the leak does not.
				await session.close();
			}
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

/**
 * The longest unix socket path the kernel will accept, conservatively.
 * `sockaddr_un.sun_path` is 108 bytes on Linux and 104 on macOS (including the
 * NUL), so 100 is short enough for both and leaves the check portable.
 */
const MAX_SOCKET_PATH_BYTES = 100;

/**
 * Make `socketPath` fit to listen on, or refuse it with a typed error. Called
 * BEFORE the browser opens (see {@link startSessionServer}).
 *
 * Three jobs, in the order a caller hits them:
 * 1. **Refuse a platform without real unix sockets** ({@link SocketUnsupportedError}).
 * 2. **Refuse an unusable path** ({@link InvalidSocketPathError}): over the
 *    `sun_path` limit, or occupied by something that is NOT a socket. The second
 *    is the important one: a stale socket is ours to remove, a regular file or
 *    directory is the user's data and we do not delete it to satisfy a flag.
 * 3. **Refuse to steal a LIVE socket.** The endpoint-file guard that enforces the
 *    single session is per HOME ROOT, so it cannot see a server that another
 *    root (another `WEBHANDS_HOME`, a wrapper that exported `WEBHANDS_SOCKET`,
 *    the eval harness) advertised at this same path. Unlinking there would take
 *    the path out from under a running session, silently: its endpoint file
 *    would still name this path, so the victim's next verb would drive OUR
 *    browser. So the path is probed first and a live listener is a refusal.
 * 4. **Clear a STALE socket** and create the parent dir. A crash leaves the
 *    socket file behind (nothing unlinks it for us), and `listen` on an existing
 *    path fails `EADDRINUSE`, so without this a hard kill that also lost the
 *    endpoint file would leave that path unusable with nothing to explain why.
 */
async function prepareSocketPath(socketPath: string): Promise<void> {
	if (process.platform === 'win32') {
		throw new SocketUnsupportedError(process.platform);
	}
	if (socketPath === '') {
		throw new InvalidSocketPathError(socketPath, 'the path is empty.');
	}
	const bytes = Buffer.byteLength(socketPath, 'utf8');
	if (bytes > MAX_SOCKET_PATH_BYTES) {
		throw new InvalidSocketPathError(
			socketPath,
			`it is ${bytes} bytes long and the kernel's limit for a socket path is ` +
				`~${MAX_SOCKET_PATH_BYTES} (sun_path is 108 bytes on Linux, 104 on ` +
				`macOS). Use a shorter path.`,
		);
	}
	// 0700 on any dir we CREATE: the socket's own 0600 is worthless if a third
	// party can write the directory holding it, because then they can unlink it
	// and bind their own in its place. `mode` is masked by the umask, so this can
	// only ever be tighter than the default, never looser, and an existing
	// directory (the usual `~/.webhands`) is left exactly as the user has it.
	await mkdir(dirname(socketPath), {recursive: true, mode: 0o700});
	if (await isSocketListening(socketPath)) {
		throw new InvalidSocketPathError(
			socketPath,
			'a server is already LISTENING on that socket. It was not removed: ' +
				'taking the path would silently redirect that session\u2019s verbs to ' +
				'this browser. Stop it first, or choose a different --socket path.',
		);
	}
	await removeSessionSocket(socketPath);
}

/**
 * Is something actually accepting connections on `socketPath`?
 *
 * This is the difference between a STALE socket (ours to unlink, the crash
 * recovery above) and a LIVE one (someone else's session, which we must not
 * steal). A dead listener's socket answers `connect()` with `ECONNREFUSED`,
 * which is exactly the discriminator.
 *
 * Ambiguity resolves to "alive", so a probe that times out (a listener whose
 * backlog is full, say) REFUSES rather than unlinks: the cost of a false
 * "alive" is a clear error the user can act on, and the cost of a false "stale"
 * is hijacking a running session.
 */
function isSocketListening(
	socketPath: string,
	timeoutMs = 1_000,
): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = connect({path: socketPath});
		const settle = (alive: boolean): void => {
			probe.destroy();
			resolve(alive);
		};
		probe.setTimeout(timeoutMs, () => settle(true));
		probe.once('connect', () => settle(true));
		// Absent path, not a socket, or nothing accepting: not live. The distinct
		// "exists but is not a socket" case is reported by `removeSessionSocket`,
		// which owns that message.
		probe.once('error', () => settle(false));
	});
}

/**
 * Remove a session socket file: the stale-socket cleanup, used both before
 * listening and on teardown.
 *
 * An absent path is not an error (teardown is idempotent). A path that exists
 * but is NOT a socket raises {@link InvalidSocketPathError} instead of being
 * unlinked, because at that point we are being asked to delete something we did
 * not create.
 */
export async function removeSessionSocket(socketPath: string): Promise<void> {
	let info;
	try {
		info = await stat(socketPath);
	} catch {
		return; // absent: nothing to clear
	}
	if (!info.isSocket()) {
		throw new InvalidSocketPathError(
			socketPath,
			'that path already exists and is NOT a socket, so it will not be ' +
				'removed. Choose a different --socket path.',
		);
	}
	await rm(socketPath, {force: true});
}

/**
 * Listen on a unix socket with the mode set DELIBERATELY to 0600.
 *
 * The socket's owner plus its mode is the WHOLE access gate here (`connect()`
 * requires write permission on the inode), so the mode cannot be left to
 * chance, and `listen(path)` applies the process umask: on a box with the common
 * `umask 022` the socket would land world-CONNECTABLE. So the umask is narrowed
 * to `0o177` for the duration of the bind, which closes the window in which the
 * inode exists with looser bits, and the explicit `chmod` after is the
 * belt-and-braces for any platform that does not honour umask here. Restoring
 * the umask in a `finally` keeps the change from leaking into the rest of this
 * long-lived process.
 */
async function listenOnSocket(
	server: Server,
	socketPath: string,
): Promise<void> {
	const previousUmask = process.umask(0o177);
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(socketPath, () => {
				server.removeListener('error', reject);
				resolve();
			});
		});
	} finally {
		process.umask(previousUmask);
	}
	await chmod(socketPath, 0o600);
}

/** Promisified `server.close`. */
function stopServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
}
