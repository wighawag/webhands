---
'webhands': patch
'@webhands/core': patch
---

**`--real-chrome` now tells you WHY a browser failed to start, and offers an escape where there is no sandbox.**

Found by CI going red: every spawn aborted on the runner with nothing but `it exited on signal SIGABRT`. The cause is that a plainly-spawned Chrome needs a usable sandbox, and a CI runner or container has neither a setuid helper (the bundled `chrome_sandbox` is not setuid) nor permissive user namespaces. Playwright's own launches never hit it because Playwright passes `--no-sandbox` by default, which is exactly why the same binary works when Playwright starts it and dies when we do.

Two fixes:

- **Chrome's stderr is captured and quoted** in `RealChromeStartError` (drained before reading, because Node delivers `exit` before the stdio pipes finish, so an earlier synchronous read returned nothing). The browser had been explaining itself all along; we were ignoring the pipe. Also exposed as `error.stderr`.
- **`WEBHANDS_CHROME_ARGS`** appends extra browser flags, so `--real-chrome` is usable in a container with `WEBHANDS_CHROME_ARGS='--no-sandbox --disable-dev-shm-usage'`. webhands never adds those itself: the mode exists to BE the user's real browser, and a real desktop Chrome is sandboxed, so disabling it has to be a deliberate operator decision. The error message names the variable, so the fix is discoverable at the point of failure.

The tests route every spawned browser through one helper that applies the CI-only sandbox flags, so the concession lives in a single documented place rather than in four test files.
