import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {
	resolveHomeRoot,
	type ProfileLocationOptions,
} from './profile-location.js';

/**
 * Cross-invocation session DISCOVERY (ADR-0005).
 *
 * The long-lived `incur serve` process owns the one live browser session; each
 * `webhands <verb>` is a thin client that must FIND that running
 * server. The server advertises itself by writing a small endpoint file under
 * the controller home root (the same SHARED location profiles live under, see
 * {@link resolveHomeRoot}); client verbs read it to learn where to send their
 * verb calls. When no endpoint file exists, no server is live, and a verb errors
 * with "run `serve` first" rather than auto-spawning a browser (ADR-0005:
 * lifecycle is EXPLICIT in v1).
 *
 * Because this writes under the real `~/.webhands` by default,
 * TESTS MUST override the root to a temp dir (via {@link ProfileLocationOptions})
 * and assert the real location is untouched, exactly as the profile location
 * does.
 */

/** The endpoint file name under the controller home root. */
export const SESSION_ENDPOINT_FILENAME = 'session-endpoint.json';

/**
 * What EVERY advertised endpoint carries, whichever transport it names.
 *
 * The endpoint file is the single source of truth for HOW to reach the session
 * (ADR-0005, ADR-0017): a client reads it and learns both the address and the
 * transport, so no verb ever needs a `--socket` flag of its own.
 */
interface SessionEndpointCommon {
	/** The PID of the served process, for confirmation / signalling. */
	readonly pid: number;
	/**
	 * OPTIONAL: the Chromium CDP / remote-debugging endpoint of the served
	 * browser (e.g. `http://127.0.0.1:9222`), present ONLY when `serve` was asked
	 * to expose a SHARED driving surface. A SEPARATE Playwright client can
	 * `chromium.connectOverCDP(<cdpEndpoint>)` and drive the SAME live page this
	 * server holds, so a tool reading the page (the eval harness) sees what that
	 * client drove (finding
	 * `baseline-comparison-needs-a-shared-driving-surface-not-two-browsers`).
	 *
	 * It is DISTINCT from {@link SessionEndpoint.url}: `url` is the session-RPC
	 * verb channel (`/session/call`); `cdpEndpoint` is the raw CDP surface. Absent
	 * when CDP exposure was not requested or the launch could not advertise a
	 * debugging port (e.g. an `attach` session, which has no harness-owned port).
	 * Like the serve `url`, it is loopback-only — never expose it to untrusted
	 * callers (CONTEXT.md).
	 */
	readonly cdpEndpoint?: string;
}

/**
 * A session served over a TCP port: the DEFAULT, and the only shape written
 * before ADR-0017. `url` is the base a client posts verb calls to.
 */
export interface TcpSessionEndpoint extends SessionEndpointCommon {
	/** The base HTTP URL the served session listens on (e.g. `http://127.0.0.1:53113`). */
	readonly url: string;
	/** Never set in TCP mode; present so the union discriminates on absence. */
	readonly socket?: undefined;
}

/**
 * A session served over a UNIX SOCKET (`serve --socket <path>`, ADR-0017): the
 * mode for a caller that CANNOT reach loopback, because a unix socket is not IP
 * traffic and so traverses no packet-filter chain at all.
 *
 * `url` is deliberately ABSENT rather than synthesised. There is no honest URL
 * for a socket-served session (`http://localhost/` would name an address that is
 * either wrong or, worse, someone else's listener), and the absence is exactly
 * what makes an OLD url-only client degrade to "no live server" instead of
 * dialling the wrong thing (see {@link readSessionEndpoint}).
 */
export interface SocketSessionEndpoint extends SessionEndpointCommon {
	/** Absolute path of the listening unix socket, mode 0600, owned by the serving user. */
	readonly socket: string;
	/** Never set in socket mode; present so the union discriminates on absence. */
	readonly url?: undefined;
}

/**
 * What the served process advertises about itself for client discovery: an
 * address (a TCP {@link TcpSessionEndpoint.url} or a
 * {@link SocketSessionEndpoint.socket} path) plus the `pid` so a human/test can
 * confirm or signal the owning process.
 *
 * It is a UNION, not a record with two optional fields, because a session is
 * reachable exactly one way and a client must not be able to read a
 * socket-served endpoint as though it had a URL.
 */
export type SessionEndpoint = TcpSessionEndpoint | SocketSessionEndpoint;

/**
 * Resolve the absolute path of the endpoint file for a given home root. Pure
 * (touches no filesystem); precedence matches {@link resolveHomeRoot} so the
 * endpoint file always sits beside the profiles dir under the same root.
 */
export function resolveSessionEndpointPath(
	options: ProfileLocationOptions = {},
): string {
	return join(resolveHomeRoot(options), SESSION_ENDPOINT_FILENAME);
}

/**
 * Advertise a live served session by writing its endpoint file (creating the
 * home root if absent). Overwrites any stale file; the server owns this file's
 * lifetime and clears it on stop.
 */
export async function writeSessionEndpoint(
	endpoint: SessionEndpoint,
	options: ProfileLocationOptions = {},
): Promise<string> {
	const path = resolveSessionEndpointPath(options);
	await mkdir(dirname(path), {recursive: true});
	await writeFile(path, JSON.stringify(endpoint, null, 2), 'utf8');
	return path;
}

/**
 * Read the advertised endpoint, or `undefined` when no server is live (the file
 * is absent or unreadable). Discovery is best-effort: a malformed file is
 * treated as "no live server" so a client falls through to the clear
 * "run `serve` first" error rather than crashing on a partial write.
 *
 * TRANSPORT PRECEDENCE: an advertised `socket` WINS over an advertised `url`.
 * The socket mode exists because loopback is unreachable for the caller
 * (ADR-0017), so silently preferring TCP when both appear would send a verb at
 * the one address that cannot work. A file carrying both is not a shape we
 * write; treating socket as authoritative is the safe reading of it.
 *
 * COMPATIBILITY, both directions (ADR-0017):
 * - A NEW client reading an OLD url-shaped file gets the TCP endpoint, exactly
 *   as before. That is why the url branch is kept verbatim rather than folded
 *   into a generic "address" field, which would have made every previously
 *   written endpoint file unreadable.
 * - An OLD client (this function as it shipped through 0.7.x, which required
 *   `url` + `pid`) reading a NEW socket-shaped file finds no `url` and returns
 *   `undefined`, i.e. "no live server", so it prints "run `serve` first" rather
 *   than crashing. That degradation is DESIGNED, and the reason a socket
 *   endpoint carries no synthetic `url`.
 */
export async function readSessionEndpoint(
	options: ProfileLocationOptions = {},
): Promise<SessionEndpoint | undefined> {
	const path = resolveSessionEndpointPath(options);
	let text: string;
	try {
		text = await readFile(path, 'utf8');
	} catch {
		return undefined;
	}
	try {
		// Typed as `unknown` fields, not as a Partial of the union: the file is
		// UNTRUSTED input (a partial write, an older or newer writer), and every
		// field below is validated before it is believed.
		const parsed = JSON.parse(text) as {
			url?: unknown;
			socket?: unknown;
			pid?: unknown;
			cdpEndpoint?: unknown;
		};
		if (typeof parsed.pid !== 'number') {
			return undefined;
		}
		const cdp =
			typeof parsed.cdpEndpoint === 'string' && parsed.cdpEndpoint !== ''
				? {cdpEndpoint: parsed.cdpEndpoint}
				: {};
		if (typeof parsed.socket === 'string' && parsed.socket !== '') {
			return {socket: parsed.socket, pid: parsed.pid, ...cdp};
		}
		if (typeof parsed.url === 'string' && parsed.url !== '') {
			return {url: parsed.url, pid: parsed.pid, ...cdp};
		}
	} catch {
		// fall through
	}
	return undefined;
}

/** Remove the endpoint file (teardown). Absent file is not an error. */
export async function clearSessionEndpoint(
	options: ProfileLocationOptions = {},
): Promise<void> {
	const path = resolveSessionEndpointPath(options);
	await rm(path, {force: true});
}
