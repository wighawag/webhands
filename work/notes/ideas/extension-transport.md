---
title: Browser-extension transport (content-script bridge), the phase-2 stealth path
slug: extension-transport
---

## The idea

Add a second concrete `Transport` behind the existing seam: a **browser-extension
content-script bridge**. A Chrome/Firefox extension content-script reads and
drives the page from INSIDE the page (no `connectOverCDP`, no automation
fingerprint), bridged back to the long-lived controller (the `serve` process,
ADR-0005) over a small message channel. It implements the SAME verb surface
(`goto`, `snapshot`, `click`, `type`, `eval`, `wait`, `cookies`) as the v1
Playwright transport, so nothing above the seam changes.

This is the **phase-2 stealth fallback** named in `CONTEXT.md` ("extension
transport (deferred)") and the PRD Out of Scope. It is explicitly captured here so
it survives to a future tasking pass rather than being lost.

## Why (motivation)

- v1 leans on being a real browser/profile/IP (ADR-0002). That defeats most
  detection today, and the classic CDP "console getter" leak broke in V8
  (May 2025), so CDP-attach is currently low-risk. But multi-layer detection
  (behaviour, IP, fingerprint, residual CDP signals) still exists.
- A content-script that lives in a normal extension has **zero automation
  fingerprint**: to the page it is indistinguishable from the user's own browser,
  because it IS the user's own browser. This is the strongest-stealth path when a
  site escalates detection beyond what the real-session posture clears.

## Constraints / design notes (the capability floor)

- **Designed-for, not built in v1.** The transport seam (ADR-0003) was built so
  this can slot in WITHOUT changing the verb surface. The seam must not leak
  CDP/Chromium-only types. That rule already protects this future transport.
- **Must offer Playwright-equivalent element addressing.** ADR-0004 sets the
  capability floor: verbs take a raw Playwright locator string, so to qualify as a
  drop-in fallback the extension transport must resolve the SAME locator semantics
  inside the content-script (role/name/text/CSS/xpath addressing), not a reduced
  selector subset. This is the hard part and should be scoped explicitly when
  tasked.
- **MV3 service-worker lifetime is exactly why the controller owns the loop**
  (ADR-0001): the extension is only the page-side transport; the long-lived
  control loop stays in the `serve` process, with the content-script as a thin
  bridge. Do not try to host the loop in the extension.
- **Bridge channel.** Needs a defined message protocol between the content-script
  and the controller (native messaging host, a local WS, or reuse of the existing
  `serve` endpoint). Same code-execution-surface caution as v1: the channel must
  stay local/trusted (see the README security note).
- **Cross-browser.** Should be designed so a Firefox variant is possible (ADR-0003
  already forbids CDP assumptions), even if the first build targets Chrome.

## Scope when tasked

A future PRD/task should cover: the extension manifest + content-script, the
bridge protocol, the `Transport` adapter implementing the verb surface via the
bridge, locator-resolution parity with Playwright (the floor above), and how the
controller selects this transport vs the Playwright one. Out of scope for the
idea itself; this note just keeps the phase-2 path from being lost.
