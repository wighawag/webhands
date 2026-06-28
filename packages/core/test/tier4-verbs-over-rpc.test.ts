import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	applySessionRpc,
	connectRemoteSession,
	makeRpcPage,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	resolveScreenshotsDir,
	startFixtureServer,
	startSessionServer,
	type FixtureServer,
	type RunningSessionServer,
	type Screenshot,
	type SessionRpcRequest,
	type WebHandsPage,
} from '../src/index.js';

/**
 * The Tier-4 verbs (`mouse` / `screenshot`) over the long-lived session RPC
 * (ADR-0005), in two layers, mirroring `input-verbs-over-rpc.test.ts`:
 *
 * 1. RPC DISPATCH in isolation (no browser): `applySessionRpc` routes each new
 *    built-in request 1:1 to its {@link WebHandsPage} method, re-branding the
 *    plain-JSON `screenshot` locator; the typed client builds each request
 *    through the shared `send`.
 *
 * 2. END-TO-END over a LIVE SERVED SESSION (real browser, local fixture): a thin
 *    client drives the served page; `mouse` fires its effect and `screenshot`
 *    returns a PATH (never bytes) over the wire, with NO Playwright/CDP type
 *    crossing (ADR-0003 as amended by the Tier-4 ADR).
 *
 * Shared-write isolation: the served session's profile + screenshots roots point
 * at per-test temp dirs; nothing here touches the real `~/.webhands`.
 */
describe('Tier-4 verb RPC dispatch (no browser)', () => {
	/** A fake page recording the verb + args each dispatch routes to it. */
	function recordingPage(): {
		page: WebHandsPage;
		calls: {verb: string; args: readonly unknown[]}[];
	} {
		const calls: {verb: string; args: readonly unknown[]}[] = [];
		const page = {
			async mouse(input: unknown) {
				calls.push({verb: 'mouse', args: [input]});
			},
			async screenshot(options: unknown): Promise<Screenshot> {
				calls.push({verb: 'screenshot', args: [options]});
				return {path: '/managed/shot.png', width: 2, height: 3};
			},
		} as unknown as WebHandsPage;
		return {page, calls};
	}

	it('routes `mouse` 1:1, carrying the coordinate input', async () => {
		const {page, calls} = recordingPage();
		await applySessionRpc(page, {
			verb: 'mouse',
			input: {action: 'click', x: 12, y: 34, button: 'left'},
		});
		expect(calls).toEqual([
			{verb: 'mouse', args: [{action: 'click', x: 12, y: 34, button: 'left'}]},
		]);
	});

	it('routes `screenshot`, re-branding the element-scope locator', async () => {
		const {page, calls} = recordingPage();
		await applySessionRpc(page, {
			verb: 'screenshot',
			options: {scope: 'element', locator: `page.locator('#w')`},
		});
		// Bare (no options) screenshot too.
		await applySessionRpc(page, {verb: 'screenshot'});
		expect(calls).toEqual([
			{
				verb: 'screenshot',
				args: [{scope: 'element', locator: `page.locator('#w')`}],
			},
			{verb: 'screenshot', args: [undefined]},
		]);
	});

	it('the typed client builds each request through the shared send', async () => {
		const sent: SessionRpcRequest[] = [];
		const send = async (request: SessionRpcRequest): Promise<unknown> => {
			sent.push(request);
			return {path: '/p.png', width: 1, height: 1};
		};
		const page = makeRpcPage(send);
		await page.mouse({action: 'move', x: 5, y: 6});
		await page.screenshot({scope: 'viewport'});
		await page.screenshot();
		expect(sent).toEqual([
			{verb: 'mouse', input: {action: 'move', x: 5, y: 6}},
			{verb: 'screenshot', options: {scope: 'viewport'}},
			// A bare screenshot carries NO options key.
			{verb: 'screenshot'},
		]);
	});
});

describe('Tier-4 verbs over a live served session (real browser, fixture)', () => {
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

	async function startServer(
		profile: string,
	): Promise<{server: RunningSessionServer; root: string}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-tier4-rpc-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const server = await startSessionServer(
			{mode: 'launch', profile},
			{root, transport: new PlaywrightLaunchTransport({root})},
		);
		running.push(server);
		return {server, root};
	}

	it('mouse fires its effect over the wire (no type leak)', async () => {
		const {server} = await startServer('tier4-rpc-mouse');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/coordinate.html`);
			const centre = (await client.page.eval(
				`(function () {
					var r = document.getElementById('hit-target').getBoundingClientRect();
					return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
				})()`,
			)) as {x: number; y: number};
			await client.page.mouse({action: 'click', x: centre.x, y: centre.y});
			expect(
				await client.page.eval(
					`document.getElementById('hit-state').textContent`,
				),
			).toBe('hit');
		} finally {
			await client.close();
		}
	}, 15_000);

	it('screenshot returns a PATH (never bytes) over the wire and writes the PNG', async () => {
		const {server, root} = await startServer('tier4-rpc-shot');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/screenshot.html`);
			const shot = await client.page.screenshot({scope: 'viewport'});
			// The wire carries a path string + numbers, never image bytes.
			expect(typeof shot.path).toBe('string');
			expect(shot.path.startsWith(resolveScreenshotsDir({root}))).toBe(true);
			const bytes = await readFile(shot.path);
			expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
		} finally {
			await client.close();
		}
	}, 15_000);
});
