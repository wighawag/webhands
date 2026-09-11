import {defineConfig} from 'vitest/config';

// A large share of this suite drives a REAL browser (launch, attach over CDP,
// headed `setup-profile`, and now a SPAWNED system Chrome per real-chrome test),
// so the scarce resource is not CPU time but concurrent browser processes.
//
// TIMEOUTS: vitest's 5s default is a stopwatch on browser startup under
// contention, not a real assertion about the code: the same files pass in ~4s
// each when run alone and time out when the whole suite races. Give
// browser-backed tests room so `pnpm test` is a signal about behaviour, not
// about how loaded the machine (or the CI runner) happens to be.
//
// FILE PARALLELISM, off: generous timeouts stopped being enough. Running 48
// files at once oversubscribes the box badly enough that real-browser cases fail
// in a shifting, random subset (measured: 8 unrelated failures in one parallel
// run, all green sequentially), which is the worst possible gate: red often
// enough to be ignored, never the same red twice. The repo already carries five
// `work/notes/observations/*flaky*under*load*` notes describing exactly this.
// Sequential files cost ~100s total here, which is a fair price for a gate whose
// failures mean something. Individual files still run their own tests normally,
// and nothing stops a developer passing `--file-parallelism` for a quick loop.
export default defineConfig({
	test: {
		testTimeout: 60_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
