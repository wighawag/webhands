import {
	PlaywrightAttachTransport,
	PlaywrightLaunchTransport,
	type OpenTarget,
	type Session,
} from '@my-browser-controller/core';

/**
 * How a CLI command obtains a live {@link Session} to run a verb against.
 *
 * This is the ONE seam the CLI uses to reach a browser. It is deliberately a
 * single function (open a session for an {@link OpenTarget}) rather than the
 * transports directly, for two reasons:
 *
 * 1. **Testability of the WIRING.** CLI-level tests assert incur wiring
 *    (schemas, output envelope, cta, manifest, error text), NOT verb behaviour
 *    (that is covered at the `core` seam). A test injects a provider backed by
 *    the `core` `StubTransport`, so the command surface can be exercised with no
 *    real browser, and a test can inject a provider that THROWS the typed
 *    `core` errors to assert the actionable fix-command messages.
 *
 * 2. **A clean swap point for cross-invocation persistence.** ADR-0005 keeps a
 *    single browser alive between separate CLI invocations behind a long-lived
 *    `incur serve` process; verbs become thin clients of that server. That
 *    mechanism is the NEXT task (`cross-invocation-session-persistence`, which
 *    is `blockedBy` this one). When it lands it replaces THIS provider with the
 *    thin-client lookup (read the endpoint file, talk to the running server)
 *    without changing a single command definition. Until then the provider
 *    opens a session directly through the v1 Playwright transports, so the verb
 *    commands run end to end today.
 */
export type SessionProvider = (target: OpenTarget) => Promise<Session>;

/** Overrides for where the default provider's profiles live (tests pass a temp root). */
export interface DefaultSessionProviderOptions {
	/** Explicit controller home root. Omit to use `~/.my-browser-controller`. */
	readonly root?: string;
	/** Environment to read the home override from. Defaults to `process.env`. */
	readonly env?: NodeJS.ProcessEnv;
}

/**
 * The v1 default {@link SessionProvider}: open a session directly through the
 * Playwright transports.
 *
 * `launch` uses {@link PlaywrightLaunchTransport} (which raises the typed
 * `MissingProfileError` / `MissingBrowserBinaryError` the CLI maps to fix
 * commands); `attach` uses {@link PlaywrightAttachTransport}. This is a thin,
 * per-invocation open; the long-lived single session lands in the persistence
 * task (see {@link SessionProvider}).
 */
export function createDefaultSessionProvider(
	options: DefaultSessionProviderOptions = {},
): SessionProvider {
	const launch = new PlaywrightLaunchTransport(options);
	const attach = new PlaywrightAttachTransport();
	return (target) =>
		target.mode === 'attach' ? attach.open(target) : launch.open(target);
}
