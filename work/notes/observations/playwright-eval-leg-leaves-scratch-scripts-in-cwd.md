# Playwright eval leg can leave scratch scripts in its cwd

2026-06-30 (while building `eval-dynamic-non-scriptable-mid-run-goal-shift`): a
live `--compare3` run left `packages/core/_explore.mjs` behind, a throwaway
`connectOverCDP` exploration script the Playwright-baseline agent wrote (it runs
from `packages/core` so `playwright` resolves) and did not clean up, despite its
self-report saying "helper scripts were cleaned up". Harmless to the run, but a
`git add -A` runner would sweep it into a commit and it trips `format:check`.
Noticed + deleted by hand here; flagging in case the harness should run the
Playwright leg in a throwaway temp cwd (or `.gitignore` an agent-scratch glob) so
the eval can never dirty the tree.
