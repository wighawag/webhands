---
title: resolveLocator / eval execute caller-supplied expressions (a code-exec surface)
slug: resolve-locator-executes-caller-expressions
---

Spotted while Gate-3 reviewing `playwright-launch-transport-and-profile`.

`packages/core/src/playwright-launch-transport.ts` resolves a raw Playwright
locator string (ADR-0004) by `new Function('page','p', 'return (' + expression + ')')`,
and the `eval` verb runs `pwPage.evaluate(expression)`. Both EXECUTE
caller-supplied expressions in-process / in the page. This is BY DESIGN
(ADR-0004: the locator is an expression the controller resolves, sibling to
`eval`) and acceptable for a LOCAL, personal tool driven by its own agent on the
user's own session/machine/IP, the exact framing in ADR-0002 and the PRD's
ToS/humility note.

Signal (not a bug): this is worth an explicit one-line SECURITY/SCOPE note in the
user-facing docs (the tool runs arbitrary expressions from whoever drives it; do
not expose its server to untrusted callers). Natural home: the
`docs-tos-humility-and-kayak-smoke` task's humility/ToS docs, and a caution near
the `serve` endpoint when `cross-invocation-session-persistence` lands (the
served `/mcp`/HTTP endpoint must not be bound to a public interface).

No code change implied here; captured so the docs/serve tasks carry the note.
