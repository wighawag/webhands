import {defineConfig} from 'vitest/config';

// A large share of this suite drives a REAL browser (launch, attach over CDP,
// headed `setup-profile`), and vitest runs test files in parallel workers, so
// several Chromium instances come up at once. Vitest's 5s default is a
// stopwatch on browser startup under that contention, not a real assertion
// about the code: the same files pass in ~4s each when run alone and time out
// when the whole suite races. Give browser-backed tests room so `pnpm test`
// is a signal about behaviour, not about how loaded the machine (or the CI
// runner) happens to be.
export default defineConfig({
	test: {
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
