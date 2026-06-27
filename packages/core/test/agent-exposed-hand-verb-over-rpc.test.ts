import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	applySessionRpc,
	callHandVerb,
	connectRemoteSession,
	DEFAULT_HOME_DIRNAME,
	HANDS_CONFIG_FILENAME,
	loadHands,
	PlaywrightLaunchTransport,
	readHandsConfig,
	resolveProfileLocation,
	resolveSessionEndpointPath,
	SESSION_ENDPOINT_FILENAME,
	startFixtureServer,
	startSessionServer,
	type FixtureServer,
	type Hand,
	type WebHandsPage,
	type RunningSessionServer,
	type SessionRpcRequest,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC_HAND_ENTRY = join(HERE, 'fixtures', 'hands', 'rpc-hand.mjs');

/**
 * Phase-2 Model B (ADR-0007): a hand-contributed verb surfaced to the AGENT as
 * a verb over the long-lived session RPC. Coverage in two layers:
 *
 * 1. RPC DISPATCH in isolation (no browser): `applySessionRpc` routes the
 *    generic `{verb: 'hand', name, args}` request to the named hand verb on the
 *    composed page, returns its result, and faithfully surfaces an in-hand throw
 *    and an unknown-verb error. This is the SINGLE shared dispatch the server
 *    handler is built on.
 *
 * 2. END-TO-END over a LIVE SERVED SESSION (real browser, local fixture): a
 *    fixture hand authored against the public `Hand` contract is loaded via the
 *    explicit mechanism and composed into the served session; the agent invokes
 *    its verb over the wire and asserts the serializable result, a throwing hand
 *    verb is asserted to reject on the client with a faithful message, and the
 *    built-in verbs still work over the same RPC (the shape stays one source of
 *    truth). The agent never holds a live page handle.
 *
 * Shared-write isolation: the served session's profile root AND the endpoint
 * file both point at per-test temp dirs; the suite asserts the real
 * `~/.webhands` is untouched.
 */

describe('hand-verb RPC dispatch (no browser)', () => {
	/** A fake composed page: the seam built-ins plus a dynamic hand verb. */
	function fakePageWithHandVerb(): WebHandsPage {
		const page = {
			async navigate() {},
			async snapshot() {
				return {
					url: 'about:blank',
					view: 'accessibility',
					content: '',
				} as const;
			},
			async click() {},
			async type() {},
			async eval() {
				return undefined;
			},
			async wait() {},
			async cookies() {
				return [];
			},
			async setCookies() {},
			// The dynamically-contributed hand verb lives on the runtime object
			// alongside the built-ins, exactly as the host composes it in.
			async greet(name: string): Promise<{readonly hello: string}> {
				return {hello: `hi ${name}`};
			},
		};
		return page as unknown as WebHandsPage;
	}

	it('routes a `hand` request to the named verb and returns its serializable result', async () => {
		const value = await applySessionRpc(fakePageWithHandVerb(), {
			verb: 'hand',
			name: 'greet',
			args: ['agent'],
		});
		expect(value).toEqual({hello: 'hi agent'});
	});

	it('faithfully propagates an in-hand throw (so the client rejects)', async () => {
		const page = {
			async boom(): Promise<never> {
				throw new Error('kaboom');
			},
		} as unknown as WebHandsPage;
		await expect(
			applySessionRpc(page, {verb: 'hand', name: 'boom', args: []}),
		).rejects.toThrow('kaboom');
	});

	it('rejects an unknown hand verb name with a faithful error', async () => {
		await expect(
			applySessionRpc(fakePageWithHandVerb(), {
				verb: 'hand',
				name: 'notLoaded',
				args: [],
			}),
		).rejects.toThrow(/no such hand verb 'notLoaded'/);
	});

	it('the client helper builds the single generic hand request via the shared send', async () => {
		const sent: SessionRpcRequest[] = [];
		const send = async (request: SessionRpcRequest): Promise<unknown> => {
			sent.push(request);
			return {echoed: request.verb === 'hand' ? request.name : undefined};
		};
		const result = await callHandVerb(send, 'greet', 'agent', 7);
		expect(sent).toEqual([{verb: 'hand', name: 'greet', args: ['agent', 7]}]);
		expect(result).toEqual({echoed: 'greet'});
	});
});

describe('hand verb over a live served session (real browser, fixture)', () => {
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
		while (running.length > 0) {
			await running.pop()!.stop();
		}
		while (tempRoots.length > 0) {
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
	});

	/**
	 * Start a long-lived served session whose launch transport composes the
	 * loaded hands, over an isolated temp profile + endpoint root.
	 */
	async function startServerWithHands(
		profile: string,
		hands: readonly Hand[],
	): Promise<RunningSessionServer> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-handrpc-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const server = await startSessionServer(
			{mode: 'launch', profile},
			{root, transport: new PlaywrightLaunchTransport({root}, hands)},
		);
		running.push(server);
		return server;
	}

	it('loads a hand, surfaces its verb over the RPC, and returns a serializable result; built-ins still work', async () => {
		// Load through the PUBLIC explicit mechanism from an isolated temp config.
		const cfgRoot = await mkdtemp(join(tmpdir(), 'mbc-handrpc-cfg-'));
		tempRoots.push(cfgRoot);
		await writeFile(
			join(cfgRoot, HANDS_CONFIG_FILENAME),
			JSON.stringify({
				hands: [{name: 'rpc', source: 'npm:rpc-hand', entry: RPC_HAND_ENTRY}],
			}),
		);
		const loaded = await loadHands(await readHandsConfig(cfgRoot), {
			baseDir: cfgRoot,
		});
		expect(loaded.map((l) => l.entry.name)).toEqual(['rpc']);

		const server = await startServerWithHands(
			'rpc-hand-profile',
			loaded.map((l) => l.hand),
		);

		// The agent connects as a thin client and is told which hand verbs the
		// served process loaded; it never holds a live page handle.
		const client = connectRemoteSession(server.endpoint.url, [
			'readMarker',
			'boom',
		]);
		try {
			// A built-in verb works over the same RPC (the shape is one source of
			// truth: built-ins and the hand verb share the dispatch).
			await client.page.navigate(`${fixture.url}/eval.html`);
			const snap = await client.page.snapshot();
			expect(snap.url).toBe(`${fixture.url}/eval.html`);

			// The hand verb is invoked over the wire; its argument reaches the served
			// hand and a SERIALIZABLE structured result crosses back by value.
			const pageWithHand = client.page as unknown as {
				readMarker(suffix: string): Promise<{
					marker: string | null;
					suffix: string;
					ok: boolean;
				}>;
			};
			const result = await pageWithHand.readMarker('tail');
			expect(result).toEqual({
				marker: 'marker-value',
				suffix: 'tail',
				ok: true,
			});
		} finally {
			await client.close();
		}
	});

	it('a throwing hand verb rejects on the client with a faithful message', async () => {
		const cfgRoot = await mkdtemp(join(tmpdir(), 'mbc-handrpc-boom-cfg-'));
		tempRoots.push(cfgRoot);
		await writeFile(
			join(cfgRoot, HANDS_CONFIG_FILENAME),
			JSON.stringify({hands: [{name: 'rpc', entry: RPC_HAND_ENTRY}]}),
		);
		const loaded = await loadHands(await readHandsConfig(cfgRoot), {
			baseDir: cfgRoot,
		});

		const server = await startServerWithHands(
			'rpc-hand-boom',
			loaded.map((l) => l.hand),
		);
		const client = connectRemoteSession(server.endpoint.url, ['boom']);
		try {
			await client.page.navigate(`${fixture.url}/index.html`);
			const pageWithHand = client.page as unknown as {
				boom(): Promise<never>;
			};
			// The in-hand throw rejects faithfully on the client, exactly as the
			// `eval` RPC path does (a page/in-hand throw must REJECT remotely).
			await expect(pageWithHand.boom()).rejects.toThrow('hand verb exploded');
		} finally {
			await client.close();
		}
	});

	it('isolates profile + endpoint paths to temp roots; the real ~/.webhands is untouched', async () => {
		const realHome = join(homedir(), DEFAULT_HOME_DIRNAME);
		const realEndpointPath = resolveSessionEndpointPath();
		const realHomeExistedBefore = existsSync(realHome);
		const realEndpointExistedBefore = existsSync(realEndpointPath);

		const cfgRoot = await mkdtemp(join(tmpdir(), 'mbc-handrpc-iso-cfg-'));
		tempRoots.push(cfgRoot);
		await writeFile(
			join(cfgRoot, HANDS_CONFIG_FILENAME),
			JSON.stringify({hands: [{name: 'rpc', entry: RPC_HAND_ENTRY}]}),
		);
		const loaded = await loadHands(await readHandsConfig(cfgRoot), {
			baseDir: cfgRoot,
		});

		// The server's root is the temp dir the helper allocates.
		const beforeRoots = tempRoots.length;
		const server = await startServerWithHands(
			'rpc-hand-iso',
			loaded.map((l) => l.hand),
		);
		const serverRoot = tempRoots[beforeRoots]!;

		const client = connectRemoteSession(server.endpoint.url, ['readMarker']);
		await client.page.navigate(`${fixture.url}/eval.html`);
		await client.close();

		// The endpoint file lives under the temp server root, not the real home.
		const tempEndpoint = resolveSessionEndpointPath({root: serverRoot});
		expect(tempEndpoint.startsWith(serverRoot)).toBe(true);
		expect(existsSync(tempEndpoint)).toBe(true);
		expect(await readdir(serverRoot)).toContain(SESSION_ENDPOINT_FILENAME);

		// The real shared locations are untouched by this run.
		expect(existsSync(realHome)).toBe(realHomeExistedBefore);
		expect(existsSync(realEndpointPath)).toBe(realEndpointExistedBefore);
	});
});
