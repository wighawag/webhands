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
 * The Tier-2 rich input verbs (`press`/`hover`/`select`/`scroll`/`drag`) over
 * the long-lived session RPC (ADR-0005), in two layers, mirroring
 * `query-verbs-over-rpc.test.ts`:
 *
 * 1. RPC DISPATCH in isolation (no browser): `applySessionRpc` routes each new
 *    built-in request 1:1 to its {@link WebHandsPage} method, re-branding the
 *    plain-JSON locator(s)/scroll target, and the typed client builds each
 *    request through the shared `send`.
 *
 * 2. END-TO-END over a LIVE SERVED SESSION (real browser, local fixture): a
 *    thin client drives the served page; the verbs fire their effects through
 *    the wire with NO Playwright/CDP type crossing (keys/offsets/locators are
 *    strings/numbers, ADR-0003).
 *
 * Shared-write isolation: the served session's profile + endpoint roots point
 * at per-test temp dirs; nothing here touches the real `~/.webhands`.
 */
describe('input-verb RPC dispatch (no browser)', () => {
	/** A fake page recording the verb + args each dispatch routes to it. */
	function recordingPage(): {
		page: WebHandsPage;
		calls: {verb: string; args: readonly unknown[]}[];
	} {
		const calls: {verb: string; args: readonly unknown[]}[] = [];
		const page = {
			async press(key: string, target: unknown) {
				calls.push({verb: 'press', args: [key, target]});
			},
			async hover(target: string) {
				calls.push({verb: 'hover', args: [target]});
			},
			async select(target: string, choice: unknown) {
				calls.push({verb: 'select', args: [target, choice]});
			},
			async scroll(target: unknown) {
				calls.push({verb: 'scroll', args: [target]});
			},
			async drag(source: string, target: string) {
				calls.push({verb: 'drag', args: [source, target]});
			},
		} as unknown as WebHandsPage;
		return {page, calls};
	}

	it('routes `press` with an optional locator (and the focused-element form)', async () => {
		const {page, calls} = recordingPage();
		await applySessionRpc(page, {
			verb: 'press',
			key: 'Control+a',
			locator: `page.locator('#x')`,
		});
		await applySessionRpc(page, {verb: 'press', key: 'Enter'});
		expect(calls).toEqual([
			{verb: 'press', args: ['Control+a', `page.locator('#x')`]},
			// No locator -> the focused-element form (undefined target).
			{verb: 'press', args: ['Enter', undefined]},
		]);
	});

	it('routes hover/select/scroll/drag 1:1, re-branding their locators', async () => {
		const {page, calls} = recordingPage();
		await applySessionRpc(page, {verb: 'hover', locator: 'h'});
		await applySessionRpc(page, {
			verb: 'select',
			locator: 's',
			choice: {label: 'Blue'},
		});
		await applySessionRpc(page, {verb: 'scroll', target: {to: 'far'}});
		await applySessionRpc(page, {
			verb: 'scroll',
			target: {by: {dx: 0, dy: 400}},
		});
		await applySessionRpc(page, {verb: 'drag', source: 'a', target: 'b'});
		expect(calls).toEqual([
			{verb: 'hover', args: ['h']},
			{verb: 'select', args: ['s', {label: 'Blue'}]},
			{verb: 'scroll', args: [{to: 'far'}]},
			{verb: 'scroll', args: [{by: {dx: 0, dy: 400}}]},
			{verb: 'drag', args: ['a', 'b']},
		]);
	});

	it('the typed client builds each request through the shared send', async () => {
		const sent: SessionRpcRequest[] = [];
		const send = async (request: SessionRpcRequest): Promise<unknown> => {
			sent.push(request);
			return undefined;
		};
		const page = makeRpcPage(send);
		await page.press('a', `page.locator('#x')` as never);
		await page.press('Enter');
		await page.hover('h' as never);
		await page.select('s' as never, {value: 'g'});
		await page.scroll({to: 'far' as never});
		await page.scroll({by: {dx: -10, dy: 20}});
		await page.drag('a' as never, 'b' as never);
		expect(sent).toEqual([
			{verb: 'press', key: 'a', locator: `page.locator('#x')`},
			// The focused-element form carries NO locator key.
			{verb: 'press', key: 'Enter'},
			{verb: 'hover', locator: 'h'},
			{verb: 'select', locator: 's', choice: {value: 'g'}},
			{verb: 'scroll', target: {to: 'far'}},
			{verb: 'scroll', target: {by: {dx: -10, dy: 20}}},
			{verb: 'drag', source: 'a', target: 'b'},
		]);
	});
});

describe('input verbs over a live served session (real browser, fixture)', () => {
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
		const root = await mkdtemp(join(tmpdir(), 'mbc-input-rpc-'));
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

	it('press / select fire their effects over the wire (no type leak)', async () => {
		const server = await startServer('input-rpc-keys');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/keyboard.html`);
			await client.page.press(
				'Control+a',
				`page.locator('#focus-input')` as never,
			);
			expect(
				await client.page.eval(`document.getElementById('keylog').textContent`),
			).toBe('Control+a');

			await client.page.navigate(`${fixture.url}/select.html`);
			await client.page.select(`page.locator('#color')` as never, {
				label: 'Blue',
			});
			expect(
				await client.page.eval(`document.getElementById('color').value`),
			).toBe('b');
		} finally {
			await client.close();
		}
	}, 15_000);

	it('drag fires the drop handler over the wire', async () => {
		const server = await startServer('input-rpc-drag');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/drag.html`);
			await client.page.drag(
				`page.locator('#drag-source')` as never,
				`page.locator('#drop-target')` as never,
			);
			expect(
				await client.page.eval(
					`document.getElementById('drop-state').textContent`,
				),
			).toBe('dropped');
		} finally {
			await client.close();
		}
	}, 15_000);
});
