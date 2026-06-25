---
"webhands": patch
---

Add a `use-webhands` agent skill and an agent-focused README on-ramp.

- New `skills/use-webhands/SKILL.md`: the workflow + judgment layer for driving
  `webhands` from an AI agent. Covers the `serve` → `goto` → `wait` → `snapshot`
  → `stop` pipe (per ADR-0005, not `launch`), backgrounding the blocking `serve`
  process, the anti-bot headed fallback, pacing XHR-rendered results, loose
  text-based selectors for `eval`, and the personal-use / read-freely-but-confirm-
  before-transacting guardrails. Complements the auto-generated per-verb
  `webhands-*` skills, which stay the per-flag reference.
- README: new "Use it via your AI agent (start here)" section showing the plain
  `npx webhands` bash flow (no MCP wiring), the one-time headed login, and the
  three things a new user must know. Existing How-it-works / Scope-and-honesty /
  Security sections are unchanged.

Docs only; no runtime behaviour change.
