---
'@webhands/core': minor
---

Open the hand-host to THIRD-PARTY hands (Phase 2). The `Hand`, `HandContext`,
and `HandContribution` types are now PUBLIC (exported from the package entry
point) as the stable third-party authoring contract: a hand receives
`{pwPage, context, ensureOpen}` and contributes named verbs plus an optional
`dispose`. A new explicit, declarative loading mechanism (modeled on pi's
`packages[]`) loads a third-party hand ONLY when it is NAMED in
`<home>/hands.json` with a PINNED entry point (`readHandsConfig` / `loadHands` /
`HandsConfig` / `HandEntry` / `HandLoadError`); there is no auto-discovery, no
`node_modules` scan, and no convention-inferred entry, and install is separate
from load (naming a hand is the trust act, an installed-but-not-named hand never
loads). Both Playwright transports now accept the loaded hands and compose them
into the session `Page` through the same host the built-ins use, so a
third-party hand's verbs compose alongside the built-in verbs. Adds ADR-0007
recording the public-contract decision, the explicit-declarative loading model,
and the "loading a hand == trusting an in-process npm dependency" trust framing.
