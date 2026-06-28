---
'@webhands/core': minor
'webhands': minor
---

Add the Tier-2 rich input verbs to the agent surface: `press` / `hover` / `select` / `scroll` / `drag` (the "broaden the agent verb surface" prd, stories 8-12). These lift page-level Playwright actions a hand already has on the live page up to the agent verb seam, so a seam-only (MCP / Model-B) agent can drive a browser game or a richer form, not just `click`/`type`.

- `press(key, target?)` sends a keyboard key or chord — a key name (`Enter`, `ArrowLeft`, `a`) or `Modifier+Key` (`Control+A`, `Shift+Tab`), Playwright's `keyboard.press` grammar — at a locator (focuses it first) or, with no locator, the page's focused element.
- `hover(target)` hovers the pointer over an element to reveal hover menus / on-hover controls `click` cannot surface.
- `select(target, {value} | {label})` chooses a native `<select>` option by value OR by label (exactly one), reflected in the element's live state.
- `scroll({to} | {by})` scrolls the page TO an off-viewport element (`scrollIntoViewIfNeeded`) or BY a `{dx, dy}` pixel delta (`mouse.wheel`) — exactly one form.
- `drag(source, target)` drags one element onto another for drag-reorder UIs and drag-slider challenges (`dragTo`).

All locator addressing resolves through the single existing resolver `click`/`type` use (so a same-origin `frameLocator(...)` hop in the string Just Works — no parallel addressing scheme), and the seam stays type-clean (ADR-0003): keys are strings, offsets are numbers, locators are strings, so nothing Playwright-shaped crosses. Signatures are options-object / positional in the established style so a future `frame?` qualifier stays additive.

Each verb is both a CLI command and an MCP tool from one incur definition: `press <key> [--locator]`, `hover <locator>`, `select <locator> --value/--label`, `scroll --to/--by`, `drag <source> <target>`. `select` and `scroll` use the same loud "exactly one of" validation as `wait` for their mutually-exclusive flags (and `scroll --by` rejects a malformed `dx,dy` rather than scrolling by `NaN`). There is no `--frame` flag (frame scope rides in the locator string).
