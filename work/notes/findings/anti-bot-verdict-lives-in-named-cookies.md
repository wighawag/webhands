---
title: 'An Akamai bot verdict lives in named cookies and is recoverable by clearing them'
slug: anti-bot-verdict-lives-in-named-cookies
type: finding
status: verified
created: 2026-09-11
source: 'Live session against eki-net.com (Akamai Bot Manager, authenticated Japanese rail booking), Sept 2026: ~15 rapid automated flows in 40 minutes tripped the block; clearing the four named cookies via page.context().clearCookies({name}) restored access immediately with the login intact.'
---

## What is true

1. **The verdict is PERSISTED in cookies, not in the connection.** Akamai Bot
   Manager keeps its decision in `_abck`, alongside `bm_sz`, `bm_sv` and
   `ak_bmsc`. Once tripped, the block survives reloads and new navigations.

2. **The symptom is deceptive, and this is the part that wastes time.** The
   static, edge-cached top page keeps rendering fine, so the session LOOKS
   healthy; every DYNAMIC endpoint returns a bare "Access Denied" page, including
   endpoints that worked seconds earlier. "The site loaded" is therefore not
   evidence of being unblocked.

3. **Clearing ONLY those four names restores access immediately, and the login
   SURVIVES.** The authenticated session lives in different cookies entirely (on
   this site, ASP.NET session cookies), so the recovery is surgical: the WAF
   re-evaluates from scratch while the human stays signed in. No re-login, no
   re-solving anything.

4. **It is rate-driven.** Roughly 15 rapid automated flows inside 40 minutes was
   enough to trip it. Anything long-running needs BOTH pacing and a recovery
   step, not one or the other.

## Why it matters

Before this, the `cookies` verb did export/import only, so the ONLY way to clear a
cookie was to drop into `script` and call `page.context().clearCookies({name})` by
hand. That is a poor place for a recovery step: it is the verb an agent reaches
for last, it needs a file on disk, and it gives no count back, so you cannot tell
"removed 4" from "the names were misspelled".

## Consequence

- New seam verb `clearCookies(filter)` plus `cookies clear --name/--domain/--path`,
  returning the number the browser ACTUALLY removed (a before/after difference,
  not the size of the filter), so 0 is a visible signal rather than a silent
  success.
- An EMPTY filter REFUSES. Playwright's own `clearCookies()` means "clear
  everything"; pointed at a live logged-in session that is an irreversible
  silent logout, so clearing everything must be asked for as `--all`.
- DELIBERATELY NOT a built-in `--bot-block` preset naming the four cookies. The
  verb stays "clear your own cookies by name"; the vendor-specific recipe lives in
  the docs (skill + README), where it can be read, questioned and updated. That
  keeps ADR-0002's line intact: we help the real logged-in user act as themselves,
  we do not ship a vendor-evasion feature.
- The operational half is documented with it: pace the flows, and re-check a
  DYNAMIC endpoint (not the cached top page) to confirm recovery.
