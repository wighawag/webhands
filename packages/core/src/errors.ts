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
	| 'missing-stealth-dependency'
	| 'invalid-proxy'
	| 'missing-profile'
	| 'attach-not-chromium'
	| 'attach-no-context'
	| 'no-live-server'
	| 'session-already-active'
	| 'cross-origin-frame';

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
 * Stealth launch was REQUESTED (the opt-in is on) but the optional `patchright`
 * dependency is not installed/importable. Patchright is an OPTIONAL dependency
 * of `@webhands/core` imported lazily only when stealth is enabled, so a user
 * who never opts in is not forced to install it (ADR-0002: stealth is one extra
 * layer, not the default). When it IS opted into and missing, we refuse LOUDLY
 * with this typed condition rather than silently falling back to vanilla
 * Playwright, because a silent fallback would re-introduce the exact CDP
 * automation tell the user asked us to remove WITHOUT telling them.
 *
 * Mirrors {@link MissingBrowserBinaryError}: a stable typed error whose brittle
 * detection (the dynamic-import failure) is confined to one spot in the launch
 * transport. The CLI can render the exact `pnpm add patchright` fix command by
 * branching on {@link code}.
 */
export class MissingStealthDependencyError extends ControllerError {
	readonly code = 'missing-stealth-dependency';
	/** The optional package that must be installed to use stealth. */
	readonly dependency: string;

	constructor(
		dependency = 'patchright',
		message: string = `Stealth launch is enabled but the optional "${dependency}" dependency is not installed. Install it with \`pnpm add ${dependency}\` (and \`${dependency} install chromium\` if you do not use channel: 'chrome'), or construct the transport without {stealth: true}.`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.dependency = dependency;
	}
}

/**
 * The `--proxy` value (a SOCKS URL) could not be parsed into a usable proxy
 * config. webhands routes ALL traffic and DNS through one SOCKS proxy, so the
 * value must be a `socks5://` or `socks5h://` URL with a host and port (an
 * optional `user:pass@` is allowed). We refuse a malformed value LOUDLY with
 * this typed condition rather than silently launching with no proxy (which
 * would leak the very traffic the user asked to tunnel). The CLI maps the
 * {@link code} to a fix message showing the expected URL shape.
 *
 * Mirrors {@link MissingStealthDependencyError}: a stable typed error whose
 * brittle detection is confined to one spot (the proxy parser).
 */
export class InvalidProxyError extends ControllerError {
	readonly code = 'invalid-proxy';
	/** The offending raw `--proxy` value, echoed back so the user can see it. */
	readonly value: string;

	constructor(
		value: string,
		message: string = `Invalid --proxy value ${JSON.stringify(
			value,
		)}. Expected a SOCKS URL like socks5h://host:1080 or socks5://user:pass@host:1080 (socks5h tunnels DNS too; both route all traffic through the proxy).`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.value = value;
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
		message: string = 'No live webhands session server is running. Start one with `serve` first.',
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
 * A frame-scoped `eval` (or any same-origin-frame op) addressed a CROSS-ORIGIN
 * child frame. Page-world JS cannot cross a browser security boundary, so the
 * frame-scoped `eval` reaches the top document and SAME-ORIGIN descendant frames
 * ONLY (the idea's honest-scope note); a cross-origin frame is unreachable BY
 * DESIGN, not a missing feature. We refuse LOUDLY with this typed condition
 * rather than return a silent empty result, because a silent empty would let an
 * agent believe its callback fired / its read succeeded when the security
 * boundary actually blocked it.
 *
 * Cross-origin frame reach is the SEPARATE Tier-4 `frameLocator`/coordinate
 * surface, not this verb; the message points there so the agent is not left
 * guessing. Mirrors the other typed conditions: the CLI maps {@link code} to a
 * message, and {@link isControllerError} narrows it across a bundle boundary.
 */
export class CrossOriginFrameError extends ControllerError {
	readonly code = 'cross-origin-frame';
	/** The frame selector the caller passed (echoed back so it is visible). */
	readonly frame: string;
	/** The cross-origin frame's origin, when known (e.g. `https://hcaptcha.com`). */
	readonly frameOrigin?: string;
	/** The page's own (main-frame) origin the frame had to match. */
	readonly pageOrigin?: string;

	constructor(
		frame: string,
		details?: {frameOrigin?: string; pageOrigin?: string},
		message: string = `The frame ${JSON.stringify(frame)} is CROSS-ORIGIN${
			details?.frameOrigin !== undefined && details?.pageOrigin !== undefined
				? ` (frame origin ${details.frameOrigin}, page origin ${details.pageOrigin})`
				: ''
		} and is unreachable from page-world JS. eval --frame reaches the top document and SAME-ORIGIN child frames only; a cross-origin frame is a browser security boundary. Reach cross-origin frames with the Tier-4 frameLocator/coordinate ops instead.`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.frame = frame;
		this.frameOrigin = details?.frameOrigin;
		this.pageOrigin = details?.pageOrigin;
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
