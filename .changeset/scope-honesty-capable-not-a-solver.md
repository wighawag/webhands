---
'webhands': patch
---

Update the scope/positioning prose to be honest about the broadened verb surface: "capable, not a solver" (the "broaden the agent verb surface" prd, stories 15-16). webhands still ships NO captcha solver and NO provider key and still relies on the human one-time login/challenge-clear in `setup-profile`, but the verb surface is now rich enough that it no longer STANDS IN THE WAY of a capable agent that brings its OWN key.

- README.md's *Scope and honesty* bullet now reads "No login-bypass, no built-in CAPTCHA solver" and states the precise line: we do not solve it, we no longer stand in the way. It names both proven families (token-harvest via frame-aware `query` + `type` + callback; vision/tile via the Tier-4 `mouse`/`screenshot`/cross-origin read) and adds a bullet reaffirming the **hand** tier (`iamhuman` today) as the SIMPLER one-call path that coexists with the unaided verbs-only path.
- CONTEXT.md gains a *Scope and honesty (capable, not a solver)* section carrying the same line in the domain vocabulary, and its verb-list framing is refreshed to the verbs that actually shipped (Tier-1 reads + Tier-2/4 input/coordinate verbs).
- The bundled `use-webhands` skill's "does not solve CAPTCHAs" line is updated consistently: the human-in-the-loop path stays the default for an ordinary wall, but a capable agent with its own key can self-solve with verbs (the exact `query`/`screenshot`/`mouse` commands), and a hand makes it one call.

Docs/skill only: no product code changed, no overclaim (webhands ships no solver/key). The personal-use / own-session / own-IP framing and the `serve`-endpoint security note are preserved.
