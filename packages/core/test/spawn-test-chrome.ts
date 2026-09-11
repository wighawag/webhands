import {chromium} from 'playwright';
import {spawnRealChrome, type RealChrome} from '../src/index.js';

/**
 * The args a spawned Chrome needs in an environment with no usable sandbox (a CI
 * runner, a container).
 *
 * `--no-sandbox` is the flag that broke CI: every `spawnRealChrome` test failed with
 * SIGABRT while the suite's Playwright-LAUNCHED tests passed in the SAME job, for the
 * non-obvious reason that Playwright adds `--no-sandbox` itself by default (its
 * `chromiumSandbox !== true` branch). webhands deliberately does not, because this
 * mode exists to BE the user's real browser and a real desktop Chrome is sandboxed.
 * So the concession belongs here, in the tests, and never in the product.
 *
 * `--disable-dev-shm-usage` rides along for the same family of reasons: containers
 * routinely mount a 64MB `/dev/shm`, which Chrome outgrows and then crashes over.
 *
 * Exported so a test that must call `spawnRealChrome` DIRECTLY (to assert its own
 * failure modes, say) applies exactly the same concessions as everything else.
 */
export const CI_SANDBOX_ARGS: readonly string[] = [
	'--no-sandbox',
	'--disable-dev-shm-usage',
];

/** The executable the tests treat as the "system" browser. */
export function testChromeExecutable(): string {
	// Playwright's bundled Chromium, so the suite needs no Google Chrome install on
	// the machine running it.
	return chromium.executablePath();
}

/**
 * Spawn a browser for TESTS through the real {@link spawnRealChrome}, with the
 * concessions a test environment needs ({@link CI_SANDBOX_ARGS}, bundled Chromium,
 * headless because CI has no display).
 *
 * One helper rather than the same three options in four test files, so the
 * concessions cannot be half-applied and the REASON survives as a single explanation
 * instead of four copies that drift.
 */
export async function spawnTestChrome(options: {
	readonly userDataDir: string;
	/** Extra args for the test's own purposes (appended after the CI flags). */
	readonly args?: readonly string[];
	readonly headless?: boolean;
	readonly proxy?: string;
	readonly readyTimeoutMs?: number;
}): Promise<RealChrome> {
	return spawnRealChrome({
		userDataDir: options.userDataDir,
		executablePath: testChromeExecutable(),
		headless: options.headless ?? true,
		...(options.proxy !== undefined ? {proxy: options.proxy} : {}),
		...(options.readyTimeoutMs !== undefined
			? {readyTimeoutMs: options.readyTimeoutMs}
			: {}),
		args: [...CI_SANDBOX_ARGS, ...(options.args ?? [])],
	});
}
