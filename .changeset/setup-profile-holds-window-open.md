---
'webhands': patch
---

Fix `setup-profile`: hold the headed browser window open until the user closes it,
instead of closing it in the same tick. The command now blocks on a new
`Session.waitForClose()` seam method (resolves when the user closes the
window/context or `close()` is called), so the one-time login flow actually works;
on close it reports success and suggests `launch`.
