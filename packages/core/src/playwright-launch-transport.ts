import {stat} from 'node:fs/promises';
import {chromium, type BrowserContext, type Page as PwPage} from 'playwright';
import {MissingBrowserBinaryError, MissingProfileError} from './errors.js';
import {
	resolveProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';
import type {
	Cookie,
	OpenTarget,
	Page,
	Session,
	Snapshot,
	Transport,
	WaitCondition,
} from './seam.js';

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
 * `MY_BROWSER_CONTROLLER_HOME` env var, or `~/.my-browser-controller`). See
 * {@link resolveProfileLocation}. Because that is a SHARED location, tests pass
 * a temp `root` (or set the env var) and assert the real home is untouched.
 */
export class PlaywrightLaunchTransport implements Transport {
	readonly #location: ProfileLocationOptions;

	/**
	 * @param location overrides for where profiles live (a `root` dir and/or an
	 *   `env`). Omit in production to use `~/.my-browser-controller`; pass a temp
	 *   `root` in tests to isolate the shared profile location.
	 */
	constructor(location: ProfileLocationOptions = {}) {
		this.#location = location;
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
		return makeSession(context, pwPage);
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

/** Wrap a live Playwright persistent context into the seam's {@link Session}. */
function makeSession(context: BrowserContext, pwPage: PwPage): Session {
	let closed = false;
	const ensureOpen = () => {
		if (closed) {
			throw new Error('session is closed');
		}
	};

	const page: Page = {
		async navigate(url: string): Promise<void> {
			ensureOpen();
			await pwPage.goto(url, {waitUntil: 'load'});
		},
		async snapshot(): Promise<Snapshot> {
			ensureOpen();
			const url = pwPage.url();
			const content = (await pwPage.textContent('body')) ?? '';
			return {url, content};
		},
		async click(t): Promise<void> {
			ensureOpen();
			await resolveLocator(pwPage, t).click();
		},
		async type(t, text): Promise<void> {
			ensureOpen();
			await resolveLocator(pwPage, t).fill(text);
		},
		async eval(expression: string): Promise<unknown> {
			ensureOpen();
			return pwPage.evaluate(expression);
		},
		async wait(condition: WaitCondition): Promise<void> {
			ensureOpen();
			switch (condition.kind) {
				case 'timeout':
					await pwPage.waitForTimeout(condition.ms);
					return;
				case 'locator':
					await resolveLocator(pwPage, condition.target).waitFor();
					return;
				case 'navigation':
					await pwPage.waitForNavigation();
					return;
			}
		},
		async cookies(): Promise<readonly Cookie[]> {
			ensureOpen();
			const raw = await context.cookies();
			return raw.map(toSeamCookie);
		},
		async setCookies(cookies): Promise<void> {
			ensureOpen();
			await context.addCookies(cookies.map(fromSeamCookie));
		},
	};

	return {
		page,
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			await context.close();
		},
	};
}

/**
 * Resolve a raw Playwright locator EXPRESSION (ADR-0004) against the page. The
 * verb surface passes locator expressions like `getByRole('button', …)`; we
 * evaluate them in a small sandbox where `page`/`p` is the page, so the full
 * Playwright locator grammar is available without leaking the type across the
 * seam.
 */
function resolveLocator(page: PwPage, expression: string) {
	// eslint-disable-next-line no-new-func
	const factory = new Function('page', 'p', `return (${expression});`) as (
		page: PwPage,
		p: PwPage,
	) => ReturnType<PwPage['locator']>;
	return factory(page, page);
}

/** Map a Playwright cookie to the transport-neutral seam {@link Cookie}. */
function toSeamCookie(c: {
	name: string;
	value: string;
	domain?: string;
	path?: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: 'Strict' | 'Lax' | 'None';
}): Cookie {
	return {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires: c.expires,
		httpOnly: c.httpOnly,
		secure: c.secure,
		sameSite: c.sameSite,
	};
}

/** Map a seam {@link Cookie} to a Playwright cookie shape. */
function fromSeamCookie(c: Cookie) {
	return {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires: c.expires,
		httpOnly: c.httpOnly,
		secure: c.secure,
		sameSite: c.sameSite,
	};
}
