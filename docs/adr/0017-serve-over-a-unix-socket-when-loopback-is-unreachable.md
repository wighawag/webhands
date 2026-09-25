# `serve --socket` serves the session over a unix socket, for a caller that cannot reach loopback

`serve` can OPTIONALLY listen on a **unix socket** instead of a TCP port: `webhands serve --socket ~/.webhands/session.sock` (or `WEBHANDS_SOCKET=<path>`). The endpoint file then records `socket` instead of `url`, and every verb reaches the session over that socket with NO flag of its own, because discovery stays the single source of truth for how to reach the session (ADR-0005). TCP on loopback remains the DEFAULT and its behaviour is unchanged; this is an added mode, not a migration.

## What forced it: a per-uid egress jail that drops loopback

Measured on telemaque, 2026-09-25, from an anonymised account whose egress is forced per-uid with nftables:

```
[anon-01] $ webhands serve > ~/wh-serve.log 2>&1 &
[anon-01] $ head -5 ~/wh-serve.log
  ok: true / verb: serve / url: "http://127.0.0.1:41419" / pid: 93537
[anon-01] $ webhands goto https://check.torproject.org/
  Error (unknown): could not reach the session server at http://127.0.0.1:41419: fetch failed
[anon-01] $ curl -sv --max-time 5 http://127.0.0.1:41419/ 2>&1 | tail -3
  *   Trying 127.0.0.1:41419...
  * Connection timed out after 5002 milliseconds
```

Read the shape of that failure before reading the fix. It is **not a connection refusal**, so the server was alive, healthy, and listening: a refusal is the one shape that means nothing is there. That account's ruleset ends in a closure rule

```
meta skuid <uid> ip daddr 127.0.0.0/8 drop
```

whose job is to stop the account reaching ANY other local proxy and thereby escaping the forcing. It is deliberate and is not going to be relaxed, and it drops **both directions**: the verb's outbound packet to loopback is dropped, and a listener owned by that uid would have its SYN-ACK dropped on the way out too. So no arrangement of uids, hosts or ports rescues the TCP design, and the two obvious "fixes" are worse than the problem: binding `0.0.0.0` exposes the logged-in browser to the network, and adding a proxy punches exactly the hole the rule exists to close.

The EXACT error text is not the signal, and we found that out the honest way. The live acceptance run in the same jail on the same day produced a completed handshake followed by `Recv failure: Connection reset by peer`, not a timeout (observation `loopback-jail-failure-surfaces-as-reset-not-only-timeout`), so the published diagnosis keys on what is invariant instead: `serve` reports `ok: true` with a live pid, every verb and a bare `curl` fail to reach that url anyway, and the failure is NOT "connection refused". A timeout and a reset are both that condition; only a refusal means something else (nothing is listening, so restart `serve`).

A unix socket is not IP traffic. It traverses no nftables chain at all, which is why it is THE fix rather than one option among several. The same constraint already forced the same answer for a search backend on that fleet, so this is the second instance of a pattern, not a one-off.

ADR-0005 already wrote the endpoint file's contents as "port/socket path", so this lands that wording rather than widening the model.

## Why TCP stays the default

The jail is one deployment, not the common one. TCP-on-loopback works everywhere, needs no path chosen, no directory to exist, and no cleanup; it is also what every existing endpoint file, eval harness and third-party caller already reads. Making socket mode the default would impose a filesystem-lifecycle problem (a stale path after a crash, a path that has to live somewhere writable) on every user to serve the minority who need it. So the mode is opt-in, and the flag's help text names the CONDITION it treats rather than presenting itself as a better transport.

## What the endpoint file now promises

The endpoint is a UNION, not a record with two optional address fields: a session is reachable exactly one way, and a client must not be able to read a socket-served session as though it had a URL.

- A socket endpoint carries `socket` and **no `url`**. Synthesising something like `http://localhost/` would name an address that is either wrong or, worse, someone else's listener.
- That absence IS the backward-compatibility mechanism. `readSessionEndpoint` required `{url, pid}` through 0.7.x, so an OLD client meeting a NEW socket-shaped file finds no `url`, returns "no live server", and prints "run `serve` first". It degrades to an actionable error instead of crashing or dialling the wrong thing.
- The url branch is kept verbatim, so a NEW client meeting an OLD url-shaped file behaves exactly as before.
- A file carrying BOTH (a shape we never write) resolves to the SOCKET. This mode exists because the url cannot be reached, so preferring TCP would pick the one address guaranteed to fail.
- The same guarantee holds on the client half: a url-only caller doing `connectRemoteSession(endpoint.url)` passes `undefined` for a socket session, which raises the typed `NoLiveServerError` rather than a raw `TypeError: Invalid base URL` from deep inside `new URL()`.
- The single-session invariant is untouched and identical in both modes, because the mechanism is the endpoint FILE, which socket mode writes exactly as TCP mode does.

## The socket IS the access control

There is no authentication on the session RPC and there never was: the TCP listener's protection was that it bound loopback only. The socket's equivalent is its inode, because `connect()` requires **write permission** on it. So ownership plus mode is the whole gate, and the mode cannot be left to chance:

- It is created **0600**, owned by the serving user, and any parent directory webhands has to CREATE is made `0700`. A 0600 socket is worthless inside a directory a third party can write, since they can unlink it and bind their own in its place; `mode` is masked by the umask, so that can only be tighter than the default, and an existing `~/.webhands` is left exactly as the user has it.
- `listen(path)` applies the process **umask**, so on a box with the usual `umask 022` the socket would land world-connectable. The umask is therefore narrowed to `0o177` for the duration of the bind (which closes the window in which a looser inode exists at all, rather than widening it and fixing it afterwards), restored in a `finally` so it cannot leak into the rest of the long-lived serve process, and followed by an explicit `chmod` as the belt-and-braces for any platform that ignores umask here.
- The test sets a deliberately permissive `umask 000` BEFORE starting the server, because a mode asserted under the runner's own umask would have passed either way and proved nothing. Being precise about what that proves: it asserts the FINAL mode (which the `chmod` alone would satisfy) and that the umask is restored afterwards. The narrowing closes the window in which a looser inode exists at all, and that part is argued from how `listen` applies the umask, not asserted by a test.

## Lifecycle: the socket is advertised state, like the endpoint file

- A **stale** socket is unlinked before listening. Node unlinks the path on a clean `close()`, so a leftover inode means specifically a crash (SIGKILL, OOM kill, pulled plug), and `listen` on an existing path fails `EADDRINUSE`. The test produces the artifact faithfully, with a child process that binds the path and is then SIGKILLed. This is narrower than "otherwise one hard kill breaks that path forever": a crash usually leaves the endpoint file too, so the next `serve` is refused with `session-already-active` and the documented `stop` clears both. The pre-listen unlink is what covers the case where the endpoint file is gone but the inode is not.
- A **live** socket is REFUSED, not unlinked, even though nothing in discovery objects. The endpoint-file guard is per HOME ROOT, so it cannot see a session that another root advertised at the same path (another `WEBHANDS_HOME`, a wrapper that exported `WEBHANDS_SOCKET`, the eval harness). Taking the path there would be silent hijacking rather than a visible clash: the victim's endpoint file still names that path, so its next verb would drive OUR browser. The path is therefore probed with a `connect()` first (a dead listener's socket answers `ECONNREFUSED`, which is the discriminator), and an ambiguous probe resolves to "live", because a false "live" costs the user a clear error while a false "stale" costs them their session. The eval harness, which pins `WEBHANDS_HOME` for isolation, now pins `WEBHANDS_SOCKET` empty for the same reason.
- `stop` removes it, exactly as it clears the endpoint file, and for the same reason: a dead server must not leave behind a path that makes the next `serve` refuse or, worse, look alive. The CLI's `stop` also removes it when the served process is already gone, mirroring how it clears a stale endpoint file today.
- A path that exists and is **not a socket** is REFUSED (`invalid-socket-path`), not unlinked. A stale socket is ours to remove; a regular file or directory is the user's data, and deleting it to satisfy a flag would be destroying data.
- A path over the kernel's `sun_path` limit is refused by name (108 bytes on Linux, 104 on macOS). It is the one path in this tool with a hard length ceiling, and the kernel's own complaint is an opaque `EINVAL`.

## Why `node:http`, not a dependency on undici

`fetch` cannot be pointed at a unix socket without undici's `Agent`, and Node does not re-export that from any builtin, so using `fetch` here would mean taking a runtime dependency on undici for exactly **two call sites** (the RPC POST and the trace GET) in a package whose client half currently has none. `node:http`'s `request({socketPath, path, method, headers})` is a builtin that does the same job, so the dependency-free route is also the smaller diff. The TCP path still uses `fetch` unchanged.

## Platform coverage, stated plainly

Linux and macOS. Windows is REFUSED with a typed `socket-unsupported-platform` error whose fix command is the default TCP serve. Node accepts `listen(path)` on Windows, but it creates a NAMED PIPE, which carries none of the file ownership and mode that this mode's safety rests on; honouring the flag there would hand the user a channel with different, unstated access rules. The flag's help text says Linux/macOS. The refusal has a test, but it is gated on `win32` and CI is Linux-only, so that branch has never actually been executed: it is three lines guarded by a `process.platform` check, and this ADR would rather say so than imply coverage it does not have.

## Consequences

- **A verb needs no flag, and cannot get the transport wrong.** The endpoint is handed to the client whole, so a verb can neither choose TCP when a socket is advertised nor need to be told which mode is live. The cost is that `connectRemoteSession`'s argument widened from a base URL string to "string or address"; the string form still works, so existing in-process callers and the eval harness are unaffected.
- **`serve`'s envelope now states the mode.** It carries `transport: 'tcp' | 'socket'` alongside an optional `url` OR `socket`, so a caller parsing the output can tell which mode it got without inferring it from which field is present. `url` became optional, which is a schema widening for TCP callers, not a change: in TCP mode it is still there.
- **`--socket --expose-cdp` warns.** The advertised CDP endpoint is a loopback TCP address, which is exactly what a caller needing `--socket` cannot reach. It rides in the envelope's `warnings`, where the caller that chose the flags can see it, rather than passing silently.
- **Nothing is logged that was not logged before.** The socket path appears where the url appeared (the `serve` envelope, the endpoint file, the unreachable-server error) and nowhere else.
- **The unit tests cannot reproduce the environment this exists for.** They cover the endpoint promise, the 0600 mode, the stale-socket lifecycle, the live-socket refusal, a verb driven end to end over the socket, and both directions of the compatibility contract, including one case against a real browser. One honest caveat on that last pair: the "old client degrades" test asserts against the 0.7.x reader's predicate INLINED in the test, so it proves the file shape rather than executing the old package. The copy was checked against the published `webhands@0.7.1` build at the time of writing and matches it.
- **An old `stop` meeting a socket endpoint reports `stopped: false` and leaves the server running**, because it reads the file with the old url-only predicate and concludes nothing is live. Benign (the fix is to stop it with a current build, or signal the pid the file still carries) but worth stating, since it is the one place the designed degradation is mildly inconvenient rather than purely informative.
- **`WEBHANDS_SOCKET` is read from the process environment**, not from `.env`/`.env.local`. It is resolved when the `serve` command runs, which is before the dotenv load that `serve` performs for the browser's own env, so a value set in a dotenv file is ignored. The documentation only ever promises the shell environment; this is recorded because "why is my `.env` `WEBHANDS_SOCKET` ignored" is an obvious future question.

  The feature's actual acceptance was the live check inside the jail.

## Verified in the jail, 2026-09-25

Run as `anon-01` on telemaque via `anonctl exec` (which gates on its own `verify`, so the account was confirmed anonymized first), driving this branch's build:

- **Control:** a TCP `serve` advertised `http://127.0.0.1:34015` and stayed healthy, while `curl` and the verbs could not reach it. This is the failure the feature exists for, reproduced on demand. Note the shape: this run RESET the connection after the request was sent, rather than timing out as the original field measurement did, and the cause of that difference was not determined (observation `loopback-jail-failure-surfaces-as-reset-not-only-timeout`). What both runs share, and what the published diagnosis keys on, is a healthy server at an address that is not reachable and is not refusing.
- **Socket mode:** `serve --socket ~/.webhands/session.sock` reported `transport: socket` with no url; the endpoint file carried `{socket, pid}` only; the socket was `srw------- anon-01 anon-01`.
- **The acceptance assertion:** `goto https://check.torproject.org/` then `eval "document.body.innerText.includes('Congratulations')"` returned `true`, with NO flag on either verb (the transport came from discovery alone). The page reported the exit IP `192.42.116.65`, so the browser's traffic left through that account's own Tor circuit.
- `distill` read the same session's trace over the same socket, and `stop` removed both the socket and the endpoint file.
