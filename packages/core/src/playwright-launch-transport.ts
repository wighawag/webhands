import {stat} from 'node:fs/promises';
import {chromium, type BrowserContext, type Page as PwPage} from 'playwright';
import {MissingBrowserBinaryError, MissingProfileError} from './errors.js';
import {composeWithHands, type Hand, type HandContext} from './hand-host.js';
import {
	resolveProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';
import type {OpenTarget, Session, Transport} from './seam.js';

/**
 * The v1 concrete transport: a Playwright browser the controller LAUNCHES
 * against a dedicated, persistent profile directory it owns (PRD "Solution,
 * launch"; ADR-0002). It implements the `core` {@link Transport}/`Driver` seam
 * with NO Playwright/CDP types in its public surface (ADR-0003): the
 * Playwright types are confined to this module.
 *
 * It handles ONLY `mode: 'launch'`. The `attach` mode (`connectOverCDP`) is a
 * SEPARATE transport (task `attach-transport-cdp-chromium`); calling `open`
 * with `mode: 'attach'` here throws, because mixing the two launch mechanisms
 * in one transport is what ADR-0003's seam exists to avoid.
 *
 * Profile location is resolved from the constructor options (or the
 * `WEBHANDS_HOME` env var, or `~/.webhands`). See
 * {@link resolveProfileLocation}. Because that is a SHARED location, tests pass
 * a temp `root` (or set the env var) and assert the real home is untouched.
 */
export class PlaywrightLaunchTransport implements Transport {
	readonly #location: ProfileLocationOptions;
	readonly #hands: readonly Hand[];

	/**
	 * @param location overrides for where profiles live (a `root` dir and/or an
	 *   `env`). Omit in production to use `~/.webhands`; pass a temp
	 *   `root` in tests to isolate the shared profile location.
	 * @param hands explicitly-loaded third-party hands to compose alongside the
	 *   built-ins (Phase 2, ADR-0007). These come from {@link loadHands} against
	 *   the operator's explicit config; the transport does NOT discover them. Omit
	 *   for the built-ins-only surface.
	 */
	constructor(
		location: ProfileLocationOptions = {},
		hands: readonly Hand[] = [],
	) {
		this.#location = location;
		this.#hands = hands;
	}

	async open(target: OpenTarget): Promise<Session> {
		if (target.mode !== 'launch') {
			throw new Error(
				`PlaywrightLaunchTransport only handles 'launch'; ` +
					`'${target.mode}' is owned by the attach transport.`,
			);
		}

		const loc = resolveProfileLocation(target.profile, this.#location);

		// A profile is "set up" iff its dedicated dir exists on disk. Creating it
		// is the headed `setup-profile` flow's job (a later task); `launch`
		// against a missing profile is the typed MissingProfileError so the CLI
		// can tell the user to run `setup-profile` first (PRD story 17). We never
		// create the dir here, so a `launch` typo cannot silently spawn a blank
		// profile.
		if (!(await isExistingDirectory(loc.profileDir))) {
			throw new MissingProfileError(loc.profile, loc.profileDir);
		}

		const headless = target.headed !== true;

		let context: BrowserContext;
		try {
			context = await chromium.launchPersistentContext(loc.profileDir, {
				headless,
			});
		} catch (cause) {
			if (isMissingBrowserBinary(cause)) {
				throw new MissingBrowserBinaryError('chromium', undefined, {cause});
			}
			throw cause;
		}

		// launchPersistentContext always opens with exactly one page; reuse it as
		// the single active page (PRD: single active session in v1). Create one if
		// the build ever changes that invariant.
		const pwPage = context.pages()[0] ?? (await context.newPage());
		return makeSession(context, pwPage, this.#hands);
	}
}

/** True iff `path` exists and is a directory. */
async function isExistingDirectory(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Recognise Playwright's "browser executable doesn't exist" failure. Playwright
 * does not export a typed error for this, so we detect on the message (it
 * instructs the user to run `playwright install`). We confine that brittle
 * string match to this one spot and re-raise as a stable typed error.
 */
function isMissingBrowserBinary(cause: unknown): boolean {
	const message = cause instanceof Error ? cause.message : String(cause ?? '');
	return (
		/Executable doesn't exist/i.test(message) ||
		/please run the following command to download new browsers/i.test(
			message,
		) ||
		/playwright install/i.test(message)
	);
}

/**
 * Wrap a live Playwright persistent context into the seam's {@link Session}.
 *
 * The VERB surface comes from the shared hand-host ({@link composeBuiltInPage}),
 * which is the single place the eight built-in verbs are composed (no duplicated
 * page-object literal). Only the SESSION LIFECYCLE is per-transport here: the
 * launch transport listens on the context's `'close'` event and its `close()`
 * calls `context.close()`, which KILLS the browser this transport spawned
 * (contrast the attach transport, which detaches without killing the user's
 * browser, ADR-0002).
 */
function makeSession(
	context: BrowserContext,
	pwPage: PwPage,
	extraHands: readonly Hand[],
): Session {
	let closed = false;
	const ensureOpen = () => {
		if (closed) {
			throw new Error('session is closed');
		}
	};

	// Resolves the first time the context is gone — whether the USER closed the
	// window (Playwright fires the context 'close' event) or our own close()
	// ran. This is what lets `setup-profile` hold the headed window open and
	// block on waitForClose() until the human is done.
	let resolveClosed!: () => void;
	const closedSignal = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	const markClosed = () => {
		if (closed) return;
		closed = true;
		resolveClosed();
	};
	context.on('close', markClosed);

	// Build the verb surface from the built-in hands over a live hand-context.
	// The host keeps the live `pwPage`/`context` in-process (they never cross the
	// seam, ADR-0003); the hand-context carries live page access only.
	const handContext: HandContext = {pwPage, context, ensureOpen};
	const {page, dispose: disposeHands} = composeWithHands(
		handContext,
		extraHands,
	);

	return {
		page,
		async close(): Promise<void> {
			if (closed) {
				return;
			}
			// Dispose the hands first (their in-process resources), THEN tear down
			// the browser: context.close() fires the 'close' event, which runs
			// markClosed and KILLS the browser this transport spawned.
			await disposeHands();
			await context.close();
			markClosed();
		},
		waitForClose(): Promise<void> {
			return closedSignal;
		},
	};
}
