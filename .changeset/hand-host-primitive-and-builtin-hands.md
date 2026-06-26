---
'@webhands/core': patch
---

Internal: introduce a package-private hand-host primitive and refactor the eight
built-in verbs (`navigate`, `snapshot`, `click`, `type`, `eval`, `wait`,
`cookies`, `setCookies`) into built-in hands composed over it. Both the launch
and attach transports now share this single verb composition instead of each
carrying a near-identical page-object literal; each transport keeps its own
session lifecycle (launch kills the spawned browser, attach detaches without
killing the user's browser). No public API change and no behavior change (the
existing verb test suite passes unmodified); the `Hand`/`HandContext` types stay
package-internal until Phase 2.
