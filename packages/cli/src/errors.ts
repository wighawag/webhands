import {
	isControllerError,
	MissingBrowserBinaryError,
	MissingStealthDependencyError,
	InvalidProxyError,
	MissingProfileError,
	AttachNotChromiumError,
	AttachNoContextError,
	NoLiveServerError,
	SessionAlreadyActiveError,
	CrossOriginFrameError,
	ScreenshotPathError,
	type ControllerError,
	type ControllerErrorCode,
} from '@webhands/core';

/**
 * Map a TYPED `core` error condition into the user-facing message + the EXACT
 * command to fix it (PRD story 17).
 *
 * `core` OWNS the typed conditions (a `ControllerError` with a stable `code`,
 * raised by the transports — see `packages/core/src/errors.ts`); the CLI OWNS
 * the user-facing message text. The CLI never re-DETECTS a missing binary or a
 * missing profile (no second `stat`, no message-string match): it branches on
 * the machine-readable `code` and composes the fix command from the structured
 * context the error already carries (`browser`, `profile`, `profileDir`, ...).
 *
 * The result is fed to incur's `c.error({code, message, ...})` so the failure
 * surfaces in the structured output envelope with the SAME `code` an agent can
 * branch on, and a `message` whose final line is a copy-pasteable fix command.
 */
export interface MappedError {
	/** The machine-readable `core` error code, surfaced unchanged to the agent. */
	readonly code: ControllerErrorCode;
	/** The full user-facing message, ending in the exact fix command. */
	readonly message: string;
}

/**
 * Compose the EXACT fix command for a typed `core` error. Returned alongside
 * the message so a test can assert the precise command, and so the wording
 * lives in ONE place. `binary` is the CLI binary name (`incur` passes it to the
 * handler as `c.name`), so the suggested command always matches how the user
 * invoked the tool.
 */
export function fixCommandFor(error: ControllerError, binary: string): string {
	switch (error.code) {
		case 'missing-browser-binary':
			// Playwright ships its own browser binaries; `playwright install
			// <browser>` is the documented way to download the missing one. We name
			// the specific browser from the typed error rather than a generic hint.
			return `npx playwright install ${(error as MissingBrowserBinaryError).browser}`;
		case 'missing-stealth-dependency':
			// Stealth launch was opted into but the OPTIONAL `patchright` dependency
			// is absent. Name the package from the typed error so the install command
			// is ready to run; we never silently fall back to vanilla Playwright.
			return `pnpm add ${(error as MissingStealthDependencyError).dependency}`;
		case 'invalid-proxy':
			// The --proxy value could not be parsed into a SOCKS proxy. Show the
			// expected URL shape; socks5h tunnels DNS too (no leak).
			return `${binary} serve --proxy socks5h://host:1080 (or socks5://user:pass@host:1080)`;
		case 'missing-profile':
			// A profile is created by the headed `setup-profile` flow (the ONE place
			// a profile dir is created — see core's MissingProfileError). Name the
			// profile so the command is ready to run as-is.
			return `${binary} setup-profile --profile ${(error as MissingProfileError).profile}`;
		case 'attach-not-chromium':
			// attach is Chromium-only; the fix is to start Chromium/Chrome with a
			// remote-debugging port and attach to THAT endpoint.
			return `${binary} attach --endpoint http://127.0.0.1:9222 (start Chromium/Chrome with --remote-debugging-port=9222 first)`;
		case 'attach-no-context':
			// The reached browser has no window/tab to reuse; the fix is to open one.
			return `${binary} attach --endpoint ${(error as AttachNoContextError).endpoint} (open a window/tab in that browser first)`;
		case 'no-live-server':
			// No long-lived session server is running (ADR-0005): a verb is a thin
			// client and has nothing to drive. The fix is to bring one up FIRST with
			// `serve`; we never auto-spawn a browser in v1.
			return `${binary} serve`;
		case 'session-already-active':
			// A session is already live; v1 holds exactly one. The fix is to tear it
			// down before starting another.
			return `${binary} stop`;
		case 'cross-origin-frame':
			// `eval --frame` reaches the top document and SAME-ORIGIN child frames
			// only (page-world JS cannot cross a security boundary). There is no
			// flag that makes a cross-origin frame reachable here; the fix is to
			// target a same-origin frame, or omit --frame for the top document. (The
			// cross-origin reach is the separate Tier-4 surface.)
			return `${binary} eval '<expression>' (drop --frame for the top document, or pass a SAME-ORIGIN frame selector)`;
		case 'screenshot-path-outside-managed-dir':
			// A --out override escaped the managed screenshots dir. webhands writes
			// only WITHIN that dir; the fix is to drop --out (let webhands mint a
			// path) or pass one under the managed dir.
			return `${binary} screenshot (drop --out to let webhands mint a path under ${(error as ScreenshotPathError).managedDir}, or pass an --out inside it)`;
		default: {
			// Exhaustiveness guard: a new ControllerErrorCode must add a fix command
			// here rather than silently fall through to a generic message.
			const _never: never = error.code;
			return `Run \`${binary} --help\` (unhandled error code: ${String(_never)}).`;
		}
	}
}

/**
 * If `cause` is a typed `core` error, return the {@link MappedError} (the
 * user-facing message with the exact fix command appended); otherwise return
 * `undefined` so the caller falls back to the generic error path.
 *
 * The message is the typed error's own message (which already states the
 * condition in domain terms) followed by a blank line and a `To fix, run:`
 * block naming the exact command. We keep `core`'s message rather than
 * re-author it, so the condition text has one source of truth; the CLI's job is
 * only to ADD the actionable fix command.
 */
export function mapControllerError(
	cause: unknown,
	binary: string,
): MappedError | undefined {
	if (!isControllerError(cause)) {
		return undefined;
	}
	const fix = fixCommandFor(cause, binary);
	return {
		code: cause.code,
		message: `${cause.message}\n\nTo fix, run:\n  ${fix}`,
	};
}

// Re-export the concrete classes so a test importing from the cli package can
// construct/assert against them without reaching into core directly.
export {
	MissingBrowserBinaryError,
	MissingStealthDependencyError,
	InvalidProxyError,
	MissingProfileError,
	AttachNotChromiumError,
	AttachNoContextError,
	NoLiveServerError,
	SessionAlreadyActiveError,
	CrossOriginFrameError,
	ScreenshotPathError,
};
export type {ControllerError, ControllerErrorCode};
