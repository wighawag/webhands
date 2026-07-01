---
'webhands': patch
---

Docs: tell a sharper hands story across the README and the capability scoreboard.

A **hand** is now framed as sitting ABOVE the verbs-vs-Playwright comparison and winning on two distinct axes, not just "the simpler path":

- **New capability raw Playwright cannot reach at all** (e.g. a captcha-solving hand plugs in solving logic + a provider key webhands does not ship, so the comparison becomes "reaches the goal vs does not").
- **Token collapse on flows Playwright CAN do** (a known sub-flow authored into a hand ONCE becomes a single cheap verb call instead of an N-turn explore loop the agent re-pays every run).

Adds a "Where hands change the game" subsection under the README scoreboard section, rewrites the Scope "hands" bullet around the ceiling+accelerator framing, and adds a matching note to `evals/SCOREBOARD.md`. Points at the incubating `distill-session-into-hand` idea as the cheap hand-authoring path.

No package behavior changes.
