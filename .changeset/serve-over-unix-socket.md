---
'webhands': minor
'@webhands/core': minor
---

**`serve --socket <path>` serves the session over a UNIX SOCKET, so an account that cannot reach loopback can still drive a browser.**

Measured in the field on a jailed account whose egress is forced per-uid with nftables: `serve` reported `ok: true` with `http://127.0.0.1:41419`, and every verb failed with `could not reach the session server`. The tell is that `curl` against the same URL was NOT refused (a refusal is the one shape that means nothing is listening): the server was alive and healthy and the address was unusable, once as a 5s timeout and once, in the live verification run, as a reset after the request was sent. That ruleset ends in `meta skuid <uid> ip daddr 127.0.0.0/8 drop`, whose job is to stop the account reaching any other local proxy and escaping the forcing. It applies in both directions, so no host or port rescues a TCP listener. A unix socket is not IP traffic and traverses no filter chain, which is why it is the fix rather than one option among several.

Verified end to end inside that jail: `serve --socket ~/.webhands/session.sock`, then `goto https://check.torproject.org/`, then `eval "document.body.innerText.includes('Congratulations')"` returning `true` with no flag on either verb, with the page reporting a Tor exit IP.

- **The endpoint file carries the transport, so a VERB needs no flag.** `serve --socket ~/.webhands/session.sock` (or `WEBHANDS_SOCKET=<path>`) records `socket` instead of `url`, and `goto`/`snapshot`/`eval`/`distill` reach it over that socket through the same discovery they already used. Nothing can route a verb through TCP when a socket is advertised.
- **TCP stays the DEFAULT, unchanged.** This is an added mode, not a migration: the flag names the condition it treats rather than presenting itself as a better transport, since socket mode buys a filesystem path with a lifecycle that the default does not have.
- **Old and new clients interoperate, both directions.** A socket endpoint deliberately carries NO synthetic `url`, so an older client (which required `url` + `pid`) reads it as "no live server" and prints "run `serve` first" instead of crashing or dialling something wrong; a new client reads an old url-shaped file exactly as before. A url-only call path given a socket-served endpoint raises the typed `no-live-server` error rather than a raw `TypeError` from inside `new URL()`.
- **The socket IS the access control**, so it is created `0600` and owned by the serving user (connecting requires write permission on the inode). The umask is narrowed for the bind itself rather than fixed up afterwards, because `listen()` honours the umask and `umask 022` would otherwise leave the socket world-connectable for the window in between.
- **Lifecycle matches the endpoint file**: a stale socket left by a SIGKILL is unlinked before the next `serve` (Node unlinks on a clean close, so a leftover inode means a crash, and `listen` on it would fail `EADDRINUSE` forever), `stop` removes it, and a path that exists and is NOT a socket is refused instead of deleted.
- `serve`'s envelope now states `transport: "tcp" | "socket"` alongside `url` OR `socket`, so a caller can tell which mode it got. `--socket --expose-cdp` warns, since the advertised CDP endpoint stays a loopback TCP address that such a caller very likely cannot reach either. Linux/macOS only: Windows refuses with a typed error rather than quietly serving over a named pipe, which carries none of the ownership and mode this relies on.

See `docs/adr/0017` for the decision, and the README/skill sections for the timeout-versus-refusal diagnosis that tells you whether you need this at all.
