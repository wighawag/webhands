---
'@webhands/core': minor
'webhands': minor
---

Add the extension transport, `serve --transport extension` (ADR-0018): a plain browser with no CDP anywhere (no debugging port, so `navigator.webdriver` is false), driven through a small webhands MV3 extension that runs Playwright's own selector engine, with every click and keystroke sent as trusted OS-level input (xdotool on a private Xvfb, Linux/X11). Locator strings mean the same thing as on the Playwright transport, including frame hops into cross-origin iframes. The slice supports goto, wait, snapshot (refs included), click, type, press, mouse, cookies, query and its shorthands, and a viewport screenshot; every other verb refuses with the typed `unsupported-by-transport`. `setup-profile --transport extension` writes the extension directory and prints the one-time "Load unpacked" steps for branded Google Chrome, which ignores `--load-extension`. New error codes: `unsupported-by-transport`, `extension-not-connected`, `os-input-unavailable`. Also: `serve` no longer dies mid-teardown when a second signal arrives while it is stopping.
