---
'@webhands/core': patch
---

Reject unknown/misshapen `SnapshotOptions` in the `snapshot` verb instead of silently ignoring them.

Previously the option was read narrowly as `options?.full === true`, so any other shape was silently dropped. Calling `snapshot({ view: 'full' })` (a natural mistake, since the result carries a `view` field) returned the accessibility view with no error, and the caller silently got the wrong content.

`snapshot` now validates its options at both entry points (the in-process host and, load-bearingly, the RPC server dispatch) through a single source of truth. An unknown key or a non-boolean `full` throws a clear, named error (e.g. `snapshot: unknown option "view" (did you mean { full: true }?)`), and that error propagates faithfully across the RPC seam like other verb errors. This is strictly a safety improvement: behaviour is unchanged for all valid inputs (`undefined`, `{}`, `{ full: true }`, `{ full: false }`).
