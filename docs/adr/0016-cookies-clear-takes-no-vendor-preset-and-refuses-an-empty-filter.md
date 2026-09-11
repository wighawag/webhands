# `cookies clear` ships no vendor preset, and refuses an empty filter

The `cookies clear` verb removes a NAMED SUBSET of the session's cookies, which is what makes mid-session recovery from an anti-bot block possible (the verdict lives in a handful of named cookies while the login lives in the site's own). Two boundary decisions come with it, and both are the kind that get re-litigated: the verb takes **no vendor preset flag**, and an **empty filter is refused** rather than meaning "all".

## No `--bot-block` preset

It would be one line to ship `cookies clear --bot-block` expanding to Akamai's `_abck`/`bm_sz`/`bm_sv`/`ak_bmsc`. We do not, because a preset changes what the TOOL is. "Clear cookies by name" is a neutral capability the human could perform in two clicks of Chrome's own UI; a flag whose purpose is resetting a named vendor's bot verdict is a vendor-evasion feature, and shipping one would put webhands on the wrong side of ADR-0002's line no matter how the docs hedged it.

The per-vendor recipe therefore lives in documentation (the skill and README), where it can carry the things a flag cannot: that it was measured on one site, that some sites bind the session to the WAF cookie so the login may NOT survive, that the honest response to a returning block is to slow down or stop rather than to clear again. A flag would strip all of that context and invite a clear-drive-clear loop, which IS evasion.

The four names do appear as an example in the verb's own help text, so an agent can find the recipe at the point of use. That is a deliberate, smaller concession: naming cookies in prose is not the same as shipping a one-flag reset button.

## An empty filter is an error

Playwright's `clearCookies()` with no filter means "clear everything". Inheriting that default would make a forgotten `--name` a silent, irreversible logout from every site in the profile, on a tool pointed at a genuinely logged-in browser. So an all-absent filter REFUSES, at the CLI before any session is opened, in the page verb, and again on the RPC server for untyped clients; clearing everything requires an explicit `--all`, which cannot be combined with a narrowing flag.

The verb also returns how many cookies were ACTUALLY removed (a before/after count over the matching set, not the size of the filter), so `cleared: 0` visibly means "nothing matched, check the names" instead of passing silently.

## Consequences

- `distill` replays a clear faithfully, since a filter carries no secrets, EXCEPT a filterless entry, which becomes an annotated TODO rather than generated `clearCookies({})` code a human would later run.
- The refusal is duplicated at three layers on purpose. That is not belt-and-braces for its own sake: each layer has a caller the others do not cover (flags, in-process API, raw RPC).
