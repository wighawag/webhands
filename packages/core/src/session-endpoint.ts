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
 * `my-browser-controller <verb>` is a thin client that must FIND that running
 * server. The server advertises itself by writing a small endpoint file under
 * the controller home root (the same SHARED location profiles live under, see
 * {@link resolveHomeRoot}); client verbs read it to learn where to send their
 * verb calls. When no endpoint file exists, no server is live, and a verb errors
 * with "run `serve` first" rather than auto-spawning a browser (ADR-0005:
 * lifecycle is EXPLICIT in v1).
 *
 * Because this writes under the real `~/.my-browser-controller` by default,
 * TESTS MUST override the root to a temp dir (via {@link ProfileLocationOptions})
 * and assert the real location is untouched, exactly as the profile location
 * does.
 */

/** The endpoint file name under the controller home root. */
export const SESSION_ENDPOINT_FILENAME = 'session-endpoint.json';

/**
 * What the served process advertises about itself for client discovery. Kept
 * deliberately small: the base `url` a client posts verb calls to, plus the
 * `pid` so a human/test can confirm or signal the owning process.
 */
export interface SessionEndpoint {
	/** The base HTTP URL the served session listens on (e.g. `http://127.0.0.1:53113`). */
	readonly url: string;
	/** The PID of the served process, for confirmation / signalling. */
	readonly pid: number;
}

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
		const parsed = JSON.parse(text) as Partial<SessionEndpoint>;
		if (
			typeof parsed.url === 'string' &&
			parsed.url !== '' &&
			typeof parsed.pid === 'number'
		) {
			return {url: parsed.url, pid: parsed.pid};
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
