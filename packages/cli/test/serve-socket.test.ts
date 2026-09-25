import {mkdtemp, readdir, rm, stat} from 'node:fs/promises';
import {createServer} from 'node:net';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	InvalidSocketPathError,
	SESSION_SOCKET_ENV,
	SocketUnsupportedError,
	startSessionServer,
	StubTransport,
	writeSessionEndpoint,
	type OpenTarget,
	type RunningSessionServer,
	type SessionEndpoint,
} from '@webhands/core';
import {
	createCli,
	mapControllerError,
	resolveServeSocketPath,
	type ServeSession,
} from '../src/index.js';

/**
 * `serve --socket` at the CLI level (ADR-0017): the flag, the envelope, the
 * flag/env precedence, and above all a REAL VERB driven end to end over a
 * socket-served session through the default (discovery-backed) provider.
 *
 * The last one is the point of the feature: a verb takes no `--socket` flag, so
 * if discovery did not carry the transport, a socket-served session would be
 * undrivable. Everything here runs against a temp home root and asserts the
 * real `~/.webhands` is untouched.
 */
describe('serve --socket (CLI)', () => {
	const tempRoots: string[] = [];
	const running: RunningSessionServer[] = [];

	afterEach(async () => {
		while (running.length > 0) await running.pop()!.stop();
		while (tempRoots.length > 0)
			await rm(tempRoots.pop()!, {recursive: true, force: true});
	});

	/** A SHORT temp root: a socket path has a ~100-byte kernel ceiling. */
	async function tempRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'wh-cli-sock-'));
		tempRoots.push(root);
		return root;
	}

	/** Run one CLI command against a home root, returning the JSON envelope. */
	async function runEnvelope(
		root: string,
		argv: string[],
		extra: {serveSession?: ServeSession; env?: Record<string, string>} = {},
	): Promise<{
		ok: boolean;
		data?: Record<string, unknown>;
		error?: {code: string; message: string};
	}> {
		const cli = createCli({
			home: {root, ...(extra.env !== undefined ? {env: extra.env} : {})},
			...(extra.serveSession !== undefined
				? {serveSession: extra.serveSession}
				: {}),
		});
		let stdout = '';
		await cli.serve([...argv, '--full-output', '--format', 'json'], {
			stdout: (s) => {
				stdout += s;
			},
			exit: () => {},
			env: extra.env ?? {},
		});
		return JSON.parse(stdout);
	}

	/**
	 * A fake {@link ServeSession} advertising whatever endpoint it is given, so
	 * the `serve` ENVELOPE can be asserted with no real listener and no browser.
	 */
	function fakeServe(endpoint: SessionEndpoint): {
		serve: ServeSession;
		seen: {socketPath?: string}[];
		targets: OpenTarget[];
	} {
		const seen: {socketPath?: string}[] = [];
		const targets: OpenTarget[] = [];
		const serve: ServeSession = async (target, options) => {
			targets.push(target);
			seen.push({
				...(options.socketPath !== undefined
					? {socketPath: options.socketPath}
					: {}),
			});
			return {
				endpoint,
				trace: {entries: () => []},
				async stop() {},
			} as unknown as RunningSessionServer;
		};
		return {serve, seen, targets};
	}

	describe('a real verb drives a socket-served session end to end', () => {
		it('`goto` reaches the live page with NO flag: discovery carries the transport', async () => {
			const root = await tempRoot();
			const transport = new StubTransport();
			const socketPath = join(root, 'session.sock');
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport, socketPath},
			);
			running.push(server);

			// The real CLI, the real default provider: it reads the endpoint file
			// and dials whatever transport that file names.
			const envelope = await runEnvelope(root, [
				'goto',
				'https://example.test/over-socket',
			]);

			expect(envelope.ok).toBe(true);
			expect(transport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/over-socket']},
			]);
		});

		it('a SECOND verb invocation drives the SAME live session over the socket', async () => {
			// Cross-invocation persistence is the reason the serve process exists;
			// it must hold on this transport too.
			const root = await tempRoot();
			const transport = new StubTransport();
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport, socketPath: join(root, 'session.sock')},
			);
			running.push(server);

			await runEnvelope(root, ['goto', 'https://example.test/one']);
			await runEnvelope(root, ['goto', 'https://example.test/two']);

			expect(transport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/one']},
				{verb: 'navigate', args: ['https://example.test/two']},
			]);
		});

		it('with NO live server a verb still says "run serve first" (never auto-spawns)', async () => {
			const root = await tempRoot();
			const envelope = await runEnvelope(root, [
				'goto',
				'https://example.test/',
			]);
			expect(envelope.ok).toBe(false);
			expect(envelope.error?.code).toBe('no-live-server');
			// Nothing was created under the root: no socket, no browser, no profile.
			expect(await readdir(root)).toEqual([]);
		});
	});

	describe('the serve envelope tells the caller which mode it got', () => {
		it('socket mode reports transport=socket + socket, and NO url', async () => {
			const root = await tempRoot();
			const socketPath = join(root, 'session.sock');
			const {serve, seen} = fakeServe({socket: socketPath, pid: 4242});
			const envelope = await runEnvelope(
				root,
				['serve', '--socket', socketPath],
				{serveSession: serve},
			);

			expect(envelope.ok).toBe(true);
			expect(envelope.data).toMatchObject({
				verb: 'serve',
				transport: 'socket',
				socket: socketPath,
				pid: 4242,
			});
			expect(envelope.data).not.toHaveProperty('url');
			// And the flag actually reached the serve seam as the listener option.
			expect(seen).toEqual([{socketPath}]);
		});

		it('TCP mode is UNCHANGED: transport=tcp + url, and no socket', async () => {
			const root = await tempRoot();
			const {serve, seen} = fakeServe({
				url: 'http://127.0.0.1:51999',
				pid: 4242,
			});
			const envelope = await runEnvelope(root, ['serve'], {
				serveSession: serve,
			});

			expect(envelope.data).toMatchObject({
				verb: 'serve',
				transport: 'tcp',
				url: 'http://127.0.0.1:51999',
				pid: 4242,
			});
			expect(envelope.data).not.toHaveProperty('socket');
			// No socketPath was passed: TCP stays the default, untouched.
			expect(seen).toEqual([{}]);
		});

		it('declares both address fields plus `transport` in the output schema', async () => {
			const cli = createCli({});
			let stdout = '';
			await cli.serve(['serve', '--schema', '--format', 'json'], {
				stdout: (s) => {
					stdout += s;
				},
				exit: () => {},
				env: {},
			});
			const schema = JSON.parse(stdout) as {
				output?: {properties?: Record<string, unknown>};
				options?: {properties?: Record<string, unknown>};
			};
			expect(Object.keys(schema.output?.properties ?? {})).toEqual(
				expect.arrayContaining([
					'ok',
					'verb',
					'transport',
					'url',
					'socket',
					'pid',
				]),
			);
			expect(Object.keys(schema.options?.properties ?? {})).toEqual(
				expect.arrayContaining(['socket']),
			);
		});

		it('warns that --expose-cdp stays on LOOPBACK when serving on a socket', async () => {
			// Self-defeating in the environment that needs --socket: the advertised
			// CDP endpoint is a loopback TCP address, which is exactly what that
			// caller cannot reach. It must not pass silently.
			const root = await tempRoot();
			const socketPath = join(root, 'session.sock');
			const {serve} = fakeServe({socket: socketPath, pid: 1});
			const envelope = await runEnvelope(
				root,
				['serve', '--socket', socketPath, '--expose-cdp'],
				{serveSession: serve},
			);
			expect(envelope.data?.warnings).toEqual(
				expect.arrayContaining([expect.stringMatching(/LOOPBACK TCP address/)]),
			);
		});
	});

	describe('the single-session invariant is identical in both modes', () => {
		it('refuses a second serve when a SOCKET endpoint is advertised', async () => {
			const root = await tempRoot();
			const socketPath = join(root, 'session.sock');
			await writeSessionEndpoint({socket: socketPath, pid: 4242}, {root});
			const {serve} = fakeServe({socket: socketPath, pid: 9});

			const envelope = await runEnvelope(
				root,
				['serve', '--socket', socketPath],
				{serveSession: serve},
			);
			expect(envelope.ok).toBe(false);
			expect(envelope.error?.code).toBe('session-already-active');
		});

		it('refuses a second serve when a URL endpoint is advertised (unchanged)', async () => {
			const root = await tempRoot();
			await writeSessionEndpoint(
				{url: 'http://127.0.0.1:51999', pid: 4242},
				{root},
			);
			const {serve} = fakeServe({url: 'http://127.0.0.1:51999', pid: 9});
			const envelope = await runEnvelope(root, ['serve'], {
				serveSession: serve,
			});
			expect(envelope.ok).toBe(false);
			expect(envelope.error?.code).toBe('session-already-active');
		});
	});

	describe('stop clears the socket as well as the endpoint file', () => {
		it('removes a socket left by a served process that is already gone', async () => {
			const root = await tempRoot();
			const socketPath = join(root, 'session.sock');
			// A live socket inode with NO live webhands process: the stale case. The
			// pid is one that cannot exist, so `stop`'s SIGTERM finds nothing (and
			// certainly not this test runner).
			const bare = createServer();
			await new Promise<void>((resolve) => bare.listen(socketPath, resolve));
			try {
				await writeSessionEndpoint({socket: socketPath, pid: 999_999}, {root});

				const envelope = await runEnvelope(root, ['stop']);
				expect(envelope.ok).toBe(true);
				expect(envelope.data).toMatchObject({verb: 'stop', stopped: true});

				// Both pieces of advertised state are gone: nothing left that makes
				// the next serve refuse or look alive.
				await expect(stat(socketPath)).rejects.toThrow();
				expect(await readdir(root)).toEqual([]);
			} finally {
				await new Promise<void>((resolve) => bare.close(() => resolve()));
			}
		});

		it('`stop` with nothing live is still a clean no-op', async () => {
			const root = await tempRoot();
			const envelope = await runEnvelope(root, ['stop']);
			expect(envelope.data).toMatchObject({verb: 'stop', stopped: false});
		});
	});

	describe('resolveServeSocketPath: flag over env, empty means unset', () => {
		it('uses the flag when given', () => {
			expect(
				resolveServeSocketPath('/tmp/flag.sock', {
					[SESSION_SOCKET_ENV]: '/tmp/env.sock',
				}),
			).toBe('/tmp/flag.sock');
		});

		it('falls back to the env var', () => {
			expect(
				resolveServeSocketPath(undefined, {
					[SESSION_SOCKET_ENV]: '/tmp/env.sock',
				}),
			).toBe('/tmp/env.sock');
		});

		it('is undefined (TCP) when neither is set', () => {
			expect(resolveServeSocketPath(undefined, {})).toBeUndefined();
		});

		it('treats an EMPTY value from either source as unset, not as a socket named ""', () => {
			expect(resolveServeSocketPath('', {})).toBeUndefined();
			expect(
				resolveServeSocketPath(undefined, {[SESSION_SOCKET_ENV]: ''}),
			).toBeUndefined();
		});

		it('expands a leading ~/ (the shell does not, inside an env var)', () => {
			// Without this we would create a directory literally named `~` in the
			// cwd and advertise a socket the user cannot find.
			expect(resolveServeSocketPath('~/.webhands/session.sock', {})).toBe(
				join(homedir(), '.webhands', 'session.sock'),
			);
			expect(
				resolveServeSocketPath(undefined, {[SESSION_SOCKET_ENV]: '~'}),
			).toBe(homedir());
		});

		it('leaves a path containing ~ elsewhere alone', () => {
			expect(resolveServeSocketPath('/tmp/a~b.sock', {})).toBe('/tmp/a~b.sock');
		});
	});

	describe('the new typed failures name an exact fix command', () => {
		it('maps socket-unsupported-platform to the default TCP serve', () => {
			const mapped = mapControllerError(
				new SocketUnsupportedError('win32'),
				'webhands',
			);
			expect(mapped?.code).toBe('socket-unsupported-platform');
			expect(mapped?.message).toMatch(/drop --socket/);
			expect(mapped?.message).toMatch(/named pipe/);
		});

		it('maps invalid-socket-path to a short, non-colliding path', () => {
			const mapped = mapControllerError(
				new InvalidSocketPathError('/x/y.sock', 'it is too long.'),
				'webhands',
			);
			expect(mapped?.code).toBe('invalid-socket-path');
			expect(mapped?.message).toMatch(/--socket ~\/\.webhands\/session\.sock/);
		});
	});

	describe('shared-write isolation', () => {
		it('a socket-served CLI run never touches the real ~/.webhands', async () => {
			const realHome = join(homedir(), '.webhands');
			const before = await listing(realHome);

			const root = await tempRoot();
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{
					root,
					transport: new StubTransport(),
					socketPath: join(root, 'session.sock'),
				},
			);
			running.push(server);
			await runEnvelope(root, ['goto', 'https://example.test/']);

			expect(await listing(realHome)).toEqual(before);
			expect((await readdir(root)).sort()).toEqual(
				['session-endpoint.json', 'session.sock'].sort(),
			);
		});
	});
});

/** The sorted entries of a directory, or `undefined` when it does not exist. */
async function listing(path: string): Promise<string[] | undefined> {
	try {
		return (await readdir(path)).sort();
	} catch {
		return undefined;
	}
}
