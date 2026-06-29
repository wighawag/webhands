import {defineConfig} from 'vitest/config';

/**
 * The eval harness's OWN test runner, invoked via this package's `self-test`
 * script and NEVER by the repo gate.
 *
 * Non-gating is STRUCTURAL, not a flag here: `evals/` lives outside
 * `packages/*`, and the gate is `pnpm test` = `pnpm --filter './packages/*'
 * test`, so pnpm never fans out to this workspace. This config only governs the
 * D3 machinery self-test (deterministic, local-fixture), which is gate-testable
 * BY NATURE (no live site) yet deliberately kept out of the actual gate so even
 * the harness's own self-test cannot creep into `verify`.
 */
export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		// The serve lifecycle launches a real (headless) browser and drives it
		// across separate processes, so give the machinery self-test room.
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
});
