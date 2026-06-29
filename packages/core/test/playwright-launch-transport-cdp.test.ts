import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
} from '../src/index.js';

/**
 * Serve-side CDP EXPOSURE for the SHARED driving surface (task
 * `eval-baseline-shared-driving-surface-over-cdp`; finding
 * `baseline-comparison-needs-a-shared-driving-surface-not-two-browsers`).
 *
 * When the launch transport is constructed with `exposeCdp: true`, the browser
 * it launches advertises a Chromium CDP / remote-debugging endpoint, and a
 * SEPARATE Playwright client can `chromium.connectOverCDP(<endpoint>)` and drive
 * the SAME live page the transport serves. That shared surface is what lets the
 * eval harness read the page a Playwright-only agent drove, regardless of
 * toolkit.
 *
 * These drive a REAL local Chromium against the local fixture (deterministic,
 * never a third-party site) and isolate every profile under a temp root (the
 * real `~/.webhands` is never touched).
 */
describe('PlaywrightLaunchTransport CDP exposure (real Chromium, shared driving surface)', () => {
	let server: FixtureServer;
	const tempRoots: string[] = [];

	beforeAll(async () => {
		server = await startFixtureServer();
	});

	afterAll(async () => {
		await server.close();
	});

	afterEach(async () => {
		while (tempRoots.length > 0) {
			const dir = tempRoots.pop()!;
			await rm(dir, {recursive: true, force: true});
		}
	});

	async function makeSetUpProfile(
		name = 'default',
		exposeCdp = true,
	): Promise<{root: string; transport: PlaywrightLaunchTransport}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-cdp-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		return {
			root,
			transport: new PlaywrightLaunchTransport({root}, [], {exposeCdp}),
		};
	}

	it('exposes no CDP endpoint until a session is opened', async () => {
		const {transport} = await makeSetUpProfile('before-open');
		expect(transport.cdpEndpoint()).toBeUndefined();
	});

	it('advertises a loopback CDP endpoint after a launch with exposeCdp', async () => {
		const {transport} = await makeSetUpProfile('endpoint-shape');
		const session = await transport.open({
			mode: 'launch',
			profile: 'endpoint-shape',
		});
		try {
			const endpoint = transport.cdpEndpoint();
			expect(endpoint).toBeDefined();
			// A loopback http remote-debugging URL a Playwright client can connect to.
			expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		} finally {
			await session.close();
		}
	});

	it('does NOT advertise a CDP endpoint when exposeCdp is off (default)', async () => {
		const {transport} = await makeSetUpProfile('no-expose', false);
		const session = await transport.open({
			mode: 'launch',
			profile: 'no-expose',
		});
		try {
			expect(transport.cdpEndpoint()).toBeUndefined();
		} finally {
			await session.close();
		}
	});

	it('lets a SEPARATE Playwright client connectOverCDP and drive the SAME live page', async () => {
		const {transport} = await makeSetUpProfile('shared-surface');
		const session = await transport.open({
			mode: 'launch',
			profile: 'shared-surface',
		});
		try {
			const endpoint = transport.cdpEndpoint();
			expect(endpoint).toBeDefined();

			// Stand in for the Playwright-only AGENT: a separate Playwright process
			// connectOverCDP-s to the shared browser and drives its existing page.
			const agentBrowser = await chromium.connectOverCDP(endpoint!);
			try {
				const agentContext = agentBrowser.contexts()[0];
				expect(agentContext).toBeDefined();
				const agentPage =
					agentContext!.pages()[0] ?? (await agentContext!.newPage());
				await agentPage.goto(server.url);
				// Mutate the page through the agent's connection.
				await agentPage.evaluate(
					`window.localStorage.setItem('mbc-agent-drove', 'yes')`,
				);
			} finally {
				// Disconnect WITHOUT closing the shared browser (connectOverCDP detaches).
				await agentBrowser.close();
			}

			// The HARNESS reads the SAME page through its OWN session: it sees the
			// agent's navigation + mutation, proving a single shared surface.
			const snap = await session.page.snapshot();
			expect(snap.url).toBe(`${server.url}/`);
			const marker = await session.page.eval(
				`window.localStorage.getItem('mbc-agent-drove')`,
			);
			expect(marker).toBe('yes');
		} finally {
			await session.close();
		}
	});
});
