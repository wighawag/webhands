---
'webhands': minor
'@webhands/core': minor
---

**BREAKING for anyone relying on `serve` advertising a `cdpEndpoint` by default: pass `--expose-cdp` to restore it.**

**`serve` no longer opens a remote-debugging port unless asked.** CDP exposure was hard-coded ON in the `serve` wiring, so every launch appended `--remote-debugging-port=0`: a code-execution surface on your logged-in page AND an automation tell that anti-bot WAFs look for, added even under `--stealth`, where it partly undoes what Patchright is there for. It is now the opt-in `--expose-cdp` (default OFF), and `serve` reports a warning in its output envelope (not just stderr, so an agent caller sees it too) when `--stealth --expose-cdp` are combined. `cdpEndpoint` is present in the `serve` output only when exposed. The eval harness, which needs the shared driving surface for its Playwright-baseline leg, now asks for it explicitly.

**`setup-profile` accepts the same browser-selection flags as `launch`/`serve`** (`--stealth`, `--use-system-browser`, `--proxy`, `--no-viewport`), where it used to reject them as "Unknown flag". That mattered because `setup-profile` is what CREATES the profile directory, and a Chromium user-data dir is written by a specific browser build: setting a profile up with the bundled Chromium and then driving it with `serve --use-system-browser chrome` points a different build at the same dir, which is both a fingerprint discrepancy and a real risk of Chrome migrating or refusing a profile another build wrote. `core`'s `setupProfile` takes the policy as a `launch` option, and the verb now reports the `systemBrowser`/`stealth` it set the profile up with (and carries that selection into its suggested next command).

README's stealth guidance is corrected with measured evidence: against Akamai Bot Manager, a Playwright-launched browser was blocked identically with default launch, `--stealth`, `--stealth --use-system-browser chrome` and a fresh profile, while attaching to a user-started Chrome drove a nine-screen authenticated flow. `--stealth` is one tell removed, not the anti-bot answer.
