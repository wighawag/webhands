---
'@webhands/core': major
---

BREAKING: rename the verb-level transport seam type `Page` to `WebHandsPage`
(ADR-0008). The exported `Page` type is gone; import `WebHandsPage` instead.
This is a NAME-ONLY change: the eight verbs
(`navigate`/`snapshot`/`click`/`type`/`eval`/`wait`/`cookies`/`setCookies`), the
branded-locator-string addressing, the session RPC wire shape, the hand contract
semantics, and the trust model are all byte-for-byte unchanged.

The seam type's old name collided with Playwright's own `Page`, which forced
three modules (the hand host and both Playwright transports) to import
Playwright's page as `type Page as PwPage` purely to dodge the clash, and made
`HandContribution.verbs: Partial<Page>` read as a partial of Playwright's huge
`Page` rather than a subset of webhands' eight seam verbs. With the seam type
renamed, those `PwPage` aliases are dropped (Playwright's `Page` is imported
directly) and the seam meaning is unambiguous.
