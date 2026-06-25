/**
 * Typed, identifiable `core` error conditions.
 *
 * These are raised by the concrete transports (the v1 Playwright launch
 * transport, and later `attach`/`setup-profile`) so that the `cli` package
 * (`cli-incur-wiring-and-errors`, PRD story 17) can render the EXACT
 * fix-command message without re-detecting the condition. This module OWNS the
 * typed condition; the CLI owns the user-facing message text.
 *
 * The discriminator is the string-literal {@link ControllerError.code}. A
 * caller branches on `code` (a stable, machine-readable tag) rather than
 * matching on a message string, which is presentation and may change. Each
 * error also carries the structured context the CLI needs to compose its fix
 * command (e.g. the profile name, the resolved profile dir) so the CLI never
 * has to re-derive paths.
 */

/** The closed set of identifiable `core` error conditions. */
export type ControllerErrorCode =
	| 'missing-browser-binary'
	| 'missing-profile'
	| 'attach-not-chromium'
	| 'attach-no-context'
	| 'no-live-server'
	| 'session-already-active';

/**
 * Base class for every identifiable `core` error. Branch on {@link code}.
 *
 * Use {@link isControllerError} to narrow an `unknown` caught value to this
 * type across a package/bundle boundary (where `instanceof` can be unreliable);
 * the `code` tag is the contract, not the class identity.
 */
export abstract class ControllerError extends Error {
	/** Machine-readable discriminator; stable across versions. */
	abstract readonly code: ControllerErrorCode;
	/** Brand so {@link isControllerError} can narrow across bundle boundaries. */
	readonly isControllerError = true as const;

	constructor(message: string, options?: {cause?: unknown}) {
		super(message, options);
		// Preserve the concrete subclass name (Error's constructor sets it to
		// `Error` under some transpile targets).
		this.name = new.target.name;
	}
}

/**
 * The browser binary Playwright needs is not installed (e.g.
 * `playwright install chromium` was never run). Surfaced so the CLI can tell
 * the user the exact install command.
 */
export class MissingBrowserBinaryError extends ControllerError {
	readonly code = 'missing-browser-binary';
	/** The browser whose binary is missing (e.g. `chromium`). */
	readonly browser: string;

	constructor(
		browser: string,
		message: string = `The ${browser} browser binary is not installed.`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.browser = browser;
	}
}

/**
 * The named profile has not been set up yet: its dedicated profile directory
 * does not exist on disk. A profile is created by the headed `setup-profile`
 * flow; `launch` against a not-yet-set-up profile raises this so the CLI can
 * tell the user to run `setup-profile` first.
 */
export class MissingProfileError extends ControllerError {
	readonly code = 'missing-profile';
	/** The name of the profile that is not set up. */
	readonly profile: string;
	/** The dedicated profile directory that was expected to exist. */
	readonly profileDir: string;

	constructor(
		profile: string,
		profileDir: string,
		message: string = `The "${profile}" profile is not set up (no profile directory at ${profileDir}).`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.profile = profile;
		this.profileDir = profileDir;
	}
}

/**
 * The `attach` transport connected to a browser that is NOT Chromium. CDP-attach
 * (`connectOverCDP`) is Chromium-only (ADR-0002/0003: Firefox attaches via a
 * different mechanism), so attaching to anything else cannot reuse the live
 * context and is refused. Surfaced as a typed condition so the CLI can tell the
 * user attach is Chromium-only WITHOUT the seam ever naming CDP/Chromium types.
 */
export class AttachNotChromiumError extends ControllerError {
	readonly code = 'attach-not-chromium';
	/** The browser engine actually reached at the endpoint (e.g. `firefox`). */
	readonly browser: string;

	constructor(
		browser: string,
		message: string = `attach is Chromium-only; the endpoint exposes a "${browser}" browser. Start Chromium/Chrome with --remote-debugging-port and attach to that.`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.browser = browser;
	}
}

/**
 * The browser reached at the attach endpoint exposes no browser context to
 * reuse. attach deliberately reuses the user's EXISTING authenticated context
 * (`contexts()[0]`) and never opens a fresh one (ADR-0002), so a browser with
 * zero contexts is a refusal, not a silent `newContext()`.
 */
export class AttachNoContextError extends ControllerError {
	readonly code = 'attach-no-context';
	/** The endpoint that exposed no reusable context. */
	readonly endpoint: string;

	constructor(
		endpoint: string,
		message: string = `attach found no existing browser context at ${endpoint} to reuse. Open a window/tab in the browser before attaching.`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.endpoint = endpoint;
	}
}

/**
 * No long-lived served session is running (no endpoint file under the config
 * dir), so a thin-client verb has nothing to drive (ADR-0005). Surfaced so the
 * CLI can tell the user to run `serve` first rather than auto-spawning a browser
 * (lifecycle is EXPLICIT in v1). This is the cross-invocation analogue of
 * {@link MissingProfileError}: a precondition the user resolves with one named
 * command.
 */
export class NoLiveServerError extends ControllerError {
	readonly code = 'no-live-server';

	constructor(
		message: string = 'No live my-browser-controller session server is running. Start one with `serve` first.',
		options?: {cause?: unknown},
	) {
		super(message, options);
	}
}

/**
 * A second `serve`/`launch`/`attach` was requested while one session is already
 * live. v1 holds EXACTLY ONE session (ADR-0005, single session); a concurrent
 * open is a clear refusal, not a second browser. Surfaced so the CLI can tell
 * the user to stop the active session first.
 */
export class SessionAlreadyActiveError extends ControllerError {
	readonly code = 'session-already-active';

	constructor(
		message: string = 'A session is already active; stop it first (run `stop`).',
		options?: {cause?: unknown},
	) {
		super(message, options);
	}
}

/**
 * Narrow an unknown caught value to a {@link ControllerError}. Prefer this over
 * `instanceof` at package boundaries: it checks the {@link ControllerError.isControllerError}
 * brand and a known {@link ControllerErrorCode}, so it survives duplicate
 * copies of this module in different bundles.
 */
export function isControllerError(value: unknown): value is ControllerError {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as {isControllerError?: unknown}).isControllerError === true &&
		typeof (value as {code?: unknown}).code === 'string'
	);
}
