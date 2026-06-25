---
'webhands': patch
---

Wire `--version` (and the help header + MCP server version) to the package's real
version, read from `package.json` via a JSON import attribute. Previously
`--version` fell back to help output because no version was passed to
`Cli.create`.
