---
'webhands': patch
'@webhands/core': patch
---

**The browser-install fix command is now VERSION-PINNED, and `missing-browser-binary` says which revision it wanted.**

Found in the field on a standalone install: the first run failed with `missing-browser-binary`, the user ran the suggested `npx playwright install chromium`, it succeeded, and the identical error came back. Playwright resolves browsers by REVISION and each Playwright version pins its own, so the unpinned command (which resolves whatever Playwright is latest on npm that day) downloads a revision this build cannot use. That machine ended up holding `chromium-1223` and `chromium-1234` while webhands wanted `1228`. A fix command that costs a ~150MB download and returns you to the same error is worse than no fix command at all.

- **The fix command names our pin**: `npx playwright@1.61.1 install chromium`, read at runtime from the bundled `playwright/package.json` (exported as `bundledPlaywrightVersion`), so bumping the dependency cannot leave a stale version in an install instruction. The unpinned form survives only as the fallback for when that version cannot be read.
- **`MissingBrowserBinaryError` carries the evidence**: `executablePath` (the exact build Playwright looked for) and `present` (the sibling revisions that ARE installed), both folded into the message. Playwright's own error named the path all along; the transport was discarding it on re-raise, which left the user with "the chromium browser binary is not installed" on a machine holding eight browser trees, a sentence that reads as false and sends the reader looking anywhere but at the revision.

Docs carry the same correction: the README explains that the browser is a separate, revision-matched download (and that this bites hardest on a global/store-path install, or on a machine running other Playwright projects), and the bundled `use-webhands` skill gains a first-run entry so an agent fixes this itself instead of escalating, including the warning not to substitute the generic unpinned command and the note that it is not a headed/display problem.
