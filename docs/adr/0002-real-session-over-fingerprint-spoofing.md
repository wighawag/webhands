# Operate a real browser/profile/IP instead of spoofing or cookie-replay

Access to anti-bot-protected sites (Kayak, Skyscanner) is gained by driving a *real* browser the user logged into once, on their own machine and IP, not by copying a cookie into an HTTP client nor by fingerprint-spoofing a headless browser. We chose this because anti-bot clearance is bound to a TLS/browser fingerprint plus IP reputation, not just the cookie, so a replayed cookie reads as stolen and re-challenges; and a real session has no automation fingerprint to spoof. A dedicated persistent profile (logged in via the headed `setup-profile` step) carries the clearance durably, and `connectOverCDP` attach reuses the user's live context. Note the classic CDP "console getter" detection broke in V8 in May 2025, so CDP-attach is currently low-risk, though multi-layer detection (behaviour, IP, fingerprint) still exists, which is why the stronger-stealth extension transport (ADR-0003) is kept as a future path.

## Consequences

- We never point at the OS default Chrome profile (Chrome policy refuses to automate it); the controller owns a dedicated user-data dir.
- The human does the one-time login / challenge clearance; we never try to bypass login or solve CAPTCHAs programmatically.
- This is personal-use of one's own authenticated session and is against these sites' ToS; scope is deliberately local and single-session.
