---
title: 'Branded Chrome 156 ignores --load-extension and drops CDP-loaded extensions; only a UI "Load unpacked" persists. Chromium and Chrome for Testing honour the flag.'
slug: branded-chrome-extension-install-paths
type: finding
status: verified
created: 2026-10-25
source: 'Spikes on telemaque (NixOS) on 25 Oct 2026, under Xvfb, each with a fresh --user-data-dir unless noted: Google Chrome 156.0.8078.47 (nixpkgs), Chromium 152.0.7977.82 (nixpkgs), Chrome for Testing 151.0.7922.34 (Playwright 1.61.1 pinned build). A minimal MV3 extension whose service worker opens a WebSocket to a local server was the probe: a "hello" frame means the extension loaded and ran. The spike scripts lived in /tmp and are not committed; the transport test suite (`packages/core/test/extension-transport.test.ts`) re-checks the Chrome for Testing half on every run.'
---

## What was measured

1. **`--load-extension=<dir>`**: Chromium 152 loaded it and connected. Google Chrome 156 ignored it silently, with no error on stderr, and adding `--disable-features=DisableLoadExtensionCommandLineSwitch` (the documented escape for Chrome 137 to 141) changed nothing. Chrome for Testing honours it, which is what the transport's own test uses.
2. **CDP `Extensions.loadUnpacked`** (Chrome 156, launched by Playwright with `--enable-unsafe-extension-debugging`, `--disable-extensions` removed from the defaults): it returned the id and the extension appeared in `Preferences`. At the next PLAIN start (no debugging flag) Chrome removed it from the profile. Turning Developer mode on first, in the same session, did not help.
3. **Per-profile `External Extensions/<id>.json`** pointing at a CRX packed with `--pack-extension`: not installed (no entry in `Preferences` or `Secure Preferences`) after a plain start.
4. **A UI "Load unpacked"** (`chrome://extensions`, Developer mode on, the GTK folder chooser): installed, and still loaded and connected after a clean restart with no flags. Chrome reads the files from that path at each start, so a stable directory whose contents are rewritten per session works.
5. **`chrome://extensions` passed as a command-line URL** opened a New Tab page instead (chrome:// URLs from the command line are not honoured), so the one-time step cannot be pre-navigated that way.
6. **Content-script mechanics (Chromium 152 and Chrome 156):** Playwright's `InjectedScript` source, extracted from `playwright-core/lib/coreBundle.js` and run as a static content script, constructs without `eval` and resolves `internal:role=...` selectors; `ariaSnapshot(body, {mode: 'ai'})` produced the usual `[ref=eN]` YAML. `chrome.runtime.getFrameId` is `undefined` in Chrome content scripts (it is a Firefox API). An `xdotool` click produced `event.isTrusted === true` in the top document, and `navigator.webdriver` read `false`. (Inside a CROSS-ORIGIN iframe it is `true` as well, checked by the transport test on Chrome for Testing.)
7. **Device scale under a default Xvfb** was `devicePixelRatio = 1.046875` (Chrome derives it from the X server's DPI). Starting Xvfb with `-dpi 96` gives 1.
8. **A stale service worker survives a file change** (Chrome 156, UI-installed unpacked extension): after `sw.js` was rewritten on disk and the manifest version bumped, the restarted browser still ran the OLD worker (Chrome's `Service Worker/ScriptCache` in the profile held it). Writing the worker under a new file name fixed it.
9. **Nothing starts an MV3 worker at browser start** on its own: with only `about:blank` open (no content script runs there), the worker stayed "Inactive" and never connected. A real http page whose content script messages the worker wakes it.

## What it means

- The default browser for the extension transport is Playwright's pinned Chrome for Testing (no install step). Branded Chrome needs a human "Load unpacked" once per profile; nothing a program can do without root (enterprise policy) replaces it.
- Frame addressing in Chrome needs a nonce probe through `postMessage`, consumed by the child's content script, because `getFrameId` does not exist there.
- Write the extension's scripts under content-hashed names, and open the browser on a page that wakes the worker.
- Run the transport's Xvfb at `-dpi 96`, and verify coordinates from a trusted `mousemove` anyway.
