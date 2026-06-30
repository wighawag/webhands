# `npx webhands` not on PATH in a fresh worktree forces a `node node_modules/webhands/dist/bin.js` fallback in live eval runs

2026-06-30 (noticed while running the `webhands-script-only` head-to-head benchmark).

In a fresh checkout/worktree the eval harness's default `--webhands` command
(`npx --yes webhands`) fails at `serve` startup (the workspace bin isn't linked
into a root `node_modules/.bin`, and `--yes` tries the registry), so live
`run-eval` runs need either `--webhands "node <repo>/packages/cli/dist/bin.js"`
or the agent itself falls back to `node node_modules/webhands/dist/bin.js`. Every
webhands leg in this benchmark transcript shows the agent discovering this and
switching to the direct-node invocation. It does not change the measured surface
(same CLI), but it costs the agent a few discovery turns and is a papercut for
anyone re-running the scoreboard. Out of scope here; just capturing the signal.
