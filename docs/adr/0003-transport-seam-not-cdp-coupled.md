# `core` exposes a verb-level transport seam that does not assume CDP

`core`'s browser-control logic sits behind a `Driver`/`Transport` interface defined in terms of high-level verbs (navigate, snapshot, click, type, eval, wait, cookies), not in terms of CDP or Playwright primitives. We chose this so two future transports can slot in without changing the verb surface: a browser-extension content-script transport (the stronger-stealth path deferred from ADR-0001/0002), and a non-Chromium (Firefox) transport. CDP-attach (`connectOverCDP`) is Chromium-only, so a seam expressed in CDP terms would foreclose Firefox; expressing it in verbs keeps both open. The v1 concrete implementation is the Playwright transport; the others are designed-for but not built.

## Consequences

- The seam must not leak CDP/Playwright types into its public interface.
- Firefox `attach` would need a different mechanism than CDP (Playwright Juggler / persistent context), which the verb-level seam accommodates.
