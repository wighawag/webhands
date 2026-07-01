import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	connectRemoteSession,
	locator,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	startFixtureServer,
	startSessionServer,
	type FixtureServer,
	type RunningSessionServer,
} from '@webhands/core';
import {createCli} from '../src/index.js';

/**
 * `distill --test` VALIDATION (task `distill-test-validates-scaffold-via-script`;
 * prd `distill-session-into-hand`, story 5).
 *
 * `--test` runs the just-emitted hand scaffold against the LIVE page through the
 * EXISTING `script` verb (ADR-0012) and reports pass/fail LOUDLY. It reuses
 * `script` verbatim: the scaffold's replay, rendered as the driver-context
 * `async (page) => { ... }` shape `script` runs, is executed against the served
 * session; only its serializable result crosses back.
 *
 * This suite drives against a REAL served browser session on the LOCAL FIXTURE
 * page (deterministic, never third-party DOM), mirroring the `script` +
 * `distill` verb test style:
 *
 * - PASS PATH: a good scaffold (its steps match the live page) replays and the
 *   verb reports `test.passed === true`.
 * - FAIL PATH: a broken scaffold (a step targets a locator that is not there)
 *   throws, and the verb reports `test.passed === false` with a typed error
 *   (reusing `script`'s error path), NEVER a silent pass.
 * - The HARD INVARIANT still holds under `--test`: NO `hands.json` is written
 *   anywhere and the module is never loaded; the scaffold + notes land ONLY
 *   under the temp `--out` dir.
 *
 * Every path points at a temp dir so the real `~/.webhands` is untouched.
 */
describe('distill --test: validate the emitted scaffold via `script` (real served page)', () => {
	let fixtures: FixtureServer;
	const tempRoots: string[] = [];
	const tempOuts: string[] = [];
	const running: RunningSessionServer[] = [];

	beforeAll(async () => {
		fixtures = await startFixtureServer();
	});

	afterAll(async () => {
		await fixtures.close();
	});

	afterEach(async () => {
		while (running.length > 0) await running.pop()!.stop();
		while (tempRoots.length > 0)
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		while (tempOuts.length > 0)
			await rm(tempOuts.pop()!, {recursive: true, force: true});
	});

	/**
	 * Bring up a REAL served browser session over a temp home root, land it on the
	 * click-type fixture, and drive `driveTrace(client)` so the server accumulates
	 * a trace `distill` can crystallize + `--test` can replay. Returns the home
	 * root (the CLI reaches the same session by discovering its endpoint there).
	 */
	async function servedFixtureSession(
		driveTrace: (
			client: ReturnType<typeof connectRemoteSession>,
		) => Promise<void>,
		page: 'click-type' | 'select' = 'click-type',
	): Promise<{root: string}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-distill-test-home-'));
		tempRoots.push(root);
		// A launch session needs its profile dir to exist first.
		const loc = resolveProfileLocation('default', {root});
		await mkdir(loc.profileDir, {recursive: true});

		const server = await startSessionServer(
			{mode: 'launch', profile: 'default'},
			{root, transport: new PlaywrightLaunchTransport({root})},
		);
		running.push(server);

		const client = connectRemoteSession(server.endpoint.url);
		await client.page.navigate(`${fixtures.url}/${page}.html`);
		await driveTrace(client);
		await client.close();
		return {root};
	}

	async function runDistill(
		root: string,
		argv: string[],
	): Promise<{
		ok: boolean;
		data?: {
			out: string;
			notes: string;
			steps: number;
			test?: {passed: boolean; result?: unknown; error?: string};
		};
		error?: {code: string; message: string};
	}> {
		const cli = createCli({home: {root}});
		let stdout = '';
		await cli.serve([...argv, '--full-output', '--format', 'json'], {
			stdout: (s) => {
				stdout += s;
			},
			exit: () => {},
			env: {},
		});
		return JSON.parse(stdout);
	}

	async function tempOut(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), 'mbc-distill-test-out-'));
		tempOuts.push(dir);
		return dir;
	}

	it('PASS: a good scaffold replays cleanly and reports test.passed === true', async () => {
		// A faithful sub-flow the fixture supports: type into #query, click #search.
		const {root} = await servedFixtureSession(async (client) => {
			await client.page.type(
				locator(`page.locator('#query')`),
				'flights to BOM',
			);
			await client.page.click(locator(`page.locator('#search')`));
		});
		const outDir = await tempOut();
		const out = join(outDir, 'good.mjs');

		const envelope = await runDistill(root, [
			'distill',
			'--out',
			out,
			'--test',
		]);
		expect(envelope.ok).toBe(true);
		expect(envelope.data!.test).toBeDefined();
		expect(envelope.data!.test!.passed).toBe(true);
		expect(envelope.data!.test!.error).toBeUndefined();
	});

	it('FAIL: a broken scaffold throws and reports test.passed === false with a typed error (never a silent pass)', async () => {
		// A step that SUCCEEDS live (so the trace records it) but FAILS FAST on
		// replay: drive a `select` on the real <select>, then mutate the LIVE page
		// so `#color` is no longer a <select> (an `eval` swaps it for an <input>).
		// Slicing to the `select` step alone, `--test` re-runs
		// `page.locator('#color').selectOption(...)` against the now-<input>, which
		// Playwright rejects FAST ("Element is not a <select>", ~10ms, no 30s wait).
		// `--test` must surface this as a LOUD, typed FAIL via `script`'s error path.
		const {root} = await servedFixtureSession(async (client) => {
			await client.page.select(locator(`page.locator('#color')`), {
				value: 'g',
			});
			// Replace the <select id=color> with an <input id=color> in the live
			// page, so the recorded select step no longer replays cleanly.
			await client.page.eval(
				`(() => { const el = document.getElementById('color'); const inp = document.createElement('input'); inp.id = 'color'; el.replaceWith(inp); return true; })()`,
			);
		}, 'select');
		const outDir = await tempOut();
		const out = join(outDir, 'broken.mjs');

		// Slice to the `select` step alone (index 0 after the leading navigate is
		// index 0; navigate=0, select=1), dropping navigate + the mutating eval.
		const envelope = await runDistill(root, [
			'distill',
			'--out',
			out,
			'--from',
			'1',
			'--to',
			'1',
			'--test',
		]);
		// The distill command itself succeeded (it emitted + ran the test); the
		// FAILURE is reported LOUDLY as data, not swallowed.
		expect(envelope.ok).toBe(true);
		expect(envelope.data!.test).toBeDefined();
		expect(envelope.data!.test!.passed).toBe(false);
		expect(typeof envelope.data!.test!.error).toBe('string');
		expect(envelope.data!.test!.error!.length).toBeGreaterThan(0);
	});

	it('HARD INVARIANT under --test: writes NO hands.json and never loads the module', async () => {
		const {root} = await servedFixtureSession(async (client) => {
			await client.page.type(locator(`page.locator('#query')`), 'hello');
			await client.page.click(locator(`page.locator('#search')`));
		});
		const outDir = await tempOut();
		const out = join(outDir, 'checked.mjs');

		await runDistill(root, ['distill', '--out', out, '--test']);

		// No hands.json anywhere: adoption stays the human's operator-scoped act.
		expect(existsSync(join(root, 'hands.json'))).toBe(false);
		expect(existsSync(join(outDir, 'hands.json'))).toBe(false);
		// Only the two emit artifacts under --out (no adopted-hand side effects).
		expect(existsSync(out)).toBe(true);
		expect(existsSync(`${out}.notes.md`)).toBe(true);
		const scaffold = await readFile(out, 'utf8');
		expect(scaffold).toContain('export default function');
	});
});
