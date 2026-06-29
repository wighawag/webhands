---
'@webhands/core': minor
'webhands': minor
---

Add a `script` verb that runs a caller-supplied DRIVER-CONTEXT script against the one live served session, handing it the full Playwright `page` so it can locate + act + auto-wait + read a whole sub-flow in ONE call and return the serializable result. This closes the "one process per action" token cost the scoreboard exposed: a webhands agent can now batch a known sub-flow into one turn (like the Playwright baseline does) against the page it ALREADY opened, instead of shelling out one verb per action.

`script` is a new BUILT-IN `scriptHand` (the `evalHand` shape, closing over the live `HandContext.pwPage`); it does NOT change or supersede `eval`. The source is JS that evaluates to a function of the page (e.g. `async (page) => { ... }`), read from `--file <path>`, an inline argument, or stdin. Its in-process `page` API is plain Node JS (NOT an ADR-3 seam surface), but its RETURN stays seam-clean (serializable, no Playwright/CDP type), and a throwing script rejects as a clean structured error. TRUST: the SAME page-script surface as `eval` (caller JS, loopback-only), NOT the `hands.json` hand-loading / npm-dependency surface. Documented in a new ADR (`docs/adr/0012`) and the README security note.
