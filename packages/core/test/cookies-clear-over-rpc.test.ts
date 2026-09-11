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
 * `cookies clear` over the long-lived session RPC (ADR-0005), in two layers
 * (mirroring `frame-scoped-eval-over-rpc.test.ts`):
 *
 * 1. RPC DISPATCH in isolation (no browser): the filter crosses as plain JSON,
 *    the REMOVED COUNT crosses back, and the SERVER re-validates, so an untyped
 *    client cannot POST `{filter: {}}` and have a live logged-in session's whole
 *    cookie jar wiped. That server-side refusal is the load-bearing one: the
 *    typed client's own check is just an early fail.
 *
 * 2. END-TO-END over a LIVE SERVED SESSION (real browser, local fixture): the
 *    same path the CLI verb and the MCP tool drive, proving the recovery works
 *    from a thin client and the count it reports is the browser's own.
 *
 * Shared-write isolation: the served session's profile + endpoint roots point at
 * per-test temp dirs; nothing here touches the real `~/.webhands`.
 */
describe('cookies clear RPC dispatch (no browser)', () => {
	/** A fake page recording the verb + args each dispatch routes to it. */
	function recordingPage(cleared = 4): {
		page: WebHandsPage;
		calls: {verb: string; args: readonly unknown[]}[];
	} {
		const calls: {verb: string; args: readonly unknown[]}[] = [];
		const page = {
			async clearCookies(filter: unknown) {
				calls.push({verb: 'clearCookies', args: [filter]});
				return cleared;
			},
		} as unknown as WebHandsPage;
		return {page, calls};
	}

	it('routes the filter to the page and carries the removed count back', async () => {
		const {page, calls} = recordingPage(4);
		const value = await applySessionRpc(page, {
			verb: 'clearCookies',
			filter: {names: ['_abck', 'bm_sz']},
		});
		// The COUNT is the wire value: a thin client must be able to tell "removed
		// 4" from "matched nothing".
		expect(value).toBe(4);
		expect(calls).toEqual([
			{verb: 'clearCookies', args: [{names: ['_abck', 'bm_sz']}]},
		]);
	});

	it('the SERVER refuses an empty filter from an untyped client', async () => {
		const {page, calls} = recordingPage();
		await expect(
			applySessionRpc(page, {verb: 'clearCookies', filter: {}}),
		).rejects.toThrow(/refusing to clear with an empty filter/i);
		// The page was never reached, so nothing could have been cleared.
		expect(calls).toEqual([]);
	});

	it('the SERVER refuses a misshapen filter from an untyped client', async () => {
		const {page, calls} = recordingPage();
		await expect(
			applySessionRpc(page, {
				verb: 'clearCookies',
				// A raw client's plausible typo: the singular key.
				filter: {name: '_abck'} as never,
			}),
		).rejects.toThrow(/unknown filter option "name"/i);
		expect(calls).toEqual([]);
	});

	it('the typed client builds the request through the shared send', async () => {
		const sent: SessionRpcRequest[] = [];
		const send = async (request: SessionRpcRequest): Promise<unknown> => {
			sent.push(request);
			return 2;
		};
		const page = makeRpcPage(send);
		const cleared = await page.clearCookies({names: ['_abck'], path: '/'});
		expect(cleared).toBe(2);
		expect(sent).toEqual([
			{verb: 'clearCookies', filter: {names: ['_abck'], path: '/'}},
		]);
	});

	it('the typed client fails fast on an empty filter (no round-trip)', async () => {
		const sent: SessionRpcRequest[] = [];
		const page = makeRpcPage(async (request) => {
			sent.push(request);
			return 0;
		});
		await expect(page.clearCookies({})).rejects.toThrow(
			/refusing to clear with an empty filter/i,
		);
		expect(sent).toEqual([]);
	});
});

describe('cookies clear over a live served session (real browser, fixture)', () => {
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
		const root = await mkdtemp(join(tmpdir(), 'mbc-cookies-clear-rpc-'));
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

	it('a thin client clears the named cookies and keeps the login', async () => {
		const server = await startServer('cookies-clear-rpc');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/index.html`);
			const host = new URL(fixture.url).hostname;
			await client.page.setCookies([
				{name: '_abck', value: 'tripped', domain: host, path: '/'},
				{name: 'bm_sz', value: 'sz', domain: host, path: '/'},
				{
					name: 'ASP.NET_SessionId',
					value: 'logged-in',
					domain: host,
					path: '/',
				},
			]);

			const cleared = await client.page.clearCookies({
				names: ['_abck', 'bm_sz', 'bm_sv', 'ak_bmsc'],
			});

			// Two of the four names were present; the count is the browser's own
			// before/after difference, not the size of the filter.
			expect(cleared).toBe(2);
			const left = await client.page.cookies();
			expect(left.map((c) => c.name)).toEqual(['ASP.NET_SessionId']);
		} finally {
			await client.close();
		}
	});

	it('refuses an empty filter over the wire, leaving the session intact', async () => {
		const server = await startServer('cookies-clear-rpc-empty');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/index.html`);
			const host = new URL(fixture.url).hostname;
			await client.page.setCookies([
				{
					name: 'ASP.NET_SessionId',
					value: 'logged-in',
					domain: host,
					path: '/',
				},
			]);

			await expect(client.page.clearCookies({})).rejects.toThrow(
				/refusing to clear with an empty filter/i,
			);

			const left = await client.page.cookies();
			expect(left.map((c) => c.name)).toEqual(['ASP.NET_SessionId']);
		} finally {
			await client.close();
		}
	});
});
