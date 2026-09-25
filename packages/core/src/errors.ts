/**
 * Typed, identifiable `core` error conditions.
 *
 * These are raised by the concrete transports (the v1 Playwright launch
 * transport, and later `attach`/`setup-profile`) so that the `cli` package
 * (`cli-incur-wiring-and-errors`, SPEC story 17) can render the EXACT
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
	| 'missing-display'
	| 'missing-stealth-dependency'
	| 'invalid-proxy'
	| 'missing-profile'
	| 'attach-not-chromium'
	| 'attach-no-context'
	| 'no-live-server'
	| 'session-already-active'
	| 'socket-unsupported-platform'
	| 'invalid-socket-path'
	| 'cross-origin-frame'
	| 'screenshot-path-outside-managed-dir'
	| 'stale-ref'
	| 'unresolved-env-placeholder'
	| 'real-chrome-not-found'
	| 'real-chrome-start-failed'
	| 'real-chrome-reuse-conflict'
	| 'proxy-auth-unsupported';

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
 *
 * CARRIES THE REVISION CONTEXT, because "not installed" is frequently a LIE in
 * the shape that matters. Playwright resolves a browser by REVISION, not by
 * name: a machine can hold several browser trees and satisfy none of them, and
 * that is the normal state of any machine that runs more than one project.
 * Reported from the field: a host with eight trees in `~/.cache/ms-playwright`
 * (`chromium-1223`, `chromium-1234`, webkit, firefox) met a bare "the chromium
 * browser binary is not installed", which reads as false and sends the reader
 * looking anywhere but at the revision. Playwright's own error names the exact
 * path it wanted; the transport passes it through here instead of discarding
 * it, and adds what IS present next to it.
 */
export class MissingBrowserBinaryError extends ControllerError {
	readonly code = 'missing-browser-binary';
	/** The browser whose binary is missing (e.g. `chromium`). */
	readonly browser: string;
	/**
	 * The exact executable Playwright looked for, when its own error named one
	 * (e.g. `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`). Absent
	 * for a missing SYSTEM channel (`--use-system-browser chrome`), which has no
	 * managed path.
	 */
	readonly executablePath?: string;
	/**
	 * The browser trees actually present in the search dir, as directory names
	 * (e.g. `['chromium-1223', 'chromium-1234']`). Empty means the dir was empty,
	 * absent means it could not be read. This is the field that turns a confusing
	 * report into an obvious one.
	 */
	readonly present?: readonly string[];

	constructor(
		browser: string,
		message: string = `The ${browser} browser binary is not installed.`,
		options?: {
			cause?: unknown;
			executablePath?: string;
			present?: readonly string[];
		},
	) {
		super(describeMissingBrowser(message, options), options);
		this.browser = browser;
		this.executablePath = options?.executablePath;
		this.present = options?.present;
	}
}

/**
 * Append the revision evidence to the base "not installed" sentence.
 *
 * Kept as a free function rather than inlined so the base sentence stays the
 * one the caller passed (a caller that supplies its own message still gets the
 * evidence appended, and a caller with no evidence gets exactly the old text,
 * which is what keeps this change additive).
 */
function describeMissingBrowser(
	base: string,
	options?: {executablePath?: string; present?: readonly string[]},
): string {
	const lines: string[] = [base];
	if (options?.executablePath) {
		lines.push(`Playwright looked for this exact build:`);
		lines.push(`  ${options.executablePath}`);
	}
	if (options?.present && options.present.length > 0) {
		lines.push(
			`Present alongside it: ${options.present.join(', ')} (a DIFFERENT revision, which does not satisfy this one).`,
		);
	}
	return lines.join('\n');
}

/**
 * A HEADED browser was asked for on a machine with no X display.
 *
 * The condition is ordinary rather than exotic: every server, container, CI
 * runner and headless dev box is in it, and `setup-profile` is headed BY
 * DEFINITION (its entire job is showing a human a window), so this is the first
 * thing a new headless host meets.
 *
 * Typed for the same reason as {@link MissingBrowserBinaryError}: what
 * Playwright emits here is a multi-line ASCII box inside a message whose first
 * line claims the browser "has been closed", which reads as a crash and names a
 * tool (`xvfb-run`) the reader has to already know to reach for. An agent
 * driving webhands cannot act on that; it can act on a code plus one command.
 */
export class MissingDisplayError extends ControllerError {
	readonly code = 'missing-display';

	constructor(
		message: string = 'A HEADED browser needs an X display, and this machine has none (DISPLAY is unset or no X server is reachable).',
		options?: {cause?: unknown},
	) {
		super(message, options);
	}
}

/**
 * The env var naming EXTRA command-line args for the spawned real Chrome.
 *
 * Declared HERE, in the module with no internal imports, purely so the error
 * messages below can name it without creating an `errors` <-> `real-chrome` import
 * cycle. `real-chrome.ts` re-exports it, and the rationale for the whole mechanism
 * (an environment with no usable Chrome sandbox) lives there with the code that
 * reads it.
 */
export const REAL_CHROME_ARGS_ENV = 'WEBHANDS_CHROME_ARGS';

/**
 * A browser is already running against the requested profile dir, and the options
 * asked for can only be applied when a browser is SPAWNED.
 *
 * `--real-chrome` reuses a browser already live on the profile (Chrome cannot open
 * one user-data dir twice, and a previous `--keep-browser` run or a crashed
 * controller can leave one up). Reuse is normally exactly what the caller wanted,
 * but a proxy, an executable path, a headless mode and extra args are all
 * command-line facts of a process that is ALREADY UP: a running browser cannot
 * retroactively acquire them.
 *
 * So we refuse instead of reusing. The `proxy` case is why this is an error rather
 * than a warning: silently reusing would egress through the user's real IP while
 * they believed they were tunnelled, which is the one mistake this tool must never
 * make quietly.
 */
export class RealChromeReuseConflictError extends ControllerError {
	readonly code = 'real-chrome-reuse-conflict';
	/** The profile dir whose browser is already running. */
	readonly profileDir: string;
	/** That browser's debugging endpoint (so a caller can attach deliberately). */
	readonly endpoint: string;
	/** The option names that cannot be honoured by reusing it. */
	readonly unhonourableOptions: readonly string[];

	constructor(
		profileDir: string,
		endpoint: string,
		unhonourableOptions: readonly string[],
	) {
		super(
			`A browser is already running against ${profileDir} (${endpoint}), and ` +
				`${unhonourableOptions.join(', ')} can only be applied to a browser ` +
				`webhands STARTS. Reusing it would hand you a browser that differs from ` +
				`the one you asked for, silently. Close that browser (or use a different ` +
				`profile) and retry, or drop those options to attach to it as-is.`,
		);
		this.profileDir = profileDir;
		this.endpoint = endpoint;
		this.unhonourableOptions = unhonourableOptions;
	}
}

/**
 * A `--proxy` URL carried `user:pass@` credentials in a mode that cannot use
 * them: the spawned-real-Chrome path, which configures the proxy through
 * Chromium's own `--proxy-server` flag.
 *
 * This is a REFUSAL, not a limitation we work around silently, because the silent
 * outcomes are all bad. Chromium's `net/docs/proxy.md` states plainly that "no
 * authentication methods are supported for SOCKSv5 in Chrome" and that Chrome
 * "will not use any credentials embedded in the proxy settings". So passing the
 * URL through would strip the credentials and fail every request with
 * `ERR_PROXY_CONNECTION_FAILED`, and dropping them quietly would leave the user
 * believing their traffic was authenticated and proxied when it was not. On a tool
 * whose whole point is knowing exactly whose IP you are using, that is the worst
 * possible failure mode.
 *
 * The Playwright LAUNCH path DOES support credentials (Playwright answers the
 * proxy auth challenge itself instead of handing them to Chrome), which is why
 * this is specific to the real-Chrome mode rather than a property of `--proxy`.
 */
export class ProxyAuthUnsupportedError extends ControllerError {
	readonly code = 'proxy-auth-unsupported';

	constructor(proxy: string) {
		super(
			`The proxy URL carries credentials, which Chrome cannot use: it ` +
				`supports no SOCKSv5 authentication and ignores credentials embedded in ` +
				`proxy settings, so --real-chrome refuses rather than silently sending ` +
				`your traffic unauthenticated. Use a credential-free local SOCKS relay ` +
				`(e.g. \`ssh -D 1080\`, or a local relay that adds the upstream auth) and ` +
				`point --proxy at that, or use the Playwright launch path, which can ` +
				`carry credentials. Proxy: ${redactProxyCredentials(proxy)}`,
		);
	}
}

/**
 * Replace a proxy URL's userinfo with `***` for an error message.
 *
 * The message has to name WHICH proxy was rejected to be useful, and must not echo
 * the password while doing it.
 */
function redactProxyCredentials(proxy: string): string {
	return proxy.replace(/\/\/[^@/]*@/, '//***@');
}

/**
 * `--real-chrome` was requested but no Chrome-family browser could be found to
 * spawn.
 *
 * Distinct from {@link MissingBrowserBinaryError} on purpose: that one is about
 * Playwright's OWN bundled browsers, whose fix is `npx playwright install`. Here
 * the missing thing is the user's real, everyday Chrome, which Playwright cannot
 * install and which is the entire point of the mode, so the fix is to install
 * Chrome or to name its path. Mapping both to one code would hand the user a fix
 * command that cannot work.
 */
export class RealChromeNotFoundError extends ControllerError {
	readonly code = 'real-chrome-not-found';
	/** The executables that were looked for, in the order tried. */
	readonly candidates: readonly string[];
	/** The env var that overrides the search (so the message can name it). */
	readonly envVar: string;

	constructor(candidates: readonly string[], envVar: string) {
		super(
			`No Chrome-family browser was found to spawn for --real-chrome. Looked ` +
				`for: ${candidates.join(', ')}. Install Google Chrome, or point ` +
				`${envVar} at the executable.`,
		);
		this.candidates = candidates;
		this.envVar = envVar;
	}
}

/**
 * A real Chrome was found but could not be brought up as an attachable browser:
 * it failed to spawn, exited immediately, or never published a debugging port.
 *
 * The most likely cause in practice is the profile dir already being in use by a
 * running Chrome (Chrome refuses to open a user-data dir twice), which is why the
 * reason is carried verbatim rather than flattened into one generic message.
 */
export class RealChromeStartError extends ControllerError {
	readonly code = 'real-chrome-start-failed';
	/** The executable that was spawned. */
	readonly executablePath: string;
	/** The tail of Chrome's own stderr, when it produced any. */
	readonly stderr: string | undefined;

	constructor(
		executablePath: string,
		reason: string,
		options?: {cause?: unknown; stderr?: string},
	) {
		const stderr =
			options?.stderr !== undefined && options.stderr !== ''
				? options.stderr
				: undefined;
		super(
			`Could not start the real Chrome at ${executablePath}: ${reason}. ` +
				`If a Chrome is already running against this profile directory, close ` +
				`it (or use a different --profile) and try again. In a container, a CI ` +
				`runner or any environment without a usable Chrome sandbox, startup ` +
				`aborts (often SIGABRT): set ${REAL_CHROME_ARGS_ENV}=--no-sandbox to ` +
				`proceed there, and understand that it DISABLES the browser sandbox, so ` +
				`only do it where that is acceptable.` +
				// Chrome's own words, when it said anything. This is usually the whole
				// answer, and omitting it is what made the CI failure a research project.
				(stderr !== undefined ? `\n\nChrome said:\n${stderr}` : ''),
			{...(options?.cause !== undefined ? {cause: options.cause} : {})},
		);
		this.executablePath = executablePath;
		this.stderr = stderr;
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
 * `serve --socket` was asked for on a platform that has no unix socket in the
 * sense this mode NEEDS (ADR-0017).
 *
 * Node accepts `listen(path)` on Windows, but it creates a NAMED PIPE, and a
 * named pipe carries none of what makes this mode safe: the whole access
 * control here is the socket inode's owner plus its 0600 mode, since `connect()`
 * requires write permission on it. Pretending to honour the flag would hand the
 * user a channel with different, unstated access rules, so it refuses loudly
 * instead. TCP (the default) is unaffected and is what Windows should use.
 */
export class SocketUnsupportedError extends ControllerError {
	readonly code = 'socket-unsupported-platform';
	/** The platform that was refused (`process.platform`). */
	readonly platform: string;

	constructor(platform: string, options?: {cause?: unknown}) {
		super(
			`Serving over a unix socket is not supported on ${platform}: Node maps ` +
				`listen(<path>) there to a named pipe, which does not carry the file ` +
				`ownership and 0600 mode that ARE the access control for this mode. ` +
				`Use the default TCP serve instead.`,
			options,
		);
		this.platform = platform;
	}
}

/**
 * The `--socket` path cannot be used as a listening unix socket (ADR-0017).
 *
 * Two causes, both worth naming rather than letting the OS speak:
 * 1. **Too long.** `sockaddr_un.sun_path` is 108 bytes on Linux and 104 on
 *    macOS, a limit nothing else in the tool has, and a path built from a long
 *    home root or a deep temp dir crosses it. The kernel's own complaint is an
 *    opaque `EINVAL`/`ENAMETOOLONG` on `listen`.
 * 2. **Occupied by something that is NOT a socket.** A stale SOCKET is ours to
 *    unlink (that is the documented crash-recovery path), but a regular file or
 *    a directory at that path is the user's, and deleting it to make room would
 *    be destroying data to satisfy a flag.
 */
export class InvalidSocketPathError extends ControllerError {
	readonly code = 'invalid-socket-path';
	/** The rejected path. */
	readonly socketPath: string;

	constructor(socketPath: string, reason: string, options?: {cause?: unknown}) {
		super(
			`Cannot serve on the unix socket ${JSON.stringify(socketPath)}: ${reason}`,
			options,
		);
		this.socketPath = socketPath;
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
 * A `screenshot --out <path>` override pointed OUTSIDE the managed screenshots
 * dir. webhands MINTS screenshots under one managed directory it owns (under the
 * controller home root, beside `profiles/`); a caller MAY override the output
 * path, but only WITHIN that managed dir (spec `broaden-agent-verb-surface`, R3:
 * "validate it stays under a sane managed dir"). An override that escapes it
 * (an absolute path elsewhere, or a `..` traversal out) is refused LOUDLY with
 * this typed condition rather than silently writing a PNG to an arbitrary
 * filesystem location — the seam returns a path, so an unbounded path would let
 * the verb clobber any file the process can write.
 *
 * Mirrors the other typed conditions: the CLI maps {@link code} to a message,
 * and {@link isControllerError} narrows it across a bundle boundary.
 */
export class ScreenshotPathError extends ControllerError {
	readonly code = 'screenshot-path-outside-managed-dir';
	/** The offending caller-supplied `out` path, echoed back so it is visible. */
	readonly path: string;
	/** The managed screenshots dir the path had to stay under. */
	readonly managedDir: string;

	constructor(
		path: string,
		managedDir: string,
		message: string = `The screenshot output path ${JSON.stringify(
			path,
		)} is OUTSIDE the managed screenshots dir (${managedDir}). A caller may override --out only within the managed dir; webhands never writes a screenshot to an arbitrary location.`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.path = path;
		this.managedDir = managedDir;
	}
}

/**
 * A durable `query` `ref` (spec `broaden-agent-verb-surface`, R4; finding
 * `query-ref-mint-mechanism-attribute-beats-weakmap`) failed to resolve to
 * EXACTLY ONE element when an action verb (`click`/`type`) tried to act on it.
 * A `ref` is a SHORT-LIVED handle, not a stable identity: between the `query`
 * that minted it and the act, the page may have re-rendered (React keyed-list /
 * Svelte `{#each}` NODE REPLACEMENT), navigated, or cloned a subtree carrying
 * our minted attribute. Two stale shapes, BOTH this one error, never a silent
 * wrong-element action:
 *
 * - resolve-to-ZERO ({@link matched} `=== 0`) — the element was removed or
 *   replaced (its minted node is gone, or a reused stable attribute it carried
 *   no longer exists). The agent must re-`query` against the fresh DOM.
 * - resolve-to-MANY ({@link matched} `> 1`) — the ref matches more than one
 *   element (a framework cloned a subtree carrying our minted attribute, or a
 *   reused attribute turned out non-unique after a mutation). We refuse to
 *   "pick the first", because that is exactly the silent wrong-element click the
 *   ref exists to PREVENT.
 *
 * This is STRICTLY SAFER than re-addressing by a positional `.nth(i)`, which
 * SILENTLY clicks whatever now sits at that index. The agent is told "re-query,
 * the page changed" — its natural loop anyway. Mirrors the other typed
 * conditions: the CLI maps {@link code} to a message, and
 * {@link isControllerError} narrows it across a bundle boundary.
 */
export class StaleRefError extends ControllerError {
	readonly code = 'stale-ref';
	/** The ref locator string that went stale (echoed back so it is visible). */
	readonly ref: string;
	/** How many elements the ref resolved to (0 = removed/replaced, >1 = ambiguous). */
	readonly matched: number;
	/** Which verb tried to act on the stale ref (e.g. `click`, `type`). */
	readonly verb: string;

	constructor(
		ref: string,
		matched: number,
		verb: string,
		message: string = matched === 0
			? `${verb}: the ref ${JSON.stringify(
					ref,
				)} is STALE — it now matches NO element (the page changed: the element was removed, replaced by a re-render, or the page navigated). Re-run query to get a fresh ref.`
			: `${verb}: the ref ${JSON.stringify(
					ref,
				)} is AMBIGUOUS — it now matches ${matched} elements (the page changed: a subtree was cloned, or the attribute is no longer unique). Refusing to act on a guessed element; re-run query to get a fresh ref.`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.ref = ref;
		this.matched = matched;
		this.verb = verb;
	}
}

/**
 * A value-bearing verb was handed a `{ENV:NAME}` placeholder whose environment
 * variable is UNSET or EMPTY at type-time, so there is nothing to substitute.
 *
 * `{ENV:NAME}` is webhands' OWN placeholder grammar (NOT ldenv's `@@VAR` CLI
 * syntax): a value-bearing verb (`type`) resolves the token against
 * `process.env.NAME` in the served controller process at the moment the verb
 * runs, so the literal secret never appears in the tool-call, the (future) verb
 * trace, or an emitted hand scaffold. An unset/empty var is refused LOUDLY with
 * this typed condition rather than typing a SILENT EMPTY string into the page:
 * a silent empty would look like a successful login/type while actually sending
 * nothing, the exact quiet-wrong-result this repo's loud-over-silent style
 * rejects. The operator supplies the value via the real environment or a
 * gitignored `.env.local` (loaded by ldenv at `serve` startup); the message
 * points there so the fix is obvious.
 *
 * Mirrors the other typed conditions: {@link isControllerError} narrows it
 * across a bundle boundary. NOTE it is raised in the SERVED process (where the
 * env is loaded and substitution happens), so over the session RPC it reaches a
 * thin-client verb as a faithful message string (the `code` tag survives only
 * for an in-process caller), exactly like any other page-side verb throw.
 */
export class UnresolvedEnvPlaceholderError extends ControllerError {
	readonly code = 'unresolved-env-placeholder';
	/** The env var name the `{ENV:NAME}` token referenced (echoed back). */
	readonly envName: string;
	/** The verb that was resolving the placeholder (e.g. `type`). */
	readonly verb: string;

	constructor(
		envName: string,
		verb: string,
		message: string = `${verb}: the placeholder {ENV:${envName}} could not be resolved because the environment variable ${JSON.stringify(
			envName,
		)} is unset or empty. Refusing to type a silent empty value. Set ${envName} in the real environment or a gitignored .env.local (webhands loads .env/.env.local/.env.<mode> at \`serve\` startup) and retry.`,
		options?: {cause?: unknown},
	) {
		super(message, options);
		// NOTE: do NOT assign `this.name` here (the base class sets Error.name to the
		// class name); the referenced env var is `envName`.
		this.envName = envName;
		this.verb = verb;
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
