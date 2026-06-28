---
'@webhands/core': minor
'webhands': minor
---

Add the Tier-1 read verbs to the agent surface: `query` plus the state shorthands `exists` / `count` / `isVisible` / `getAttribute` (first deliverable of the "broaden the agent verb surface" prd). These kill the `eval`-returns-a-JSON-string pattern for reading structured data and probing element state.

`query(locator, {attrs?, props?, pw?, limit?})` addresses element(s) by a raw Playwright locator expression (already same-origin frame-capable via a `frameLocator(...)` string) and returns ONE ROW PER MATCH carrying EXACTLY the requested fields:

- `attrs` reads DOM ATTRIBUTES by name (`getAttribute`);
- `props` reads live JS PROPERTIES by name (`el[name]`, e.g. `innerText`, `value`, `checked`); `text` is just `props: ['innerText']`;
- `pw` is the only fixed set: `visible` (`locator.isVisible()`, actionability-grade) and `bbox` (`locator.boundingBox()`, viewport CSS-pixels);
- `limit` bounds the rows returned.

The `attrs`/`props` split is LOUD and never auto-detected (so `attrs:['checked']` and `props:['checked']` can differ). The state verbs are thin shorthands over the same machinery: `count` = match-set size, `exists` = `count > 0`, `isVisible` = the first match's `pw:['visible']`, `getAttribute` = the first match's `attrs:[name]`.

The options are an OPTIONS OBJECT so a future `frame?` / `ref` field is non-breaking, and all locator/frame resolution routes through the single existing resolver (no parallel addressing scheme). Values cross the RPC seam by structured clone with no Playwright/CDP type leak, the same contract `eval` holds. Each verb is both a CLI command and an MCP tool from one incur definition; the list flags `--attr` / `--prop` / `--pw` are REPEATABLE, not comma-joined; there is no `--frame` flag (frame scope rides in the locator string).
