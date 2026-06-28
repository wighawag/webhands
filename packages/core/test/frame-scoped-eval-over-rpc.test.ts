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
 * The Tier-3 frame-scoped `eval` over the long-lived session RPC (ADR-0005), in
 * two layers (mirroring `query-verbs-over-rpc.test.ts`):
 *
 * 1. RPC DISPATCH in isolation (no browser): `applySessionRpc` carries the
 *    optional `frame` selector to `page.eval` ONLY when present (a bare
 *    top-document eval sends no `frame`), and the typed client builds the
 *    request through the shared `send`.
 *
 * 2. END-TO-END over a LIVE SERVED SESSION (real browser, local fixture): the
 *    same path the MCP tool drives. A thin client's frame-scoped eval lands in
 *    the SAME-ORIGIN child and returns by structured clone over the wire; a
 *    CROSS-ORIGIN frame rejects faithfully (the loud error message crosses the
 *    wire and re-throws on the client).
 *
 * Shared-write isolation: the served session's profile + endpoint roots point
 * at per-test temp dirs; nothing here touches the real `~/.webhands`.
 */
describe('frame-scoped eval RPC dispatch (no browser)', () => {
	/** A fake page recording the verb + args each dispatch routes to it. */
	function recordingPage(): {
		page: WebHandsPage;
		calls: {verb: string; args: readonly unknown[]}[];
	} {
		const calls: {verb: string; args: readonly unknown[]}[] = [];
		const page = {
			async eval(expression: string, options: unknown) {
				calls.push({verb: 'eval', args: [expression, options]});
				return 'child-value';
			},
		} as unknown as WebHandsPage;
		return {page, calls};
	}

	it('routes a bare eval with NO frame option (backward compatible)', async () => {
		const {page, calls} = recordingPage();
		await applySessionRpc(page, {verb: 'eval', expression: '1 + 1'});
		// No frame => the options arg is `undefined`, not `{frame: undefined}`.
		expect(calls).toEqual([{verb: 'eval', args: ['1 + 1', undefined]}]);
	});

	it('routes a frame-scoped eval, carrying the frame selector', async () => {
		const {page, calls} = recordingPage();
		const value = await applySessionRpc(page, {
			verb: 'eval',
			expression: 'window.__childValue',
			frame: '#main-iframe',
		});
		expect(value).toBe('child-value');
		expect(calls).toEqual([
			{
				verb: 'eval',
				args: ['window.__childValue', {frame: '#main-iframe'}],
			},
		]);
	});

	it('the typed client builds the eval request through the shared send', async () => {
		const sent: SessionRpcRequest[] = [];
		const send = async (request: SessionRpcRequest): Promise<unknown> => {
			sent.push(request);
			return undefined;
		};
		const page = makeRpcPage(send);
		await page.eval('1 + 1');
		await page.eval('window.__childValue', {frame: '#main-iframe'});
		expect(sent).toEqual([
			// No frame key on the top-document form (mirrors `press`'s optional locator).
			{verb: 'eval', expression: '1 + 1'},
			{verb: 'eval', expression: 'window.__childValue', frame: '#main-iframe'},
		]);
	});
});

describe('frame-scoped eval over a live served session (real browser, fixture)', () => {
	let fixture: FixtureServer;
	let crossFixture: FixtureServer;
	const tempRoots: string[] = [];
	const running: RunningSessionServer[] = [];

	beforeAll(async () => {
		fixture = await startFixtureServer();
		// A second origin (different port) for the cross-origin frame.
		crossFixture = await startFixtureServer();
	});

	afterAll(async () => {
		await fixture.close();
		await crossFixture.close();
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
		const root = await mkdtemp(join(tmpdir(), 'mbc-frame-eval-rpc-'));
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

	it('a same-origin frame-scoped eval crosses the wire by structured clone', async () => {
		const server = await startServer('frame-eval-rpc');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/frame-parent.html`);

			// Backward-compatible top-document default over the wire.
			expect(
				await client.page.eval(
					`document.getElementById('top-marker').textContent`,
				),
			).toBe('top-only-value');

			// Frame-scoped read lands in the child and crosses by value.
			expect(
				await client.page.eval('window.__childValue', {
					frame: '#main-iframe',
				}),
			).toBe('runtime-only-child-value');

			const result = await client.page.eval(
				`({ marker: document.getElementById('child-marker').textContent })`,
				{frame: '#main-iframe'},
			);
			expect(result).toEqual({marker: 'child-only-value'});
			// Plain JSON-cloneable: no Playwright handle leaked across the seam.
			expect(() => structuredClone(result)).not.toThrow();
		} finally {
			await client.close();
		}
	});

	it('a cross-origin frame-scoped eval rejects loud over the wire', async () => {
		const server = await startServer('frame-eval-rpc-cross');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/frame-parent.html`);

			// Inject a cross-origin iframe (second origin) and wait for it to load.
			await client.page.eval(
				`(function () {
					return new Promise(function (resolve) {
						var f = document.createElement('iframe');
						f.id = 'cross-iframe';
						f.src = ${JSON.stringify(`${crossFixture.url}/frame-child.html`)};
						f.addEventListener('load', function () { resolve('loaded'); });
						document.body.appendChild(f);
					});
				})()`,
			);

			// The loud cross-origin error message crosses the wire and re-throws on
			// the client (the seam's eval reject contract), never a silent empty.
			await expect(
				client.page.eval('1 + 1', {frame: '#cross-iframe'}),
			).rejects.toThrow(/cross-origin/i);
		} finally {
			await client.close();
		}
	});
});
