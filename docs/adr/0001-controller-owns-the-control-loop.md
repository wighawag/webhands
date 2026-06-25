# The CLI controller owns the long-lived control loop; the browser is attached to

The controller (the `core`/CLI process) holds the persistent control loop and connection, and the browser is the thing it launches or attaches to, rather than a browser extension driving everything and calling out to the CLI. We chose this because Manifest V3 extension service workers are killed on a 30-second idle / 5-minute hard limit and lose all in-memory state and sockets, so an extension is an unreliable place to hold a long-running session; a CLI process has no such lifecycle constraint. The extension is therefore demoted to a future *transport* (a stealthier content-script bridge the controller attaches to), not the foundation.

## Considered Options

- **Extension-driven (rejected):** a Chrome/Firefox content script holds the loop and pushes results to the CLI over a WebSocket/native-messaging bridge. Best stealth, but the MV3 service-worker death (and the sawtooth WebSocket disconnects) make a long-lived loop fragile; native-messaging ports are still bound to the dying service worker.
- **Controller-owns-loop (chosen):** CLI drives Playwright and attaches to a real browser; extension becomes an optional transport behind the seam (ADR-0003).
