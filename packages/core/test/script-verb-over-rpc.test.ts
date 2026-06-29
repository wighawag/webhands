import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	applySessionRpc,
	connectRemoteSession,
	makeRpcPage,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	startSessionServer,
	type FixtureServer,
	type RunningSessionServer,
	type SessionRpcRequest,
	type WebHandsPage,
} from '../src/index.js';

/**
 * The `script` verb over the long-lived session RPC (ADR-0005), in two layers
 * (mirroring `frame-scoped-eval-over-rpc.test.ts`):
 *
 * 1. RPC DISPATCH in isolation (no browser): `applySessionRpc` routes a `script`
 *    request to `page.script`, carrying the optional options object only when
 *    present, and the typed client builds the request through the shared `send`.
 *
 * 2. END-TO-END over a LIVE SERVED SESSION (real browser, local fixture): the
 *    same path the CLI/MCP tool drives. A thin client's driver-context script
 *    runs IN the served process against ITS live page; only the serializable
 *    RETURN crosses the wire (the `page` it drove never does), and a throwing
 *    script rejects faithfully (the message crosses and re-throws on the client).
 *
 * Shared-write isolation: the served session's profile + endpoint roots point at
 * per-test temp dirs; nothing here touches the real `~/.webhands`.
 */
describe('script RPC dispatch (no browser)', () => {
	/** A fake page recording the verb + args each dispatch routes to it. */
	function recordingPage(): {
		page: WebHandsPage;
		calls: {verb: string; args: readonly unknown[]}[];
	} {
		const calls: {verb: string; args: readonly unknown[]}[] = [];
		const page = {
			async script(source: string, options: unknown) {
				calls.push({verb: 'script', args: [source, options]});
				return 'script-value';
			},
		} as unknown as WebHandsPage;
		return {page, calls};
	}

	it('routes a bare script with NO options (carries undefined)', async () => {
		const {page, calls} = recordingPage();
		const value = await applySessionRpc(page, {
			verb: 'script',
			source: `async (page) => page.title()`,
		});
		expect(value).toBe('script-value');
		// No options => the options arg is `undefined`, not `{}`.
		expect(calls).toEqual([
			{verb: 'script', args: [`async (page) => page.title()`, undefined]},
		]);
	});

	it('the typed client builds the script request through the shared send', async () => {
		const sent: SessionRpcRequest[] = [];
		const send = async (request: SessionRpcRequest): Promise<unknown> => {
			sent.push(request);
			return undefined;
		};
		const page = makeRpcPage(send);
		await page.script(`async (page) => page.title()`);
		expect(sent).toEqual([
			// No options key on the bare form (mirrors `eval`'s optional frame).
			{verb: 'script', source: `async (page) => page.title()`},
		]);
	});
});

describe('script over a live served session (real browser, fixture)', () => {
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

	async function startServer(profile: string): Promise<RunningSessionServer> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-script-rpc-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const server = await startSessionServer(
			{mode: 'launch', profile},
			{root, transport: new PlaywrightLaunchTransport({root})},
		);
		running.push(server);
		return server;
	}

	it('runs a driver-context flow over the wire and returns a seam-clean result', async () => {
		const server = await startServer('script-rpc');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/click-type.html`);

			// The whole sub-flow batched into ONE wire call: locate + act + read.
			const result = await client.page.script(
				`async (page) => {
					await page.fill('#query', 'one-turn batch');
					await page.click('#search');
					return {
						typed: await page.locator('#query').inputValue(),
						status: await page.locator('#status').innerText(),
					};
				}`,
			);
			expect(result).toEqual({typed: 'one-turn batch', status: 'clicked'});
			// Plain JSON-cloneable: no Playwright handle leaked across the seam.
			expect(() => structuredClone(result)).not.toThrow();
		} finally {
			await client.close();
		}
	});

	it('a throwing script rejects loud over the wire', async () => {
		const server = await startServer('script-rpc-throws');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/click-type.html`);
			await expect(
				client.page.script(
					`async (page) => { await page.title(); throw new Error('wire boom'); }`,
				),
			).rejects.toThrow('wire boom');
		} finally {
			await client.close();
		}
	});
});
