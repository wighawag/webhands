---
title: The `launch` command's connection options (--profile/--headed, and now --stealth/--use-system-browser) are consumed by `serve`, not by `launch` itself
slug: launch-command-connection-options-vestigial-vs-serve
type: observation
status: spotted
spotted: 2026-06-28
---

## What was spotted

While wiring the opt-in stealth launch (`--stealth` / `--use-system-browser`)
onto the CLI, the `launch` command's existing `--profile` / `--headed` options
turn out to be effectively **vestigial in the running-server lifecycle**
(ADR-0005), and the new stealth flags inherit the same property.

The mechanics, traced in `packages/cli/src`:

- `launch` (`cli.ts`, the `cli.command('launch', ...)` block) builds an
  `OpenTarget` `{mode:'launch', profile, headed}` and passes it to
  `withSession(provider, target, ...)`.
- The DEFAULT provider is the thin client
  (`session-provider.ts` `createDefaultSessionProvider`), which **intentionally
  ignores the `OpenTarget`** (`_target`) and just connects to whatever the
  long-lived `serve` process already brought up; if no server is live it throws
  `NoLiveServerError` ("run `serve` first"). Its own docstring says the target is
  "intentionally IGNORED for discovery ... which browser to launch ... was
  decided once, by the `serve` command."
- The ONLY place a browser is genuinely launched is `serve`
  (`defaultServeSession` -> `new PlaywrightLaunchTransport(...)`), which is where
  the connection options actually take effect. The wiring test confirms this:
  `wiring.test.ts` asserts the consumed target `{mode:'launch', profile:'work',
  headed:false}` came through the **serve** path (around the
  "`serve` consumed the connection options to choose the launch target" assertion).

So in production, `webhands launch --profile X --headed` does NOT spawn an X /
headed browser; it connects to the session `serve` already holds. `launch` is
not dead (it has tests, a cta chain setup-profile -> launch -> goto, and typed
error mappings), but its connection options are decorative against a running
server.

## Why it matters

- It is a **docs/UX drift risk**: a user reasonably expects `launch --headed`
  to open a visible browser; against a running server it does not.
- It shaped a stealth-task decision: `--stealth` / `--use-system-browser` were
  added to BOTH `serve` and `launch` for surface symmetry with the existing
  `--profile`/`--headed`, but they are only EFFECTIVE via `serve`. Rather than
  introduce a fourth flag with the same gap silently, this note records the gap.

## Possible follow-ups (NOT done here; out of scope for the stealth task)

1. Remove the connection options from `launch` (and the verb commands) and let
   ONLY `serve` carry them, making the surface honest about where the open is
   decided. This is a public-CLI-surface change and would touch the
   setup-profile cta ("`webhands launch --profile default`") and several wiring
   tests, so it deserves its own task/decision, not a drive-by edit.
2. OR make `launch` genuinely spawn when no server is live (contradicts ADR-0005
   "lifecycle is EXPLICIT; serve is the ONE place a browser is launched" — would
   need an ADR).
3. OR keep as-is but document clearly that connection options are consumed by
   `serve`.

Captured rather than acted on, to keep the stealth change scoped (AGENTS.md:
do not entangle unrelated changes).
