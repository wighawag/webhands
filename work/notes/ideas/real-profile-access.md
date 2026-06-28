
---
title: Allow webhands to control a real user profile
slug: real-profile-access
type: idea
status: incubating
created: 2026-06-28
---

## The prompt

```
Add the ability to launch webhands against an EXPLICIT browser profile directory (an arbitrary user_data_dir), in addition to the existing named-profile-under-~/.webhands flow. This lets an operator drive a
 copy of their real Chrome profile, which is decisive for diagnosing anti-bot blocks that only happen on thin/cold profiles. Work in /home/wighawag/dev/github/wighawag/webhands.

 CONTEXT: today resolveProfileLocation(profile, options) in packages/core/src/profile-location.ts always resolves <homeRoot>/profiles/<name>; PlaywrightLaunchTransport.open launches
 launchPersistentContext(loc.profileDir, ...) and throws MissingProfileError if that dir is absent. There is no way to point at an arbitrary dir.

 REQUIREMENTS:
 1. Add an explicit-profile-dir path WITHOUT breaking the named-profile flow. Preferred: extend the LAUNCH OpenTarget with an optional profileDir?: string that, when set, is used VERBATIM as the user_data_dir
    and bypasses resolveProfileLocation/the ~/.webhands naming. Keep OpenTarget free of Playwright/CDP TYPES (a plain string path is fine; it is not a Playwright type). If you'd rather keep OpenTarget minimal,
    put it on PlaywrightLaunchTransportOptions instead and justify the choice.
 2. Safety: when an explicit profileDir is given and does NOT exist, still throw the typed MissingProfileError (never silently create an arbitrary dir, mirroring the current contract). Do NOT auto-create it
    (setup-profile owns creation for the managed flow).
 3. Loud warning in docs/comments: launching automation against a COPY of a real profile is fine; launching against the user's LIVE, in-use Chrome profile dir causes profile-lock corruption and risks burning
    that profile's reputation. The feature should make copying the recommended path, not point at the live dir.
 4. CLI: add --profile-dir <path> to the launch/serve options (packages/cli/src/cli.ts), mutually-informative with --profile (explicit dir wins; document precedence). Keep the existing targetFrom/launch wiring.
 5. Keep everything else intact (stealth, systemBrowser, attach transport untouched).

 TESTS (existing style + isolation, fake launcher spy, no real browser):
 - explicit profileDir is passed verbatim to launchPersistentContext (not the ~/.webhands path).
 - a missing explicit profileDir throws MissingProfileError and does not create the dir.
 - named-profile flow still resolves under the temp home root unchanged.
 - CLI --profile-dir flows through to the launch target/options with the documented precedence over --profile.
 - NO real-browser / live tests.

 DELIVERABLES: core change, CLI flag, tests, a changeset (minor). Follow AGENTS.md. Check git status first; stop if dirty. Do NOT commit/push unless asked. typecheck + build + tests green.
 ```