---
title: incur CLI wiring — verbs, structured output, cta, MCP/skills, clear errors
slug: cli-incur-wiring-and-errors
prd: browser-controller-cli
blockedBy: [scaffold-monorepo-and-driver-seam, playwright-launch-transport-and-profile, attach-transport-cdp-chromium, setup-profile-headed-login]
covers: [12, 13, 14, 17]
---

## What to build

The `cli` package: wrap `core` with `incur`
(`Cli.create('webhands', …).command(…).serve()`), one command per
verb plus `setup-profile` / `launch` / `attach`, each with a zod `args`/`options`/
`output` schema. Because it is built on `incur`, the same binary is also an MCP
server (`--mcp` / `mcp add`) and emits a skills / `--llms` manifest with NO
bespoke MCP code (see prd). Add `cta` (call-to-action) hints suggesting likely next
verbs after each run (e.g. navigate → snapshot → click), and **clear, actionable
errors**: when a browser binary is missing or a profile is not set up, the message
names the EXACT command to fix it.

A thin vertical slice: the CLI exposes the verb commands with declared schemas and
a structured output envelope; an automated test asserts the incur wiring — schemas
present, output envelope shape, MCP/`--llms` manifest present, and the
missing-binary / missing-profile errors carry the fix command.

## Acceptance criteria

- [ ] The `cli` package builds an `incur` CLI binding one command per verb plus `setup-profile`/`launch`/`attach`, each with a zod `args`/`options`/`output` schema.
- [ ] Command output is the incur structured (TOON/JSON) envelope with a declared output schema (story 12).
- [ ] `cta` hints suggest likely next verbs after a run (story 13).
- [ ] The binary is registerable as an MCP server (`--mcp` / `mcp add`) and emits a skills / `--llms` manifest — no bespoke MCP code (story 14).
- [ ] Missing-browser-binary and not-set-up-profile errors are clear and name the EXACT command to fix them (story 17). The CLI maps the TYPED missing-binary / missing-profile conditions raised by `core` (owned by `playwright-launch-transport-and-profile`) into the user-facing message + exact fix command; if those typed conditions did not land as assumed, reconcile or route to needs-attention rather than re-detecting in the CLI.
- [ ] CLI-level tests assert the incur wiring (schemas, output envelope, MCP/`--llms` manifest presence) and the actionable error messages — they do NOT re-assert verb behaviour (that is covered at the `core` seam).
- [ ] A changeset is added.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style).

## Blocked by

- `scaffold-monorepo-and-driver-seam` (the `cli` package + the `core` verb interface to bind to).
- `playwright-launch-transport-and-profile`, `attach-transport-cdp-chromium`, `setup-profile-headed-login` (so the `launch`/`attach`/`setup-profile` commands bind to real `open` paths). The page verbs are bound to the `core` verb surface defined in the scaffold and need not all have landed.

## Prompt

> Goal: build the `cli` package that wraps `core` with `incur`. Read the prd
> `work/prds/ready/browser-controller-cli.md` (User Stories 12, 13, 14, 17;
> Implementation Decisions — `cli`; Testing Decisions — CLI tests assert incur
> wiring) and `CONTEXT.md` (`incur`, `verb`). The incur API is
> `Cli.create()/.command()/.serve()` with `mcp add`, `skills add`, `--llms`,
> `--mcp`, TOON output, zod schemas, `cta`, middleware, `cli.fetch`
> (https://github.com/wevm/incur).
>
> Bind ONE command per verb (`goto`, `snapshot`, `click`, `type`, `eval`, `wait`,
> `cookies`) plus `setup-profile`/`launch`/`attach`, each with zod args/options/
> output schemas. MCP + skills + `--llms` come from incur for free — write NO
> bespoke MCP code. Add `cta` next-verb hints. Make missing-binary and
> missing-profile errors name the exact fix command.
>
> Depends on the scaffold (cli package + the core verb interface) and the two
> transports + setup-profile (so the mode commands have real `open` paths). The
> page-verb commands bind to the `core` verb surface from the scaffold; their
> behaviour is tested at the `core` seam, so CLI tests assert WIRING only
> (schemas, envelope, manifest, error text) — do not duplicate verb-behaviour tests.
>
> "Done" = the binary runs the verbs with structured output + cta, registers as an
> MCP server and emits a skills/`--llms` manifest, gives actionable missing-binary/
> missing-profile errors, and CLI tests assert the wiring.
>
> FIRST, check this task against current reality — confirm the core verb surface and
> transports landed as assumed; if a dependency differs, reconcile or route to
> needs-attention. RECORD non-obvious in-scope decisions (e.g. cta wording, exact
> error/exit-code scheme).
