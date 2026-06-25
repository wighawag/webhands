import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	clearSessionEndpoint,
	connectRemoteSession,
	readSessionEndpoint,
	resolveSessionEndpointPath,
	SessionAlreadyActiveError,
	sessionAlreadyActive,
	startSessionServer,
	StubTransport,
	writeSessionEndpoint,
	type RunningSessionServer,
} from '../src/index.js';

/**
 * Fast, browser-free coverage of the persistence INFRASTRUCTURE shapes:
 * endpoint discovery (write/read/clear, malformed-as-absent), the served
 * session-RPC round-trip against the in-process `StubTransport`, the
 * single-session "already active" refusal, and the proxy `close()` being a
 * no-op. Behaviour against a REAL browser/fixture is the separate persistence
 * seam test; this one nails the deterministic edges without launching Chromium.
 *
 * Every test points its config root at a temp dir, so the real
 * `~/.webhands` is never touched.
 */
describe('session endpoint discovery + served RPC (stub transport)', () => {
	const tempRoots: string[] = [];
	const running: RunningSessionServer[] = [];

	afterEach(async () => {
		while (running.length > 0) await running.pop()!.stop();
		while (tempRoots.length > 0)
			await rm(tempRoots.pop()!, {recursive: true, force: true});
	});

	async function tempRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-endpoint-'));
		tempRoots.push(root);
		return root;
	}

	describe('endpoint file', () => {
		it('writes, reads back, and clears the advertised endpoint', async () => {
			const root = await tempRoot();
			expect(await readSessionEndpoint({root})).toBeUndefined();

			const endpoint = {url: 'http://127.0.0.1:51234', pid: 4242};
			const path = await writeSessionEndpoint(endpoint, {root});
			expect(path).toBe(resolveSessionEndpointPath({root}));
			await expect(stat(path)).resolves.toBeDefined();
			expect(await readSessionEndpoint({root})).toEqual(endpoint);

			await clearSessionEndpoint({root});
			expect(await readSessionEndpoint({root})).toBeUndefined();
		});

		it('treats a malformed endpoint file as "no live server" (no crash)', async () => {
			const root = await tempRoot();
			const {writeFile, mkdir} = await import('node:fs/promises');
			await mkdir(root, {recursive: true});
			await writeFile(resolveSessionEndpointPath({root}), 'not json', 'utf8');
			expect(await readSessionEndpoint({root})).toBeUndefined();
		});

		it('clearing an absent endpoint file is not an error', async () => {
			const root = await tempRoot();
			await expect(clearSessionEndpoint({root})).resolves.toBeUndefined();
		});
	});

	describe('served session over the stub transport', () => {
		it('drives the live stub page over HTTP and records the verb round-trip', async () => {
			const root = await tempRoot();
			const transport = new StubTransport();
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport},
			);
			running.push(server);

			const client = connectRemoteSession(server.endpoint.url);
			await client.page.navigate('https://example.test/');
			await client.page.click("getByRole('button')" as never);
			await client.close();

			// The verbs reached the ONE live stub session the server opened (not a
			// fresh session per call): both calls land on the same transport.
			expect(transport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/']},
				{verb: 'click', args: ["getByRole('button')"]},
			]);
		});

		it('a thin-client close() does NOT close the served session', async () => {
			const root = await tempRoot();
			const transport = new StubTransport();
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport},
			);
			running.push(server);

			const client1 = connectRemoteSession(server.endpoint.url);
			await client1.page.navigate('https://example.test/a');
			await client1.close();

			// A second client still drives the SAME live session after the first
			// closed (the stub rejects verbs only after ITS session.close, which the
			// proxy never calls).
			const client2 = connectRemoteSession(server.endpoint.url);
			await client2.page.navigate('https://example.test/b');
			await client2.close();

			expect(transport.calls.map((c) => c.args[0])).toEqual([
				'https://example.test/a',
				'https://example.test/b',
			]);
		});

		it('the single-session guard names the "already active" refusal', () => {
			const error = sessionAlreadyActive();
			expect(error).toBeInstanceOf(SessionAlreadyActiveError);
			expect(error.code).toBe('session-already-active');
			expect(error.message).toMatch(/already active/i);
		});
	});
});
