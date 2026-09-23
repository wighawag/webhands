---
'webhands': patch
'@webhands/core': patch
---

**A headed launch with no X display is now a typed `missing-display` error naming the fix, instead of Playwright's ASCII box.**

On any server, container or CI runner, `setup-profile` (headed by definition) and `serve --headed` failed with a message whose FIRST line says the browser "has been closed", with the real explanation buried in attached browser logs as a drawn box suggesting `xvfb-run`. That reads as a crash, and it names a tool the reader has to already know to reach for. An agent driving webhands cannot act on it at all.

It is now `code: missing-display` with the three ways out, ordered by what the user is actually doing: `xvfb-run -a <the same command>` for a throwaway virtual display when nothing needs to be seen, a headless `serve` when only the page was wanted, or a real display over `ssh -X` / VNC when a HUMAN is the point. The message says "use a headless serve" rather than "drop `--headed`", because this fires for `setup-profile` too, which has no such flag to drop.

Also in this release: the repo's own test suite stops depending on the caller knowing the incantation. `@webhands/core`'s `test` script runs through `scripts/with-display.mjs`, which supplies `xvfb-run -a` when the box is Linux with no `DISPLAY`, steps aside when a display exists (including CI's outer `xvfb-run`, so nothing nests), and on a box with neither prints one actionable line instead of letting six browser tests produce walls of Playwright output. Wrapping rather than spawning an X server from a test hook is deliberate: it makes `xvfb-run` the parent of the test process, so its own cleanup kills the server however the run ends.
