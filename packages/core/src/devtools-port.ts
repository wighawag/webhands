import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Reading the remote-debugging port a Chromium chose, from the
 * `DevToolsActivePort` file it writes into its user-data dir.
 *
 * Chromium started with `--remote-debugging-port=0` picks a free port and writes
 * it as the FIRST LINE of that file, shortly AFTER the process is up. Both places
 * that need this do the same thing (the launch transport's opt-in `exposeCdp`,
 * and the real-Chrome spawn), so it lives here ONCE rather than as two
 * near-identical polling loops that can drift.
 *
 * It is a plain string port / URL, never a Playwright or CDP type, so it crosses
 * module boundaries freely (ADR-0003).
 */

/** How long to wait, by default, for Chromium to write the port file. */
const DEFAULT_TIMEOUT_MS = 1_000;

/** How often to re-read the port file while waiting. */
const POLL_INTERVAL_MS = 20;

/** Options for {@link readDevToolsPort} / {@link resolveCdpEndpoint}. */
export interface DevToolsPortOptions {
	/**
	 * How long to keep polling for the port file before giving up, in ms.
	 * Defaults to {@link DEFAULT_TIMEOUT_MS}, which is ample for a browser that is
	 * already running; a caller that has just SPAWNED a cold browser (real Chrome
	 * opening a warm profile with extensions) should allow much longer.
	 */
	readonly timeoutMs?: number;
	/**
	 * Abort the wait early when this returns a reason string, e.g. "the process
	 * exited". Without it, a browser that dies on startup is indistinguishable
	 * from one that is merely slow, and the caller waits out the whole timeout for
	 * a port that will never appear.
	 */
	readonly abortReason?: () => string | undefined;
}

/**
 * Poll `<userDataDir>/DevToolsActivePort` until it holds a port, and return it.
 *
 * Returns `undefined` when the port never appeared within the timeout, or when
 * {@link DevToolsPortOptions.abortReason} reported the browser is gone: both are
 * "no endpoint", and the CALLER decides whether that is fatal (a spawn that must
 * yield an endpoint) or merely a missing extra (the launch transport's optional
 * shared surface).
 */
export async function readDevToolsPort(
	userDataDir: string,
	options: DevToolsPortOptions = {},
): Promise<string | undefined> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;
	const portFile = join(userDataDir, 'DevToolsActivePort');
	for (;;) {
		// Check the abort BEFORE reading: a dead browser will never write the file,
		// so waiting out the remaining timeout only delays a clear error.
		if (options.abortReason?.() !== undefined) {
			return undefined;
		}
		try {
			const raw = await readFile(portFile, 'utf8');
			const port = raw.split('\n')[0]?.trim();
			if (port !== undefined && port !== '') {
				return port;
			}
		} catch {
			// Not written yet (or the dir is not a live profile): keep waiting.
		}
		if (Date.now() >= deadline) {
			return undefined;
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}

/**
 * The loopback CDP endpoint of a Chromium whose user-data dir is `userDataDir`,
 * i.e. `http://127.0.0.1:<port>` for the port it wrote, or `undefined` if none
 * appeared (see {@link readDevToolsPort}).
 *
 * Chromium binds the debugging port to loopback, which is why this is always a
 * `127.0.0.1` URL: the endpoint is a code-execution surface on the live page and
 * must never be reachable off-box (CONTEXT.md).
 */
export async function resolveCdpEndpoint(
	userDataDir: string,
	options: DevToolsPortOptions = {},
): Promise<string | undefined> {
	const port = await readDevToolsPort(userDataDir, options);
	return port === undefined ? undefined : `http://127.0.0.1:${port}`;
}
