import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	connectRemoteSession,
	locator,
	readSessionTrace,
	startSessionServer,
	StubTransport,
	type RunningSessionServer,
} from '../src/index.js';

/**
 * The thin-client trace FETCH route (task `distill-verb-emits-hand-scaffold`).
 *
 * The verb trace lives IN-MEMORY in the long-lived `serve` process; the
 * `distill` verb is a thin client in a SEPARATE process (like every other verb),
 * so it reads the SAME session's ordered trace over a read-only HTTP route
 * ({@link readSessionTrace} against `SESSION_TRACE_PATH`) rather than an
 * in-process accessor it cannot reach. This proves the client fetch reconstructs
 * the driven steps in order and stays a pure READ (it never drives the page).
 * Every test points its config root at a temp dir so the real `~/.webhands` is
 * untouched.
 */
describe('session verb trace over the read-only fetch route', () => {
	const tempRoots: string[] = [];
	const running: RunningSessionServer[] = [];

	afterEach(async () => {
		while (running.length > 0) await running.pop()!.stop();
		while (tempRoots.length > 0)
			await rm(tempRoots.pop()!, {recursive: true, force: true});
	});

	async function tempRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-trace-fetch-'));
		tempRoots.push(root);
		return root;
	}

	it('a thin client fetches the SAME session trace it drove, in order', async () => {
		const root = await tempRoot();
		const server = await startSessionServer(
			{mode: 'launch', profile: 'default'},
			{root, transport: new StubTransport()},
		);
		running.push(server);

		// Drive the session as a thin client (a separate logical process)...
		const client = connectRemoteSession(server.endpoint.url);
		await client.page.navigate('https://example.test/');
		await client.page.type(locator('#pass'), '{ENV:PASSWORD}');
		await client.page.click(locator('#submit'));
		await client.close();

		// ...then a DIFFERENT thin client (distill) fetches the trace over HTTP.
		const entries = await readSessionTrace(server.endpoint.url);
		expect(entries.map((e) => e.verb)).toEqual(['navigate', 'type', 'click']);
		// The credential-bearing step still holds only the TOKEN over the wire.
		const typed = entries[1]!.request as {text: string};
		expect(typed.text).toBe('{ENV:PASSWORD}');
		// The fetch matches the server's own in-process view (same ordered steps).
		expect(entries.map((e) => e.verb)).toEqual(
			server.trace.entries().map((e) => e.verb),
		);
	});

	it('returns an empty trace before any verb has driven the session', async () => {
		const root = await tempRoot();
		const server = await startSessionServer(
			{mode: 'launch', profile: 'default'},
			{root, transport: new StubTransport()},
		);
		running.push(server);
		expect(await readSessionTrace(server.endpoint.url)).toEqual([]);
	});
});
