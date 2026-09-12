---
'webhands': minor
---

Ship the `use-webhands` skill inside the published package, and stop flooding the skill list.

`webhands skills add` advertised installing a skill the package did not contain. The tarball carried no skill at all (`files` was `dist`/`src`/`README.md`/`LICENSE`, and the skill was authored at the monorepo root, outside the published package), and the CLI passed no `sync` option to `incur`, so the command had no hand-authored skill to install in the first place. `README.md` has been telling users to "install the bundled skill" the whole time. Consumers worked around it by symlinking the skill out of a git CHECKOUT, which is mutable and unversioned: it describes whatever branch that clone sits on rather than the installed binary, and it cannot be linked from a store path beside the binary on Nix.

- The skill now lives at `skills/use-webhands/SKILL.md` INSIDE the package and is listed in `files`, so `npm pack` carries it. Top-level `skills/`, not `dist/skills/`: it is hand-authored source, and `dist/` is tsc output wiped on every build.
- `skills add` and `skills list` resolve it from the MODULE's own location, not the caller's cwd, so a bare `npx webhands skills add` from any directory installs it with no clone present. (`incur` defaults `sync()` to a walked-up package root but `list()` to `process.cwd()`; passing an explicit `cwd` stops the two commands disagreeing about which skills exist.)
- Generated per-verb skills are collapsed into ONE `webhands` command reference (`depth: 0`) instead of 26. They were near-duplicates of a reference `use-webhands` already carries in full, and they buried it. `skills add` now installs exactly two skills.

The README now also documents LINKING the skill straight out of the installed package instead of syncing it (the read-only, version-pinned path for Nix and other declarative setups), including the clash: `skills add` clears its destination before writing, so running it after linking replaces the symlink with a mutable copy. Only `use-webhands` can be linked — the generated reference is rendered at sync time and has no file to point at.

The skill's content needed no change: it already addressed a reader who has the CLI installed and invokes it as `npx webhands <verb>`.
