import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	applySessionRpc,
	connectRemoteSession,
	createVerbTrace,
	locator,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	startSessionServer,
	StubTransport,
	verbNameOf,
	type FixtureServer,
	type RunningSessionServer,
	type SessionRpcRequest,
	type WebHandsPage,
} from '../src/index.js';

/**
 * The per-session VERB TRACE (task `serve-session-verb-trace`; prd
 * `distill-session-into-hand`, story 2). `serve` accumulates an ordered,
 * in-memory record of the verbs that drove the live page (verb name + the
 * locator/args as the agent passed them + enough result shape to reconstruct
 * the step). It is the backbone the later `distill` verb reads in-process.
 *
 * Three seams, mirroring the repo's session/RPC test style:
 *
 * 1. The TRACE ACCUMULATOR + the RPC dispatch in isolation (no browser):
 *    `applySessionRpc` records each verb in order with its request-as-passed and
 *    its result; the read-only accessor returns an ordered, copy-safe view; a
 *    `type '<loc>' '{ENV:PASSWORD}'` records the TOKEN (the request is recorded
 *    BEFORE substitution, which happens later in-process). A `StubTransport`
 *    served session proves the SAME accumulation through the whole HTTP path.
 * 2. The NO-SECRET GUARANTEE against a REAL browser + local fixture: a served
 *    session types `{ENV:NAME}`; the RESOLVED secret lands in the page but the
 *    trace records only the token and NEVER the secret, proving substitution
 *    happens downstream of the record.
 * 3. WRITE ISOLATION: the trace is in-memory only; a served session's config
 *    root gains no trace file on disk (only the endpoint file the server already
 *    writes), and every test points its root at a temp dir so the real
 *    `~/.webhands` is untouched.
 */

/** A minimal recording page so the dispatch can run with no browser. */
function recordingPage(): {
	page: WebHandsPage;
	calls: Array<{verb: string; args: readonly unknown[]}>;
} {
	const calls: Array<{verb: string; args: readonly unknown[]}> = [];
	const page = {
		async navigate(url: string): Promise<void> {
			calls.push({verb: 'navigate', args: [url]});
		},
		async click(t: string): Promise<void> {
			calls.push({verb: 'click', args: [t]});
		},
		async type(t: string, text: string): Promise<void> {
			// A no-op recorder: it does NOT substitute {ENV:NAME} (the real
			// substitution lives in the interaction hand's `type` body). What it
			// records is what the RPC handed it, so the assertion below proves the
			// TRACE holds the request's token independent of any substitution.
			calls.push({verb: 'type', args: [t, text]});
		},
		async count(): Promise<number> {
			calls.push({verb: 'count', args: []});
			return 7;
		},
		async script(source: string): Promise<unknown> {
			calls.push({verb: 'script', args: [source]});
			return {ran: source};
		},
	} as unknown as WebHandsPage;
	return {page, calls};
}

describe('per-session verb trace', () => {
	describe('accumulator + RPC dispatch (no browser)', () => {
		it('records verbs IN ORDER with the request as-passed and the result', async () => {
			const trace = createVerbTrace();
			const {page} = recordingPage();

			await applySessionRpc(
				page,
				{verb: 'navigate', url: 'https://a.test/'},
				trace,
			);
			await applySessionRpc(page, {verb: 'click', locator: '#go'}, trace);
			const count = await applySessionRpc(
				page,
				{verb: 'count', locator: '.rows'},
				trace,
			);
			const scripted = await applySessionRpc(
				page,
				{verb: 'script', source: '() => 1'},
				trace,
			);

			// The verbs returned their real values back to the caller...
			expect(count).toBe(7);
			expect(scripted).toEqual({ran: '() => 1'});

			// ...and the trace reconstructs the steps in the order they ran.
			const entries = trace.entries();
			expect(entries.map((e) => e.verb)).toEqual([
				'navigate',
				'click',
				'count',
				'script',
			]);
			// Each entry carries the request AS PASSED (verb + locator/args)...
			expect(entries[0]!.request).toEqual({
				verb: 'navigate',
				url: 'https://a.test/',
			});
			expect(entries[1]!.request).toEqual({verb: 'click', locator: '#go'});
			// ...and enough result shape to reconstruct the step.
			expect(entries[2]!.result).toBe(7);
			expect(entries[3]!.result).toEqual({ran: '() => 1'});
			// A recorded-at timestamp rides along (supplementary to array order).
			expect(typeof entries[0]!.at).toBe('number');
		});

		it('records a `type` {ENV:PASSWORD} as the TOKEN, never a resolved value', async () => {
			const trace = createVerbTrace();
			const {page} = recordingPage();

			await applySessionRpc(
				page,
				{verb: 'type', locator: '#pass', text: '{ENV:PASSWORD}'},
				trace,
			);

			const entry = trace.entries()[0]!;
			expect(entry.verb).toBe('type');
			// The request the trace kept still holds the token (substitution happens
			// later, in-process, in the `type` verb body — downstream of this record).
			expect(entry.request).toEqual({
				verb: 'type',
				locator: '#pass',
				text: '{ENV:PASSWORD}',
			});
		});

		it('names a hand verb by its contributed name, not the wire envelope', () => {
			// The generic hand envelope carries `verb: 'hand'` + the real `name`.
			const req: SessionRpcRequest = {verb: 'hand', name: 'login', args: []};
			expect(verbNameOf(req)).toBe('login');
			expect(verbNameOf({verb: 'click', locator: '#x'})).toBe('click');
		});

		it('does NOT record a verb that THREW (only steps that drove the page)', async () => {
			const trace = createVerbTrace();
			const page = {
				async navigate(): Promise<void> {
					throw new Error('nav boom');
				},
			} as unknown as WebHandsPage;

			await expect(
				applySessionRpc(page, {verb: 'navigate', url: 'x'}, trace),
			).rejects.toThrow('nav boom');
			expect(trace.entries()).toEqual([]);
		});

		it('exposes an ORDERED, copy-safe read-only view (a reader cannot mutate the live trace)', async () => {
			const trace = createVerbTrace();
			const {page} = recordingPage();
			await applySessionRpc(page, {verb: 'click', locator: '#a'}, trace);

			const snapshot = trace.entries();
			expect(snapshot).toHaveLength(1);
			// Mutating the returned array does not affect the live trace.
			(snapshot as unknown as unknown[]).push({bogus: true});
			expect(trace.entries()).toHaveLength(1);

			// A later verb still appends to the live trace (the copy was a snapshot).
			await applySessionRpc(page, {verb: 'click', locator: '#b'}, trace);
			expect(trace.entries().map((e) => e.verb)).toEqual(['click', 'click']);
		});

		it('records nothing when no trace is supplied (the trace is optional)', async () => {
			const {page, calls} = recordingPage();
			// No trace argument: dispatch still works, just records nothing.
			await applySessionRpc(page, {verb: 'navigate', url: 'https://n.test/'});
			expect(calls).toEqual([{verb: 'navigate', args: ['https://n.test/']}]);
		});
	});

	describe('served session over the stub transport (the whole HTTP path)', () => {
		const tempRoots: string[] = [];
		const running: RunningSessionServer[] = [];

		afterEach(async () => {
			while (running.length > 0) await running.pop()!.stop();
			while (tempRoots.length > 0)
				await rm(tempRoots.pop()!, {recursive: true, force: true});
		});

		async function tempRoot(): Promise<string> {
			const root = await mkdtemp(join(tmpdir(), 'mbc-trace-'));
			tempRoots.push(root);
			return root;
		}

		it('accumulates the trace as thin-client verbs drive the ONE served session', async () => {
			const root = await tempRoot();
			const server = await startSessionServer(
				{mode: 'launch', profile: 'default'},
				{root, transport: new StubTransport()},
			);
			running.push(server);

			const client = connectRemoteSession(server.endpoint.url);
			await client.page.navigate('https://example.test/');
			await client.page.type(locator('#pass'), '{ENV:PASSWORD}');
			await client.page.click(locator('#submit'));
			await client.close();

			// The server-owned trace reconstructs the driven steps in order...
			const entries = server.trace.entries();
			expect(entries.map((e) => e.verb)).toEqual(['navigate', 'type', 'click']);
			// ...and the typed credential is the TOKEN in the trace, never a secret.
			const typed = entries[1]!.request as {text: string};
			expect(typed.text).toBe('{ENV:PASSWORD}');
		});
	});
});

describe('verb trace: no-secret guarantee + write isolation (real browser, local fixture)', () => {
	let fixture: FixtureServer;
	const tempRoots: string[] = [];
	const running: RunningSessionServer[] = [];
	const savedEnv: Record<string, string | undefined> = {};

	beforeAll(async () => {
		fixture = await startFixtureServer();
	});

	afterAll(async () => {
		await fixture.close();
	});

	afterEach(async () => {
		while (running.length > 0) await running.pop()!.stop();
		while (tempRoots.length > 0)
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		for (const key of Object.keys(savedEnv)) delete savedEnv[key];
	});

	function setEnv(key: string, value: string): void {
		if (!(key in savedEnv)) savedEnv[key] = process.env[key];
		process.env[key] = value;
	}

	async function startServer(profile: string): Promise<{
		server: RunningSessionServer;
		root: string;
	}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-trace-real-'));
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

	it('records the {ENV:PASSWORD} TOKEN while the RESOLVED secret lands in the page (never in the trace)', async () => {
		// A bespoke var + a value that is NOT the token, so the assertions prove
		// substitution happened in the page but the trace kept only the token.
		const secret = 's3cret-verb-trace-value';
		setEnv('WEBHANDS_TRACE_TEST_PASSWORD', secret);

		const {server} = await startServer('trace-no-secret');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/click-type.html`);
			await client.page.type(
				locator(`page.getByLabel('Query')`),
				'{ENV:WEBHANDS_TRACE_TEST_PASSWORD}',
			);

			// The RESOLVED secret really reached the page (substitution ran)...
			expect(
				await client.page.eval(`document.getElementById('query').value`),
			).toBe(secret);
		} finally {
			await client.close();
		}

		// ...but the trace recorded only the TOKEN for the CREDENTIAL-bearing verb
		// (the `type` request), and the secret appears NOWHERE in what the credential
		// step recorded. (A later READ verb legitimately returns page content as-is,
		// including whatever was typed — that is out of scope by nature per the prd;
		// only the credential class is a placeholder, and that already happened
		// upstream. So the guarantee is scoped to the `type` step, not to every read.)
		const entries = server.trace.entries();
		const typeEntry = entries.find((e) => e.verb === 'type')!;
		expect((typeEntry.request as {text: string}).text).toBe(
			'{ENV:WEBHANDS_TRACE_TEST_PASSWORD}',
		);
		expect(JSON.stringify(typeEntry)).not.toContain(secret);
	});

	it('keeps the trace IN-MEMORY: a served session writes no trace file to the config root', async () => {
		const {server, root} = await startServer('trace-in-memory');
		const client = connectRemoteSession(server.endpoint.url);
		try {
			await client.page.navigate(`${fixture.url}/click-type.html`);
			await client.page.type(locator(`page.getByLabel('Query')`), 'hello');
			await client.page.click(locator(`page.locator('#search')`));
		} finally {
			await client.close();
		}

		// The trace accumulated in memory...
		expect(server.trace.entries().map((e) => e.verb)).toEqual([
			'navigate',
			'type',
			'click',
		]);

		// ...and nothing wrote it to disk: the config root holds only the profile
		// dir and the endpoint file the server already writes, no trace artifact.
		const rootEntries = await readdir(root);
		expect(rootEntries).not.toContain('trace.json');
		expect(rootEntries).not.toContain('verb-trace.json');
	});
});
