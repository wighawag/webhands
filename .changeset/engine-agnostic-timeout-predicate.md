---
'webhands': patch
'@webhands/core': patch
---

**`--stealth` no longer silently disables `click`'s dispatch fallback.** The hidden-control escape, and the `eval --frame` "no iframe matched" message, branched on `cause instanceof pwErrors.TimeoutError`: a class-identity check against the `playwright` package. Under `--stealth` the page is driven by `patchright`, an API-compatible FORK that ships its own `TimeoutError` class, so the branch was false for every timeout it raised and `click` on a control hidden behind a styled label rethrew a raw timeout instead of dispatching. Verified against the installed packages: `playwright.errors.TimeoutError !== patchright.errors.TimeoutError`. Both sites now go through one structural `isTimeoutError` predicate that also matches on the error name, with a test that guards its own premise so it cannot quietly stop proving anything.
