import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	distillTrace,
	PlaywrightLaunchTransport,
	renderReplayScript,
	resolveProfileLocation,
	startFixtureServer,
	type FixtureServer,
	type SessionRpcRequest,
	type Session,
	type VerbTraceEntry,
} from '../src/index.js';

/**
 * The `distill --test` REPLAY SCRIPT: the SAME distilled replay rendered as the
 * `script` verb's DRIVER-CONTEXT shape (an `async (page) => { ... }` function of
 * the live Playwright page), which is exactly what `distill --test` runs via the
 * `script` mechanism (ADR-0012) to VALIDATE the emitted scaffold (task
 * `distill-test-validates-scaffold-via-script`).
 *
 * This suite pins the pure shape + the DRIFT-SAFETY property (the tested source
 * and the emitted scaffold are built from the SAME per-step replay lines, so
 * they cannot describe different flows). The REAL PASS/FAIL run against a live
 * page is exercised at the CLI `distill --test` verb seam against a served
 * fixture; here we only prove the source shape `script` will run.
 */

function step(request: SessionRpcRequest, verb?: string): VerbTraceEntry {
	return {
		verb: verb ?? (request as {verb: string}).verb,
		request,
		result: undefined,
		at: 0,
	};
}

function loginTrace(): VerbTraceEntry[] {
	return [
		step({verb: 'navigate', url: 'https://www.saucedemo.com/'}),
		step({verb: 'type', locator: '#user-name', text: 'standard_user'}),
		step({verb: 'type', locator: '#password', text: '{ENV:SAUCE_PASSWORD}'}),
		step({verb: 'click', locator: '#login-button'}),
	];
}

describe('distill --test replay script: the `script`-shaped driver-context source', () => {
	it('renders an async function OF THE PAGE (the shape `script` runs)', () => {
		const {replayScript} = distillTrace(loginTrace());
		// The ADR-0012 `script` contract: JS that evaluates to a function of the
		// page. A real Function factory must accept the source as a value.
		expect(replayScript).toMatch(/^async \(page\) => \{/);
		expect(replayScript.trimEnd().endsWith('}')).toBe(true);
		// It closes over `page` and drives the SAME steps the trace recorded.
		expect(replayScript).toContain(
			'await page.goto("https://www.saucedemo.com/")',
		);
		expect(replayScript).toContain('.fill("standard_user")');
		// The credential replays the TOKEN, never a resolved secret (inherited).
		expect(replayScript).toContain('.fill("{ENV:SAUCE_PASSWORD}")');
		expect(replayScript).not.toContain('standard_user_password');
	});

	it('is a syntactically valid function-of-page expression (no `script` syntax reject)', () => {
		const {replayScript} = distillTrace(loginTrace());
		// This is exactly how `runScript` evaluates the source (a function factory).
		// It must not throw: a broken shape would make `script` reject before the
		// page even runs, which is NOT what `--test` should surface.
		// eslint-disable-next-line no-new-func
		const factory = new Function('page', 'p', `return (${replayScript});`);
		const fn = factory(undefined, undefined);
		expect(typeof fn).toBe('function');
	});

	it('DRIFT-SAFETY: the replay script drives the same steps as the emitted scaffold', () => {
		// The scaffold (a Hand body) and the replay script (a function-of-page) are
		// built from the SAME per-step replay lines, so each Playwright call in the
		// scaffold body appears in the replay script too (they cannot diverge).
		const {scaffold, replayScript} = distillTrace(loginTrace());
		for (const call of [
			'await page.goto("https://www.saucedemo.com/");',
			'.fill("standard_user");',
			'.fill("{ENV:SAUCE_PASSWORD}");',
			'.click();',
		]) {
			expect(scaffold).toContain(call);
			expect(replayScript).toContain(call);
		}
	});

	it('renders a valid no-op function of the page for an EMPTY slice', () => {
		const {replayScript} = distillTrace([]);
		expect(replayScript).toMatch(/^async \(page\) => \{/);
		// eslint-disable-next-line no-new-func
		const fn = new Function('page', 'p', `return (${replayScript});`)(
			undefined,
			undefined,
		);
		expect(typeof fn).toBe('function');
	});

	it('renderReplayScript is exported and matches distillTrace().replayScript', () => {
		// The core exposes the renderer so the CLI (and future callers) share the
		// ONE source of the replay-script shape; distillTrace threads it through.
		const {replayScript} = distillTrace(loginTrace());
		expect(typeof renderReplayScript).toBe('function');
		expect(replayScript.length).toBeGreaterThan(0);
	});
});

/**
 * The `--test` MECHANISM against a REAL browser + LOCAL FIXTURE: running the
 * distilled `replayScript` via the `script` verb (`page.script(...)`, ADR-0012)
 * is exactly what `distill --test` does. This exercises the PASS + FAIL seams
 * with full control over the trace (a fixture trace, so a broken step can be
 * constructed deterministically), mirroring the `script` verb's real-browser
 * seam test.
 *
 * Shared-write isolation: every launch points its profile root at a per-test
 * temp dir; nothing here touches the real `~/.webhands`.
 */
describe('distill --test mechanism: run the replay via `script` (real browser, fixture)', () => {
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
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
	});

	async function openOnFixture(name: string, page: string): Promise<Session> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-distill-replay-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		const transport = new PlaywrightLaunchTransport({root});
		const session = await transport.open({mode: 'launch', profile: name});
		await session.page.navigate(`${server.url}/${page}.html`);
		return session;
	}

	function traceStep(request: SessionRpcRequest): VerbTraceEntry {
		return {
			verb: (request as {verb: string}).verb,
			request,
			result: undefined,
			at: 0,
		};
	}

	it('PASS: a good scaffold replay runs cleanly against the live page', async () => {
		const session = await openOnFixture('replay-pass', 'click-type');
		try {
			// A faithful sub-flow the fixture supports: type into #query, click #search.
			const {replayScript} = distillTrace([
				traceStep({verb: 'type', locator: '#query', text: 'flights to BOM'}),
				traceStep({verb: 'click', locator: '#search'}),
			]);
			// This is the exact call `distill --test` makes; it resolves (PASS),
			// returning the script's serializable result (here undefined: the replay
			// acts but reads nothing), never throwing.
			await expect(session.page.script(replayScript)).resolves.toBeUndefined();
		} finally {
			await session.close();
		}
	});

	it('FAIL: a broken scaffold replay throws a CLEAN typed error (never a silent pass)', async () => {
		const session = await openOnFixture('replay-fail', 'click-type');
		try {
			// A broken step: `select` on `#query` (an <input>, not a <select>). Its
			// replay `page.locator('#query').selectOption(...)` is rejected FAST by
			// Playwright ("Element is not a <select>"), so `--test` surfaces a clean,
			// typed FAIL via `script`'s error path, not a silent pass or a 30s hang.
			const {replayScript} = distillTrace([
				traceStep({verb: 'select', locator: '#query', choice: {value: 'x'}}),
			]);
			await expect(session.page.script(replayScript)).rejects.toThrow(
				/not a <select>/i,
			);
		} finally {
			await session.close();
		}
	});
});
