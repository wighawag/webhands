import {
	connectRemoteSession,
	NoLiveServerError,
	readSessionEndpoint,
	type OpenTarget,
	type Session,
} from '@my-browser-controller/core';

/**
 * How a CLI verb command obtains a live {@link Session} to run against.
 *
 * This is the ONE seam the verb commands use to reach a browser. It is
 * deliberately a single function (open a session for an {@link OpenTarget})
 * rather than the transports directly, for two reasons:
 *
 * 1. **Testability of the WIRING.** CLI-level tests assert incur wiring
 *    (schemas, output envelope, cta, manifest, error text), NOT verb behaviour
 *    (that is covered at the `core` seam). A test injects a provider backed by
 *    the `core` `StubTransport`, so the command surface can be exercised with no
 *    real browser, and a test can inject a provider that THROWS the typed
 *    `core` errors to assert the actionable fix-command messages.
 *
 * 2. **The cross-invocation persistence swap point.** Per ADR-0005 a single
 *    browser is kept alive between separate CLI invocations behind a long-lived
 *    `serve` process; verb commands are THIN CLIENTS of that server. The default
 *    provider (below) is now exactly that thin client: it discovers the running
 *    server via the endpoint file and returns a {@link connectRemoteSession}
 *    proxy that drives the server's already-live page; when NO server is live it
 *    raises a typed {@link NoLiveServerError} so the CLI prints "run `serve`
 *    first" and exits non-zero, never auto-spawning a browser (ADR-0005:
 *    lifecycle is EXPLICIT in v1).
 */
export type SessionProvider = (target: OpenTarget) => Promise<Session>;

/** Overrides for where the default provider discovers the running server (tests pass a temp root). */
export interface DefaultSessionProviderOptions {
	/** Explicit controller home root. Omit to use `~/.my-browser-controller`. */
	readonly root?: string;
	/** Environment to read the home override from. Defaults to `process.env`. */
	readonly env?: NodeJS.ProcessEnv;
}

/**
 * The v1 default {@link SessionProvider}: a THIN CLIENT of the long-lived
 * `serve` process (ADR-0005).
 *
 * It reads the endpoint file the running server advertised under the config dir
 * and returns a {@link connectRemoteSession} proxy that forwards each verb to
 * the server's single live page. There is no per-invocation browser launch
 * here: a verb invocation drives the SAME live page the server holds, which is
 * what makes session state persist across separate CLI processes.
 *
 * The {@link OpenTarget} is intentionally IGNORED for discovery: which browser
 * to launch (`launch`/`attach`, the profile) was decided once, by the `serve`
 * command, when the single session was brought up. A verb does not get to pick
 * a different browser; it just drives the live one. If no server is live the
 * provider raises {@link NoLiveServerError} (mapped by the CLI to "run `serve`
 * first"); it never silently opens a browser.
 */
export function createDefaultSessionProvider(
	options: DefaultSessionProviderOptions = {},
): SessionProvider {
	return async (_target: OpenTarget): Promise<Session> => {
		const endpoint = await readSessionEndpoint(options);
		if (endpoint === undefined) {
			throw new NoLiveServerError();
		}
		return connectRemoteSession(endpoint.url);
	};
}
