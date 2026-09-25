import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	connectRemoteSession,
	InvalidSocketPathError,
	NoLiveServerError,
	PlaywrightLaunchTransport,
	readSessionEndpoint,
	readSessionTrace,
	removeSessionSocket,
	resolveProfileLocation,
	resolveSessionEndpointPath,
	startFixtureServer,
	startSessionServer,
	StubTransport,
	writeSessionEndpoint,
	type FixtureServer,
	type RunningSessionServer,
	type Session,
	type Transport,
} from '../src/index.js';

/**
 * Serving the session over a UNIX SOCKET (ADR-0017).
 *
 * The mode exists for a caller that cannot reach loopback at all: a per-uid
 * packet filter ending in `ip daddr 127.0.0.0/8 drop` leaves a perfectly
 * healthy TCP session server unreachable in BOTH directions, so no host/port
 * arrangement rescues it. A unix socket is not IP traffic and traverses no
 * filter chain, which is why it is the fix.
 *
 * This suite covers what the unit level CAN prove: the endpoint file's promise
 * (socket, and NO url), the 0600 mode that IS the access control, the
 * stale-socket lifecycle, a verb driven end to end over the socket via
 * DISCOVERY alone, and the two-way compatibility contract with url-shaped
 * endpoints. What it cannot reproduce is the jail itself; that is the live check
 * recorded in ADR-0017.
 *
 * Every test points the home root at a temp dir and asserts the real
 * `~/.webhands` is untouched, exactly as the existing endpoint/persistence
 * suites do.
 */
describe('serve over a unix socket (stub transport)', () => {
	const tempRoots: string[] = [];
	const running: RunningSessionServer[] = [];

	afterEach(async () => {
		while (running.length > 0) await running.pop()!.stop();
		while (tempRoots.length > 0)
			await rm(tempRoots.pop()!, {recursive: true, force: true});
	});

	/**
	 * A temp home root. Kept SHORT on purpose: `sockaddr_un.sun_path` is 108
	 * bytes (104 on macOS), so a socket path is the one path in this tool with a
	 * hard length ceiling, and a chatty prefix here would push a legitimate test
	 * over it.
	 */
	async function tempRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'wh-sock-'));
		tempRoots.push(root);
		return root;
	}

	/** Start a socket-served session over a temp root; returns the socket path. */
	async function startOnSocket(
		root: string,
		name = 'session.sock',
	): Promise<{server: RunningSessionServer; socketPath: string}> {
		const socketPath = join(root, name);
		const server = await startSessionServer(
			{mode: 'launch', profile: 'default'},
			{root, transport: new StubTransport(), socketPath},
		);
		running.push(server);
		return {server, socketPath};
	}

	describe('what the endpoint file promises', () => {
		it('records the SOCKET and no url, so discovery alone names the transport', async () => {
			const root = await tempRoot();
			const {socketPath} = await startOnSocket(root);

			const advertised = await readSessionEndpoint({root});
			expect(advertised).toEqual({socket: socketPath, pid: process.pid});
			// The absence of `url` is the contract, not an omission: it is what
			// makes an old url-only client degrade instead of dialling something
			// wrong (asserted below).
			expect(advertised).not.toHaveProperty('url');
		});

		it('records the URL and no socket in the default TCP mode (unchanged)', async () => {
			const root = await tempRoot();
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport: new StubTransport()},
			);
			running.push(server);

			const advertised = await readSessionEndpoint({root});
			expect(advertised?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			expect(advertised).toEqual({url: server.endpoint.url, pid: process.pid});
			expect(advertised).not.toHaveProperty('socket');
		});

		it('prefers an advertised socket over an advertised url', async () => {
			// A file carrying both is not a shape we write, but if one is met the
			// socket must win: this mode exists BECAUSE the url cannot be reached,
			// so preferring TCP would pick the one address guaranteed to fail.
			const root = await tempRoot();
			await writeFile(
				resolveSessionEndpointPath({root}),
				JSON.stringify({
					url: 'http://127.0.0.1:1',
					socket: '/tmp/x.sock',
					pid: 7,
				}),
				'utf8',
			);
			const advertised = await readSessionEndpoint({root});
			expect(advertised?.socket).toBe('/tmp/x.sock');
			expect(advertised?.url).toBeUndefined();
		});
	});

	describe('the socket IS the access control', () => {
		it('creates it 0600, whatever the ambient umask is', async () => {
			// Set a permissive umask FIRST: the failure this guards against is the
			// umask race, where `listen(path)` would leave the socket
			// world-connectable (0777 & ~umask) for anyone on the box. A mode
			// asserted under the test runner's own umask would pass either way.
			const previous = process.umask(0o000);
			try {
				const root = await tempRoot();
				const {socketPath} = await startOnSocket(root);
				const info = await stat(socketPath);
				expect(info.isSocket()).toBe(true);
				expect(info.mode & 0o777).toBe(0o600);
			} finally {
				process.umask(previous);
			}
		});

		it('restores the process umask after binding', async () => {
			// The narrowed umask must not leak into the rest of this long-lived
			// serve process (it would silently tighten every later file it writes).
			const root = await tempRoot();
			const before = process.umask(0o022);
			try {
				await startOnSocket(root);
				expect(process.umask(0o022)).toBe(0o022);
			} finally {
				process.umask(before);
			}
		});
	});

	describe('a verb drives the live session over the socket', () => {
		it('reaches the ONE live session using DISCOVERY alone (no flag, no url)', async () => {
			const root = await tempRoot();
			const transport = new StubTransport();
			const socketPath = join(root, 'session.sock');
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport, socketPath},
			);
			running.push(server);

			// This is the thin-client path a verb takes: read the endpoint file,
			// hand it to the client whole, drive the page. Nothing here names a
			// transport; the endpoint does.
			const endpoint = await readSessionEndpoint({root});
			const client = connectRemoteSession(endpoint!);
			await client.page.navigate('https://example.test/');
			await client.page.click("getByRole('button')" as never);
			await client.close();

			expect(transport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/']},
				{verb: 'click', args: ["getByRole('button')"]},
			]);
		});

		it('spans two separate client connections (cross-invocation persistence holds)', async () => {
			// Two independent connections model two separate `webhands <verb>`
			// processes: each opens, drives, and closes. Both must land on the ONE
			// live session, which is the whole point of the serve model.
			const root = await tempRoot();
			const transport = new StubTransport();
			const socketPath = join(root, 'session.sock');
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport, socketPath},
			);
			running.push(server);

			const client1 = connectRemoteSession({socket: socketPath});
			await client1.page.navigate('https://example.test/a');
			await client1.close(); // must NOT tear down the served session

			const client2 = connectRemoteSession({socket: socketPath});
			await client2.page.navigate('https://example.test/b');
			await client2.close();

			expect(transport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/a']},
				{verb: 'navigate', args: ['https://example.test/b']},
			]);
		});

		it('reads the verb trace over the socket too (the distill path)', async () => {
			const root = await tempRoot();
			const {socketPath} = await startOnSocket(root);
			const client = connectRemoteSession({socket: socketPath});
			await client.page.navigate('https://example.test/');
			await client.close();

			const entries = await readSessionTrace({socket: socketPath});
			expect(entries.map((entry) => entry.verb)).toEqual(['navigate']);
		});

		it('a server-side throw still REJECTS faithfully across the socket', async () => {
			// The seam's "a throw on the served side rejects on the client" contract
			// must not depend on which transport carried the RPC. An unloaded hand
			// verb is the cheapest genuine server-side throw (the stub page has no
			// such method), and it exercises the SAME ok:false reply path a page
			// exception takes.
			const root = await tempRoot();
			const {socketPath} = await startOnSocket(root);
			const client = connectRemoteSession({socket: socketPath}, ['notLoaded']);
			const page = client.page as unknown as {
				notLoaded(): Promise<unknown>;
			};
			await expect(page.notLoaded()).rejects.toThrow(
				/no such hand verb 'notLoaded'/,
			);
			await client.close();
		});

		it('names the SOCKET, not a url, when the server is unreachable', async () => {
			const root = await tempRoot();
			const socketPath = join(root, 'absent.sock');
			const client = connectRemoteSession({socket: socketPath});
			await expect(
				client.page.navigate('https://example.test/'),
			).rejects.toThrow(
				new RegExp(
					`could not reach the session server at unix socket ${socketPath}`,
				),
			);
		});
	});

	describe('stale socket lifecycle', () => {
		it('a socket left behind by a crash does NOT prevent the next serve', async () => {
			// The exact shape of a crash. Node UNLINKS a unix socket on a clean
			// `close()`, so the leftover inode is specifically what a SIGKILL (or an
			// OOM kill, or a pulled plug) leaves: hence a real child process, hard
			// killed. `listen` on an existing path fails EADDRINUSE, so without the
			// pre-listen unlink ONE hard kill would make that path unusable forever
			// and `serve` would refuse for reasons the user cannot see.
			const root = await tempRoot();
			const socketPath = join(root, 'session.sock');
			await leaveStaleSocket(socketPath);
			expect((await stat(socketPath)).isSocket()).toBe(true);

			// A stale ENDPOINT FILE is the other half of the same crash; discovery
			// already treats it as best-effort, and the socket must not be worse.
			await writeSessionEndpoint({socket: socketPath, pid: 999_999}, {root});

			const {socketPath: reused} = await startOnSocket(root);
			expect(reused).toBe(socketPath);

			// And the fresh server is actually reachable on that reused path.
			const client = connectRemoteSession({socket: reused});
			await client.page.navigate('https://example.test/after-stale');
			await client.close();
			expect((await readSessionTrace({socket: reused})).length).toBe(1);
		});

		it('stop() removes the socket, exactly as it clears the endpoint file', async () => {
			const root = await tempRoot();
			const {server, socketPath} = await startOnSocket(root);
			expect((await stat(socketPath)).isSocket()).toBe(true);

			await server.stop();

			expect(await readSessionEndpoint({root})).toBeUndefined();
			await expect(stat(socketPath)).rejects.toThrow();
		});

		it('REFUSES to steal a socket something else is still LISTENING on', async () => {
			// The endpoint-file guard that enforces the single session is per HOME
			// ROOT, so it cannot see a server another root advertised at the same
			// path (another WEBHANDS_HOME, a wrapper exporting WEBHANDS_SOCKET, the
			// eval harness). Unlinking there would be silent hijacking: the victim's
			// endpoint file still names this path, so ITS next verb would drive OUR
			// browser. A live listener must therefore be a refusal, and the
			// distinction from the stale case above is liveness, not the file type.
			const victimRoot = await tempRoot();
			const socketPath = join(victimRoot, 'session.sock');
			const victimTransport = new StubTransport();
			const victim = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root: victimRoot, transport: victimTransport, socketPath},
			);
			running.push(victim);

			// A SECOND home root, so nothing in discovery knows about the first.
			const otherRoot = await tempRoot();
			await expect(
				startSessionServer(
					{mode: 'launch', profile: 'default'},
					{root: otherRoot, transport: new StubTransport(), socketPath},
				),
			).rejects.toThrow(/already LISTENING/);

			// The victim is untouched: socket still there, still driving ITS session.
			expect((await stat(socketPath)).isSocket()).toBe(true);
			const client = connectRemoteSession({socket: socketPath});
			await client.page.navigate('https://example.test/still-mine');
			await client.close();
			expect(victimTransport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/still-mine']},
			]);
		});

		it('REFUSES to unlink a path that exists and is not a socket', async () => {
			// A stale socket is ours to remove; a regular file is the user's data,
			// and deleting it to satisfy a flag would be destroying data.
			const root = await tempRoot();
			const notASocket = join(root, 'precious.txt');
			await writeFile(notASocket, 'do not delete me', 'utf8');

			await expect(
				startSessionServer(
					{mode: 'launch', profile: 'default'},
					{root, transport: new StubTransport(), socketPath: notASocket},
				),
			).rejects.toThrow(InvalidSocketPathError);

			// Still there, untouched.
			expect(await readFile(notASocket, 'utf8')).toBe('do not delete me');
			// And no endpoint file was advertised for a server that never came up.
			expect(await readSessionEndpoint({root})).toBeUndefined();
		});

		it('stop() closes the BROWSER even when clearing advertised state fails', async () => {
			// `stop()` sets its idempotence flag first, so a throw between that and
			// `session.close()` would leave an orphan browser that NO retry could
			// ever close (the flag makes the retry a no-op). Provoke exactly that by
			// making the endpoint file unremovable: a read-only parent directory
			// fails the unlink with EACCES, which `force: true` does not swallow.
			//
			// (The first attempt at this test replaced the socket with a regular file
			// and asserted the socket-removal refusal. It did not fire: Node unlinks
			// a unix socket path on `close()`, so by the time teardown reaches
			// `removeSessionSocket` the path is already gone.)
			const root = await tempRoot();
			const socketPath = join(root, 'session.sock');
			// Wrap the stub so the test holds the SERVED session handle (the stub
			// rejects verbs only after its own close(), which is the signal we want).
			const base = new StubTransport();
			let session: Session | undefined;
			const transport: Transport = {
				async open(target) {
					session = await base.open(target);
					return session;
				},
			};
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport, socketPath},
			);

			await chmod(root, 0o500);
			try {
				await expect(server.stop()).rejects.toThrow(
					/EACCES|permission denied/i,
				);
				// The error surfaced AND the browser is closed: the stub rejects verbs
				// only after its own session.close(), so this proves teardown reached
				// it despite the failure above.
				await expect(
					session!.page.navigate('https://example.test/'),
				).rejects.toThrow(/session is closed/);
			} finally {
				await chmod(root, 0o700); // so afterEach can clean the temp root up
			}
		});

		it('removing an absent socket is not an error (idempotent teardown)', async () => {
			const root = await tempRoot();
			await expect(
				removeSessionSocket(join(root, 'never-existed.sock')),
			).resolves.toBeUndefined();
		});

		it('refuses a path over the kernel sun_path limit, naming the limit', async () => {
			const root = await tempRoot();
			const tooLong = join(root, `${'x'.repeat(120)}.sock`);
			await expect(
				startSessionServer(
					{mode: 'launch', profile: 'default'},
					{root, transport: new StubTransport(), socketPath: tooLong},
				),
			).rejects.toThrow(/sun_path is 108 bytes on Linux/);
		});
	});

	describe('compatibility with url-shaped endpoints, both directions', () => {
		it('an OLD-shaped endpoint file still drives a TCP session (no regression)', async () => {
			// A file written by a pre-ADR-0017 serve: url + pid, nothing else. The
			// new reader must accept it verbatim and the new client must dial it.
			const tcpRoot = await tempRoot();
			const transport = new StubTransport();
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root: tcpRoot, transport},
			);
			running.push(server);

			const legacyRoot = await tempRoot();
			await writeFile(
				resolveSessionEndpointPath({root: legacyRoot}),
				JSON.stringify({url: server.endpoint.url, pid: 4242}),
				'utf8',
			);

			const endpoint = await readSessionEndpoint({root: legacyRoot});
			expect(endpoint).toEqual({url: server.endpoint.url, pid: 4242});
			const client = connectRemoteSession(endpoint!);
			await client.page.navigate('https://example.test/legacy');
			await client.close();
			expect(transport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/legacy']},
			]);
		});

		it('a base-URL STRING still works (the pre-ADR-0017 client argument)', async () => {
			const root = await tempRoot();
			const transport = new StubTransport();
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport},
			);
			running.push(server);
			const client = connectRemoteSession(server.endpoint.url!);
			await client.page.navigate('https://example.test/string-arg');
			await client.close();
			expect(transport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/string-arg']},
			]);
		});

		it('an OLD url-only READER treats a socket-shaped file as "no live server"', async () => {
			// This is the OLD `readSessionEndpoint` predicate as it shipped through
			// 0.7.x, copied verbatim (checked against the published `webhands@0.7.1`
			// build when this test was written): it required `url` + `pid`. Met with
			// a socket-shaped file it must fall through to `undefined` (which the CLI
			// maps to "run serve first") rather than crash on the missing field.
			// NOTE what this proves and what it does not: it exercises the FILE
			// SHAPE against a copy of the old logic, not the old package itself.
			const root = await tempRoot();
			await startOnSocket(root);
			const text = await readFile(resolveSessionEndpointPath({root}), 'utf8');

			const legacyRead = (json: string): unknown => {
				const parsed = JSON.parse(json) as {url?: unknown; pid?: unknown};
				if (
					typeof parsed.url === 'string' &&
					parsed.url !== '' &&
					typeof parsed.pid === 'number'
				) {
					return {url: parsed.url, pid: parsed.pid};
				}
				return undefined;
			};

			expect(legacyRead(text)).toBeUndefined();
		});

		it('a url-only CLIENT path yields the typed NoLiveServerError, not a TypeError', async () => {
			// The other half of the old url-only path: a caller written against the
			// old shape does `connectRemoteSession(endpoint.url)`, which for a
			// socket-served session is `undefined`. Unguarded that lands in
			// `new URL(path, undefined)` and surfaces as "Invalid base URL", which
			// tells the user nothing actionable.
			const root = await tempRoot();
			await startOnSocket(root);
			const endpoint = await readSessionEndpoint({root});

			expect(() =>
				connectRemoteSession(endpoint!.url as unknown as string),
			).toThrow(NoLiveServerError);
			try {
				connectRemoteSession(endpoint!.url as unknown as string);
			} catch (cause) {
				expect((cause as NoLiveServerError).code).toBe('no-live-server');
				expect((cause as Error).message).toMatch(/UNIX SOCKET/);
			}
			// Same guarantee on the trace read.
			await expect(
				readSessionTrace(endpoint!.url as unknown as string),
			).rejects.toThrow(NoLiveServerError);
		});
	});

	describe('the single-session invariant holds identically in both modes', () => {
		it('a live SOCKET endpoint is discoverable, so a second serve is refused', async () => {
			// The mechanism is the endpoint FILE, which socket mode writes exactly
			// as TCP mode does. (The refusal itself is the CLI's, asserted there.)
			const root = await tempRoot();
			await startOnSocket(root);
			const live = await readSessionEndpoint({root});
			expect(live).toBeDefined();
			expect(live?.pid).toBe(process.pid);
		});
	});

	describe('shared-write isolation', () => {
		it('touches only the temp root; the real ~/.webhands is untouched', async () => {
			const realEndpointPath = resolveSessionEndpointPath();
			expect(realEndpointPath.startsWith(homedir())).toBe(true);
			const realExistedBefore = await exists(realEndpointPath);
			const realSocketBefore = await exists(
				join(homedir(), '.webhands', 'session.sock'),
			);

			const root = await tempRoot();
			const {socketPath} = await startOnSocket(root);
			const client = connectRemoteSession({socket: socketPath});
			await client.page.navigate('https://example.test/');
			await client.close();

			// Both artefacts live under the TEMP root.
			expect(socketPath.startsWith(root)).toBe(true);
			expect(await exists(socketPath)).toBe(true);
			expect(resolveSessionEndpointPath({root}).startsWith(root)).toBe(true);

			// The real shared location is exactly as we found it: we neither created
			// nor removed its endpoint file OR a socket beside it.
			expect(await exists(realEndpointPath)).toBe(realExistedBefore);
			expect(await exists(join(homedir(), '.webhands', 'session.sock'))).toBe(
				realSocketBefore,
			);

			// And the only things we wrote are in the temp root.
			const entries = await readdir(root);
			expect(entries.sort()).toEqual(
				['session-endpoint.json', 'session.sock'].sort(),
			);
		});
	});

	// Windows has no unix socket in the sense this mode needs: Node maps
	// `listen(<path>)` there to a NAMED PIPE, which carries none of the file
	// ownership + 0600 mode that IS the access control here. So the flag refuses
	// loudly rather than quietly serving over something with different rules.
	// Asserted only on the platform that can observe it (ADR-0017 states the
	// platform coverage plainly rather than pretending).
	it.runIf(process.platform === 'win32')(
		'refuses socket mode on Windows instead of creating a named pipe',
		async () => {
			const root = await tempRoot();
			await expect(
				startSessionServer(
					{mode: 'launch', profile: 'default'},
					{
						root,
						transport: new StubTransport(),
						socketPath: join(root, 'session.sock'),
					},
				),
			).rejects.toThrow(/not supported on win32/);
		},
	);
});

/**
 * The same mode against a REAL browser and a local fixture page, once.
 *
 * The stub suite above proves the plumbing; this proves the plumbing carries a
 * real session, so nothing in the transport path (RPC framing, the snapshot
 * payload size, the trace read) quietly depended on TCP. Kept to a single case
 * because browser processes are this suite's scarce resource.
 */
describe('serve over a unix socket (real browser, local fixture)', () => {
	let fixture: FixtureServer;
	const tempRoots: string[] = [];
	const running: RunningSessionServer[] = [];

	beforeAll(async () => {
		fixture = await startFixtureServer();
	});

	afterAll(async () => {
		await fixture.close();
	});

	afterEach(async () => {
		while (running.length > 0) await running.pop()!.stop();
		while (tempRoots.length > 0)
			await rm(tempRoots.pop()!, {recursive: true, force: true});
	});

	it('drives the live page across two client invocations, state intact', async () => {
		const root = await mkdtemp(join(tmpdir(), 'wh-sock-real-'));
		tempRoots.push(root);
		await mkdir(resolveProfileLocation('persist', {root}).profileDir, {
			recursive: true,
		});
		const socketPath = join(root, 'session.sock');
		const server = await startSessionServer(
			{mode: 'launch', profile: 'persist'},
			{root, transport: new PlaywrightLaunchTransport({root}), socketPath},
		);
		running.push(server);

		// Invocation 1: navigate, then make an in-MEMORY mutation the on-disk
		// profile could not carry.
		const client1 = connectRemoteSession({socket: socketPath});
		await client1.page.navigate(`${fixture.url}/`);
		await client1.page.eval(
			"document.getElementById('status').textContent = 'touched-over-socket'",
		);
		await client1.close();

		// Invocation 2: a different connection sees the SAME live page, which is
		// only possible if the browser launched once in the server.
		const client2 = connectRemoteSession({socket: socketPath});
		const snap = await client2.page.snapshot();
		expect(snap.url).toBe(`${fixture.url}/`);
		expect(
			await client2.page.eval("document.getElementById('status').textContent"),
		).toBe('touched-over-socket');
		await client2.close();

		// The socket is the advertised address and is 0600 on a real run too.
		expect((await readSessionEndpoint({root}))?.socket).toBe(socketPath);
		expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
	});
});

/** True iff `path` exists. */
async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Leave a genuinely STALE socket inode at `path`: a child process binds it and
 * is then SIGKILLed, so nothing runs the unlink that a clean `close()` would.
 * This is the only faithful way to produce the artifact, because Node removes
 * the file on an orderly shutdown.
 */
async function leaveStaleSocket(path: string): Promise<void> {
	const child = spawn(
		process.execPath,
		[
			'-e',
			`require('node:net').createServer().listen(${JSON.stringify(path)}, () => ` +
				`process.stdout.write('ready\\n'))`,
		],
		{stdio: ['ignore', 'pipe', 'ignore']},
	);
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error('the stale-socket helper never became ready')),
				10_000,
			);
			child.stdout.on('data', (chunk: Buffer) => {
				if (chunk.toString('utf8').includes('ready')) {
					clearTimeout(timer);
					resolve();
				}
			});
			child.once('error', (cause) => {
				clearTimeout(timer);
				reject(cause);
			});
		});
	} finally {
		child.kill('SIGKILL');
	}
	await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}
