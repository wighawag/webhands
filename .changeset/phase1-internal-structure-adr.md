---
'@webhands/core': patch
---

Docs: add ADR-0006 recording the Phase-1 decision to refactor webhands' verbs
onto an INTERNAL hand-host primitive (behavior-preserving, no public-seam
change; `Hand`/`HandContext` package-internal until Phase 2; hands are trusted,
local, in-process peers with zero isolation), which refines ADR-0003/0004
rather than contradicting them (the live Playwright page stays in-process and
never crosses the seam). The public hand contract is called out as a separate
Phase-2 decision. Also pins `hand` in `CONTEXT.md` as a third axis orthogonal
to `transport` and `verb`, with the "not a verb / not a transport" guards.
