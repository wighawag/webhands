---
'@my-browser-controller/core': minor
---

Implement the `snapshot` verb: a token-cheap structured page view with stable refs.

`snapshot` now returns the accessibility tree (roles + accessible names) plus visible text with stable `[ref=...]` element refs by default, so an agent can read the page and decide what to act on without parsing raw HTML; the refs are stable for an unchanged page (re-snapshotting yields the same refs). A `--full` option (`snapshot({full: true})`) returns the raw DOM instead (settled PRD decision, story 7). The seam `Snapshot` type is widened from the previous `{url, content}` stub to `{url, view, content}` with a `SnapshotView` (`'accessibility' | 'full'`) and a `SnapshotOptions` arg, all transport-neutral (no CDP/Playwright types cross the seam, ADR-0003). The Playwright launch and attach transports implement it via `page.ariaSnapshot({mode: 'ai'})` (default) and serialized `documentElement.outerHTML` (`--full`); snapshot refs and raw Playwright-locator addressing (ADR-0004) are complementary ways to address elements. Tests drive a real local Chromium against the local fixture page and assert the snapshot shape (roles/names/text present, ref stability across re-snapshots, raw DOM under `--full`) at the `core` Driver seam.
