import {mkdir, mkdtemp, readdir, rm, stat} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	connectRemoteSession,
	PlaywrightLaunchTransport,
	readSessionEndpoint,
	resolveProfileLocation,
	resolveSessionEndpointPath,
	SESSION_ENDPOINT_FILENAME,
	startSessionServer,
	startFixtureServer,
	type FixtureServer,
	type RunningSessionServer,
} from '../src/index.js';

/**
 * Cross-invocation session persistence (ADR-0005), exercised at the seam this
 * task delivers: a SINGLE long-lived served process holds one live browser
 * session, and TWO separate thin-client connections drive the SAME live page.
 *
 * The "separate CLI invocations" are modelled by TWO independent
 * `connectRemoteSession` clients made against the one running server: each is a
 * distinct connection that opens, runs a verb, and closes — exactly what two
 * separate `webhands <verb>` processes do. The proof of
 * persistence is that LIVE page state set through client #1 (a navigation, an
 * in-page mutation) is observed through client #2, which is only possible if
 * the browser launched ONCE in the server and was never re-launched per call
 * (the on-disk profile alone does not carry live navigation/DOM state).
 *
 * Shared-write isolation: the server's config root (where the endpoint file
 * lives) and the profile root are both pointed at a per-test temp dir; the test
 * asserts the real `~/.webhands` is untouched.
 */
describe('cross-invocation session persistence (real browser, local fixture, seam)', () => {
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

	/** Make an isolated temp config/profile root with the named profile set up. */
	async function isolatedRoot(profile = 'persist'): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-persist-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(profile, {root});
		await mkdir(loc.profileDir, {recursive: true});
		return root;
	}

	/** Start a long-lived server holding one launched session against the profile. */
	async function startServer(
		root: string,
		profile = 'persist',
	): Promise<RunningSessionServer> {
		const server = await startSessionServer(
			{mode: 'launch', profile},
			{root, transport: new PlaywrightLaunchTransport({root})},
		);
		running.push(server);
		return server;
	}

	it('one served process spans two separate client invocations; the second reuses the first live session', async () => {
		const root = await isolatedRoot();
		const server = await startServer(root);

		// --- "invocation 1": a separate client navigates the live page, then exits.
		const client1 = connectRemoteSession(server.endpoint.url);
		await client1.page.navigate(`${fixture.url}/`);
		// A live, in-MEMORY mutation that the on-disk profile would NOT carry: if
		// invocation 2 saw a fresh page it would be gone.
		await client1.page.eval(
			"document.getElementById('status').textContent = 'touched-by-1'",
		);
		await client1.close(); // a thin client closing must NOT tear down the session

		// --- "invocation 2": a DIFFERENT client drives the SAME live page.
		const client2 = connectRemoteSession(server.endpoint.url);
		const snap = await client2.page.snapshot();
		// Same live page: still at the URL invocation 1 navigated to, and still
		// carrying invocation 1's in-page mutation (only possible if the browser
		// was launched once in the server, not per invocation).
		expect(snap.url).toBe(`${fixture.url}/`);
		const status = await client2.page.eval(
			"document.getElementById('status').textContent",
		);
		expect(status).toBe('touched-by-1');
		await client2.close();
	});

	it('is discoverable via the endpoint file and tear-down-able', async () => {
		const root = await isolatedRoot();
		const server = await startServer(root);

		// Discoverable: the endpoint file is written under the config root and
		// readable back as the server's advertised endpoint.
		const endpointPath = resolveSessionEndpointPath({root});
		await expect(stat(endpointPath)).resolves.toBeDefined();
		const advertised = await readSessionEndpoint({root});
		expect(advertised).toEqual(server.endpoint);
		expect(advertised?.url).toBe(server.endpoint.url);

		// Tear-down-able: stop clears the endpoint file (no live server remains).
		await server.stop();
		expect(await readSessionEndpoint({root})).toBeUndefined();
		await expect(stat(endpointPath)).rejects.toThrow();
	});

	it('isolates all on-disk state to the temp root; the real ~/.webhands is untouched', async () => {
		const realEndpointPath = resolveSessionEndpointPath();
		expect(realEndpointPath.startsWith(homedir())).toBe(true);

		// Snapshot whether the real endpoint file exists BEFORE we run.
		const realExistedBefore = await fileExists(realEndpointPath);

		const root = await isolatedRoot();
		const server = await startServer(root);
		const client = connectRemoteSession(server.endpoint.url);
		await client.page.navigate(`${fixture.url}/`);
		await client.close();

		// The endpoint file we created lives under the TEMP root, not the real home.
		const tempEndpoint = resolveSessionEndpointPath({root});
		expect(tempEndpoint.startsWith(root)).toBe(true);
		expect(await fileExists(tempEndpoint)).toBe(true);

		// The real shared location is untouched: our run neither created nor
		// removed the real endpoint file.
		expect(await fileExists(realEndpointPath)).toBe(realExistedBefore);

		// And the only endpoint file anywhere in our run is under the temp root.
		const entries = await readdir(root);
		expect(entries).toContain(SESSION_ENDPOINT_FILENAME);
	});
});

/** True iff `path` exists. */
async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
