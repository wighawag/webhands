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
 * The Tier-1 `query` + state verbs over the long-lived session RPC (ADR-0005),
 * in two layers, mirroring `agent-exposed-hand-verb-over-rpc.test.ts`:
 *
 * 1. RPC DISPATCH in isolation (no browser): `applySessionRpc` routes each new
 *    built-in request 1:1 to its {@link WebHandsPage} method, re-branding the
 *    plain-JSON locator, and carries the typed options + result faithfully.
 *
 * 2. END-TO-END over a LIVE SERVED SESSION (real browser, local fixture): a
 *    thin client drives the served page; the structured `query` rows (and the
 *    state-verb results) cross the wire by structured clone with NO
 *    Playwright/CDP type leak (the same contract `eval` holds, ADR-0003).
 *
 * Shared-write isolation: the served session's profile + endpoint roots point
 * at per-test temp dirs; nothing here touches the real `~/.webhands`.
 */
describe('query/state RPC dispatch (no browser)', () => {
	/** A fake page recording the verb + args each dispatch routes to it. */
	function recordingPage(): {
		page: WebHandsPage;
		calls: {verb: string; args: readonly unknown[]}[];
	} {
		const calls: {verb: string; args: readonly unknown[]}[] = [];
		const page = {
			async query(target: string, options: unknown) {
				calls.push({verb: 'query', args: [target, options]});
				return [{attrs: {href: '/x'}}];
			},
			async count(target: string) {
				calls.push({verb: 'count', args: [target]});
				return 7;
			},
			async exists(target: string) {
				calls.push({verb: 'exists', args: [target]});
				return true;
			},
			async isVisible(target: string) {
				calls.push({verb: 'isVisible', args: [target]});
				return false;
			},
			async getAttribute(target: string, name: string) {
				calls.push({verb: 'getAttribute', args: [target, name]});
				return 'sk-123';
			},
		} as unknown as WebHandsPage;
		return {page, calls};
	}

	it('routes `query` with its options and returns the rows', async () => {
		const {page, calls} = recordingPage();
		const value = await applySessionRpc(page, {
			verb: 'query',
			locator: `page.locator('.x')`,
			options: {attrs: ['href'], pw: ['visible']},
		});
		expect(value).toEqual([{attrs: {href: '/x'}}]);
		expect(calls).toEqual([
			{
				verb: 'query',
				args: [`page.locator('.x')`, {attrs: ['href'], pw: ['visible']}],
			},
		]);
	});

	it('routes the state verbs 1:1 and returns their scalar results', async () => {
		const {page, calls} = recordingPage();
		expect(await applySessionRpc(page, {verb: 'count', locator: 'l'})).toBe(7);
		expect(await applySessionRpc(page, {verb: 'exists', locator: 'l'})).toBe(
			true,
		);
		expect(await applySessionRpc(page, {verb: 'isVisible', locator: 'l'})).toBe(
			false,
		);
		expect(
			await applySessionRpc(page, {
				verb: 'getAttribute',
				locator: 'l',
				name: 'data-sitekey',
			}),
		).toBe('sk-123');
		expect(calls.map((c) => c.verb)).toEqual([
			'count',
			'exists',
			'isVisible',
			'getAttribute',
		]);
		// `getAttribute` carries the attribute name through the wire.
		expect(calls[3]?.args).toEqual(['l', 'data-sitekey']);
	});

	it('the typed client builds each request through the shared send', async () => {
		const sent: SessionRpcRequest[] = [];
		const send = async (request: SessionRpcRequest): Promise<unknown> => {
			sent.push(request);
			if (request.verb === 'query') return [];
			if (request.verb === 'count') return 0;
			if (request.verb === 'exists') return false;
			if (request.verb === 'isVisible') return false;
			if (request.verb === 'getAttribute') return null;
			return undefined;
		};
		const page = makeRpcPage(send);
		await page.query('l' as never, {props: ['innerText']});
		await page.count('l' as never);
		await page.exists('l' as never);
		await page.isVisible('l' as never);
		await page.getAttribute('l' as never, 'href');
		expect(sent).toEqual([
			{verb: 'query', locator: 'l', options: {props: ['innerText']}},
			{verb: 'count', locator: 'l'},
			{verb: 'exists', locator: 'l'},
			{verb: 'isVisible', locator: 'l'},
			{verb: 'getAttribute', locator: 'l', name: 'href'},
		]);
	});
});

describe('query/state verbs over a live served session (real browser, fixture)', () => {
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
		const root = await mkdtemp(join(tmpdir(), 'mbc-query-rpc-'));
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

	it('query rows cross the wire by structured clone with no type leak', async () => {
		const server = await startServer('query-rpc');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/query-list.html`);

			const rows = await client.page.query(`page.locator('.result')` as never, {
				attrs: ['data-asin'],
				props: ['innerText'],
				pw: ['visible'],
			});
			expect(rows).toHaveLength(3);
			expect(rows.map((r) => r.attrs?.['data-asin'])).toEqual([
				'A001',
				'B002',
				'C003',
			]);
			expect(rows[0]?.props?.['innerText']).toContain('Alpha Widget');
			expect(rows[0]?.pw?.visible).toBe(true);
			// The whole result is plain JSON-cloneable (no Playwright handle leaked).
			expect(() => structuredClone(rows)).not.toThrow();

			// State verbs over the same RPC.
			expect(await client.page.count(`page.locator('.result')` as never)).toBe(
				3,
			);
			expect(await client.page.exists(`page.locator('.absent')` as never)).toBe(
				false,
			);
			expect(
				await client.page.isVisible(`page.locator('#hidden-row')` as never),
			).toBe(false);
			expect(
				await client.page.getAttribute(
					`page.locator('#hidden-row')` as never,
					'data-sitekey',
				),
			).toBe('sk-hidden-123');
		} finally {
			await client.close();
		}
	});
});
