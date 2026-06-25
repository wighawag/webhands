# Manual smoke test: end-to-end pipe against Kayak

This is a **manual, live, flaky** smoke test. It is NOT a CI gate and is NOT run
by `pnpm test` / the `verify` step. It exists so a human can prove the whole pipe
works end to end against a real anti-bot-protected site, exactly once when they
want reassurance, not on every change.

## Why it is manual (and stays out of CI)

- It hits a **live third-party site** (Kayak) whose DOM, anti-bot challenges, and
  availability change without notice. Asserting on its markup would rot the suite
  (PRD Testing Decisions).
- It requires a **headed human login** in `setup-profile` (and possibly clearing
  a challenge), which CI cannot do.
- Kayak is the smoke TARGET, not a feature. Automated behaviour coverage lives at
  the `core` Driver seam against a deterministic LOCAL fixture page; only this
  manual proof uses a real site.

Driving Kayak is generally against its Terms of Service. Run this only against
your OWN session on your OWN machine and IP, for personal verification. See the
scope/honesty note in [`../README.md`](../README.md) and
[`adr/0002`](adr/0002-real-session-over-fingerprint-spoofing.md).

## Prerequisites

- The monorepo is built: `pnpm install && pnpm build`.
- A Playwright Chromium binary is installed. If a run reports a missing browser,
  the error names the exact command (e.g. `npx playwright install chromium`).
- Invoke the CLI however you run it locally. Below it is written as
  `my-browser-controller`; from the repo you can also use
  `node packages/cli/dist/bin.js` (or `pnpm --filter my-browser-controller exec
  my-browser-controller`).

## The pipe (landed shape, per ADR-0005)

The browser is owned by ONE long-lived `serve` process; `goto` / `snapshot` are
thin clients that drive the SAME live page. So the smoke is:
`setup-profile` (headed login once) -> `serve --headless` (hold the session) ->
`goto` a search -> `snapshot` the results -> `stop`.

> Note: the originating task phrased this as "setup-profile -> launch --headless
> -> goto -> snapshot". That phrasing predates ADR-0005. The session that
> persists across separate CLI invocations is held by `serve`, not by `launch`
> (a bare `launch` opens and closes within one invocation and does not keep a
> session alive for later verbs). The steps below use the landed `serve` verb so
> the cross-invocation pipe is actually exercised.

## Steps

1. **One-time headed login.** Open the dedicated profile in a visible browser and
   log in to Kayak (and clear any anti-bot challenge) if/as needed:

   ```sh
   my-browser-controller setup-profile
   ```

   This saves cookies/state under the dedicated profile dir. You only do this
   once per profile; later headless runs reuse it.

2. **Bring the session up headless.** In one terminal, start the long-lived
   server against the saved profile and leave it running:

   ```sh
   my-browser-controller serve --headless
   ```

   It prints the endpoint URL and PID, and runs until you `stop` it (or Ctrl-C).
   Keep the endpoint LOCAL; do not expose it (it is a code-execution surface, see
   the README security note).

3. **Navigate to a search (separate invocation).** In a second terminal, drive
   the live page to a Kayak search URL. Use any flight search URL you like; for
   example a one-way route on a near-future date:

   ```sh
   my-browser-controller goto 'https://www.kayak.com/flights/LON-NYC/2026-09-15?sort=bestflight_a'
   ```

   You may need to pace the XHR-rendered results, e.g.
   `my-browser-controller wait --ms 8000` (or `wait --navigation`).

4. **Snapshot the results (separate invocation).** Read the rendered page as a
   token-cheap accessibility-tree + text view:

   ```sh
   my-browser-controller snapshot
   ```

5. **Tear down.**

   ```sh
   my-browser-controller stop
   ```

## What counts as a pass

This is a human eyeball check, NOT an automated assertion:

- `serve` came up and printed an endpoint.
- `goto` (a separate process) navigated the SAME live page without a
  "run `serve` first" error, proving cross-invocation session persistence.
- `snapshot` (another separate process) returned a non-trivial structured view of
  the Kayak results page (you can SEE flight results / prices / a results region
  in the accessibility + text content).
- `stop` tore the session down.

Do NOT encode any of the above as automated tests that hit Kayak: the moment its
markup or anti-bot posture changes, such a test rots. Live-site verification stays
here, manual.

## If it fails

- "run `serve` first" on `goto`/`snapshot`: the server is not up (step 2) or it
  was stopped. Start `serve` and retry.
- A challenge / login wall in the snapshot: redo `setup-profile` headed and clear
  it, then retry the headless run. We never bypass login or solve CAPTCHAs
  programmatically.
- Missing browser binary: run the exact `playwright install` command the error
  prints.
- Empty/sparse snapshot: the results may still be loading; add a `wait` before
  `snapshot`. Kayak is flaky by nature; this is expected and is exactly why the
  smoke is manual and not a gate.
