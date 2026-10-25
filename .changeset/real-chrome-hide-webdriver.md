---
'@webhands/core': minor
'webhands': minor
---

Add `serve --real-chrome --hide-webdriver` (opt-in): the spawned Chrome gets `--disable-blink-features=AutomationControlled`, so pages read `navigator.webdriver === false` while webhands still drives over CDP, with every verb, `script` and hands. Measured on Luma: Cloudflare Turnstile refused `--real-chrome` with the bit on and passed it with the bit off, both at sign-in and on an action-level re-check. Chrome shows an "unsupported command-line flag" bar in this mode, and the flag hides only that one signal (use `--transport extension` against a check that detects CDP itself). Reusing a running browser that still reports `navigator.webdriver` is refused (`real-chrome-reuse-conflict`) rather than silently showing the bit, and the flag warns when used without `--real-chrome`.
