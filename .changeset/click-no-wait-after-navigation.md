---
'@webhands/core': patch
---

Fix the `click` verb timing out on a real submit button whose click triggers a slow navigation.

Playwright's `Locator.click()` clicks AND THEN auto-waits for any navigation the click scheduled to finish, and that post-click wait was charged against the verb's short actionability budget (`NORMAL_CLICK_TIMEOUT_MS`, 1s). So a perfectly normal, visible, actionable submit button whose navigation took longer than 1s had its already-performed click reported as a `TimeoutError` and was wrongly routed to the dispatch escape path, which then re-clicked a page that was already navigating away, surfacing a second timeout. (Observed on the DVSA login "Continue" button in `examples/basic`.)

The happy-path click now passes `noWaitAfter: true`, so the short budget measures ACTIONABILITY only (can we click it?), not how long the resulting navigation takes. A genuinely non-actionable hidden custom input still cannot be clicked within the budget and still falls through to `dispatchEvent` exactly as before, so the hidden-input escape path is unchanged.

Covered by a regression test that clicks a submit button whose navigation is held back beyond the budget (a new `?delayMs=` fixture-server delay + `slow-submit.html` fixture); it fails without the fix and passes with it.
