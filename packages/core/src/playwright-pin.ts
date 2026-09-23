/**
 * The Playwright version this build is PINNED TO, read at runtime.
 *
 * Exists because of a property that is easy to state and easy to forget:
 * Playwright resolves a browser BY REVISION, and each Playwright version pins
 * its own revision. `playwright@1.61.1` wants `chromium-1228` and will not use
 * `chromium-1223` or `chromium-1234`, even though all three are "chromium" and
 * all three sit in the same cache dir.
 *
 * The consequence is that ANY install instruction webhands emits must name the
 * version it was built against. A bare `npx playwright install chromium`
 * resolves whatever Playwright is latest on npm that day, which downloads a
 * revision this build cannot use: a fix command that costs a ~150MB download
 * and lands the user back on the identical error. This module is what lets the
 * CLI pin it instead (`packages/cli/src/errors.ts`).
 *
 * Read from `playwright/package.json` rather than hard-coded here, so the pin
 * cannot drift from the dependency that defines it: bumping `playwright` in
 * `package.json` changes this answer with no code edit.
 */
import {createRequire} from 'node:module';

/** Memoised, including the negative answer (`null`): one resolve per process. */
let cached: string | null | undefined;

/**
 * The version string of the bundled `playwright` (e.g. `1.61.1`), or
 * `undefined` when it cannot be read.
 *
 * `undefined` is a legitimate outcome, not an error to surface: an exotic
 * bundling/packaging layout can hide `playwright/package.json` from module
 * resolution while the library itself works fine. Callers must degrade to
 * something still-useful rather than throw, because this is only ever consulted
 * while ALREADY reporting a different failure.
 */
export function bundledPlaywrightVersion(): string | undefined {
	if (cached === undefined) {
		cached = readBundledPlaywrightVersion() ?? null;
	}
	return cached ?? undefined;
}

function readBundledPlaywrightVersion(): string | undefined {
	try {
		const require = createRequire(import.meta.url);
		const pkg = require('playwright/package.json') as {version?: unknown};
		return typeof pkg.version === 'string' ? pkg.version : undefined;
	} catch {
		return undefined;
	}
}
