---
'webhands': minor
---

Cut the per-run CONTEXT overhead an agent pays around the useful work: suppress the per-result CTA "Suggested command" hints BY DEFAULT and make the bundled `use-webhands` skill a COMPLETE per-verb reference, so a skilled agent drives the surface without re-dumping `--help`/`--llms-full` at runtime (the two biggest overhead payloads the scoreboard transcripts found).

- **CTA default-off + opt-in flag.** Every verb result used to append a `cta: {commands:[...]}` next-verb block; an agent or program never reads it, so it was pure token overhead. It is now suppressed by default (lean output). A human exploring interactively re-enables it with `--cta` (alias `--hints`) on any verb. NOT an opt-out `--no-cta`: lean is the default, the breadcrumb is opt-in. The flag and the `WEBHANDS_CTA` env appear in `--help`/`--llms-full`.
- **`WEBHANDS_CTA` env override.** Setting `WEBHANDS_CTA=1` forces the CTA hints back ON without a per-call flag (a user can pin their preferred default once). Precedence: `--cta`/`--hints` flag > `WEBHANDS_CTA` env > built-in default (off). Exported as `CTA_ENV_VAR` from the package.
- **The skill is now the full verb reference.** `skills/use-webhands/SKILL.md` (and the inlined eval skilled/script-forward preambles) describe WHAT EACH VERB DOES + its must-know argument forms, including the `page.`-prefixed locator grammar, name the canonical `npx webhands <verb>` invocation up front, and state plainly that the agent need NOT run `--help`/`--llms-full` at runtime. The inlined preambles stay no-priming-clean (`assertSkilledReferenceUnprimed`: no selector-shaped fragment, no site URL), so the per-verb examples are generic, not site selectors.
- **A `webhands-cold-cta` eval agent kind** (eval harness, non-gating) reproduces the pre-flip cold baseline: the SAME cold preamble plus `WEBHANDS_CTA=1` pinned in the agent env, so the original four-way scoreboard numbers stay live and reproducible and `cold-cta - cold` isolates the CTA cost.

No new verb is added.
