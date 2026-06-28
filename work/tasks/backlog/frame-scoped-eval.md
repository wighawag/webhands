---
title: Tier-3 frame-scoped `eval` (same-origin child frames only)
slug: frame-scoped-eval
prd: broaden-agent-verb-surface
blockedBy: [rich-input-verbs]
covers: [13]
---

## What to build

Extend the `eval` verb so it can run a JS expression in a NAMED same-origin child
frame, closing the last same-origin papercut for code that genuinely needs to RUN
logic in the frame (e.g. fire a captcha `data-callback`, read a runtime-only JS
value) rather than just read or act on an element. This is the ONE place a
`frame?` qualifier is unavoidable (R1): `eval` runs page-world JS and CANNOT carry
a `frameLocator` (the spike confirmed `ReferenceError: p is not defined`), so it
needs an explicit frame selector the transport resolves to a same-origin frame and
evaluates in.

- `eval(expression, {frame?})` / CLI `eval <expr> [--frame <selector>]`. `frame`
  is a transport-neutral STRING (a CSS selector for the iframe element, or a frame
  name/url fragment) — NEVER a Playwright `Frame` handle (ADR-0003).
- `frame` omitted == today's top-document `eval` (backward compatible).
- The result crosses the seam by the SAME structured-clone contract `eval`
  already has (no Playwright/CDP type leak).
- A CROSS-ORIGIN frame selector fails LOUD with a typed "cross-origin frame is
  unreachable" error (page-world JS cannot cross a security boundary) — never a
  silent empty. (Cross-origin is reachable only by the Tier-4 frameLocator/
  coordinate ops, a different task.)
- Resolve the frame through the SINGLE existing frame-resolution helper (the one
  that already turns a same-origin `frameLocator(...)` into a live frame for
  `click`/`type`) so there is no second frame-addressing path (R1).

## Acceptance criteria

- [ ] `eval` with no `frame` behaves EXACTLY as today (backward compatible).
- [ ] `eval` with a `frame` selector evaluates the expression in the named
      SAME-ORIGIN child frame and returns its value by structured clone (e.g.
      reads a value only present in the child frame; fires a child-frame callback
      and the effect is observable).
- [ ] A cross-origin `frame` selector throws a typed, clear "cross-origin frame
      unreachable" error — never a silent empty result.
- [ ] `frame` is a plain string on the seam; no Playwright `Frame`/CDP type
      crosses (ADR-0003). The same-origin frame resolves through the existing
      single frame-resolution helper.
- [ ] Available over CLI (`--frame <selector>`) AND MCP from one incur definition.
- [ ] Tests cover the same-origin success, the backward-compatible top-frame
      default, and the cross-origin loud-error, as real-browser + local fixture
      seam tests (mirror the repo style); reuse / extend the same-origin
      nested-frame fixture.
- [ ] Shared-write isolation: profile paths point at per-test temp dirs; the real
      `~/.webhands` is asserted untouched.
- [ ] A changeset is added (`pnpm changeset`).

## Blocked by

- `rich-input-verbs` — serialized after the verb-adding tasks (it edits the same
  shared files: the `eval` seam method, the eval hand, the RPC dispatch + client,
  the CLI `eval` command), so it follows them to avoid a merge conflict.

## Prompt

> Goal: add an optional same-origin `frame` qualifier to the `eval` verb so an
> agent can RUN logic inside a named same-origin child frame (e.g. fire a captcha
> callback), the only `frame?` qualifier on the surface. Deliverable from the prd
> `work/prds/tasked/broaden-agent-verb-surface.md` (User Story 13; ## Resolved
> decisions R1) and the idea `work/notes/ideas/frame-scoped-eval-verb.md`.
>
> READ FIRST: `work/notes/findings/click-and-type-already-frame-scoped-via-framelocator.md`
> — it proved that locator-taking verbs already reach same-origin frames via a
> `frameLocator(...)` expression, so they need NO `frame?` qualifier; `eval` is the
> exception because it runs page-world JS and CANNOT carry a `frameLocator` (the
> spike got `ReferenceError: p is not defined`). That is why ONLY `eval` gets a
> `frame?`.
>
> CHECK REALITY: the verb-adding tasks before this one (`query-and-state-verbs`,
> `rich-input-verbs`) landed and touch the same files; build on the single
> frame-resolution helper they/`click`/`type` use rather than adding a parallel
> one (R1). If a seam landed differently, route to needs-attention.
>
> Domain vocabulary: the **seam** carries NO Playwright/CDP types (ADR-0003), so
> `frame` is a transport-neutral STRING (iframe selector / frame name|url
> fragment), never a Playwright `Frame`. `eval` already structurally clones its
> result out by value — keep that contract. SAME-ORIGIN only: a cross-origin frame
> is a browser security boundary page-world JS cannot cross, so a cross-origin
> selector must fail LOUD (typed error), not silently. (Cross-origin reach is the
> Tier-4 frameLocator/coordinate task, not this one.)
>
> What "done" means: `eval` with no frame is unchanged; with a same-origin frame
> it evaluates there and returns by structured clone; a cross-origin frame throws a
> clear typed error; the frame resolves through the existing single helper; CLI
> `--frame` + MCP both work; real-browser fixture tests cover success, default, and
> the cross-origin error; profile paths isolated to temp; a changeset added.
