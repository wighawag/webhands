---
'webhands': patch
---

Docs: make the README friendlier to newcomers and lead the capability scoreboard with the latest results.

- **README intro rewritten for newcomers.** A one-line hook ("let your AI agent drive a real, logged-in browser on your own machine"), a plain-language "log in once, then your agent acts" framing, and a "New here? Jump to" nav pointing at the quickstart, the scoreboard, and the scope/honesty section.
- **README scoreboard section reframed around how webhands COMPETES with Playwright.** It now leads with a three-row "kind of flow" table (messy DOM: webhands wins; dynamic goal: tie; trivial scriptable flow: Playwright cheaper) and links to the scoreboard's new latest-first summary, instead of only saying "raw Playwright is currently cheaper".
- **`evals/SCOREBOARD.md` now shows the latest, most representative results FIRST.** A new "Latest results first (the short answer)" section at the top surfaces the two most recent fair head-to-heads (tier-3 messy DOM and the dynamic read-decide loop) where webhands matches or beats raw Playwright on both outcome and tokens. The detailed chronological lab notebook is unchanged below, with a pointer from the older simple-flow "how to read it" section back to the summary.

No package behavior changes.
