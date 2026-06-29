---
'@webhands/core': patch
'webhands': patch
---

Let `serve` expose a Chromium CDP / remote-debugging endpoint for its launch session, so a separate Playwright client can `connectOverCDP` and drive the SAME live page the server holds (a shared driving surface). This is opt-in on the launch transport and surfaced through the existing session-endpoint discovery channel; it adds no new verb and changes nothing on the verb seam (the endpoint is a plain loopback URL string, like the attach endpoint).

- `@webhands/core`: `PlaywrightLaunchTransport` gains an opt-in `exposeCdp` construction option. When set, it launches Chromium with `--remote-debugging-port=0`, resolves the OS-assigned port from the `DevToolsActivePort` file (the same mechanism the attach transport's tests use), and exposes the resulting `http://127.0.0.1:<port>` endpoint via a new `cdpEndpoint()` accessor on the concrete transport (never on the `Transport`/`Session` seam, so ADR-0003 holds). `SessionEndpoint` gains an optional `cdpEndpoint` field, and `startSessionServer` folds a resolver's value into the advertised endpoint (and the on-disk endpoint file) so client/tool discovery can find the shared surface. The CDP port binds to loopback only, like the serve RPC endpoint.
- `webhands`: the `serve` command always exposes the CDP endpoint for a launch session (an `attach` session has no harness-owned debugging port, so none is advertised there) and surfaces it in the `serve` output as `cdpEndpoint`.

This makes the eval harness's Playwright-only baseline measurable: the baseline agent connects its Playwright to the harness's served browser over CDP and drives the harness's existing page, so the harness reads the page the agent actually drove and scores a genuine completion as PASS (it previously scored a false FAIL because the agent drove its own separate browser).
