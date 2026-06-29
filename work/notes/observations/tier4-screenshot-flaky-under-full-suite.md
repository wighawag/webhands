# Observation: tier4 viewport screenshot test flaky under the full core suite

2026-06-29: `packages/core/test/tier4-coordinate-screenshot.test.ts` >
"viewport scope returns {path,width,height} ..." intermittently fails with
`page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture
screenshot` when the WHOLE `@webhands/core` suite runs in parallel, but PASSES
reliably when that file runs in isolation. Looks like a headless-Chromium
capture hiccup under resource contention in this environment, not a logic bug
(unrelated to the `script` verb work). Noticed while landing
`verb-script-driver-context-playwright-page`.
