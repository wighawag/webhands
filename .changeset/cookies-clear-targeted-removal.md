---
'webhands': minor
'@webhands/core': minor
---

Add `cookies clear`: remove a NAMED SUBSET of the active session's cookies and report how many actually went.

Motivated by a live Akamai-protected site that flipped from serving to blocking part way through an authenticated session. That verdict is persisted in a handful of named cookies (`_abck`, `bm_sz`, `bm_sv`, `ak_bmsc`), so every dynamic endpoint 403s until they are gone, while the login lives in the site's own separate session cookies. Clearing just those names restores access and keeps the human signed in. Until now the `cookies` verb did export/import only, so the only way to do that was to drop into `script`.

New seam verb `clearCookies(filter)` (`names` / `domain` / `path` / `all`, exact-match strings, every field must match) available in-process and over the session RPC, plus `webhands cookies clear [--name <n>]… [--domain <d>] [--path <p>] [--all]` where `--name` is repeatable. It returns the number of cookies the browser actually removed, computed as a before/after difference, so `cleared: 0` visibly means "nothing matched" rather than silently passing.

The count is over the MATCHING cookies, not the whole jar, so a background XHR writing a cookie mid-clear cannot skew it (a jar-wide difference could under-report, report a successful clear as `0`, or even go negative).

An EMPTY filter is REFUSED at the CLI, in the page verb and again on the RPC server. Playwright's own `clearCookies()` reads no-filter as "clear everything", which aimed at a live logged-in session is an irreversible silent logout, so clearing everything has to be asked for with `--all` (and cannot be combined with a narrowing flag). `distill` replays a clear faithfully rather than leaving it as a TODO, since the filter carries no secrets, except a filterless entry, which becomes an annotated TODO rather than generated wipe-everything code. The bot-block recovery recipe is documented in the skill and deliberately NOT shipped as a vendor-specific preset flag; that boundary decision, and the empty-filter refusal, are recorded in `docs/adr/0016`.

New exports from `@webhands/core`: `CookieFilter` and `validateCookieFilter`.
