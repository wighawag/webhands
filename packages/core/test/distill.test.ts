import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {
	distillTrace,
	sliceTrace,
	DEFAULT_HAND_VERB,
	type DistillOptions,
	type Hand,
	type HandContext,
	type SessionRpcRequest,
	type VerbTraceEntry,
} from '../src/index.js';

/**
 * The `distill` authoring core (prd `distill-session-into-hand`; task
 * `distill-verb-emits-hand-scaffold`). `distill` reduces the just-driven
 * session's verb trace into a reusable HAND SCAFFOLD (a frozen ADR-0007 `Hand`
 * closing over `ctx.pwPage`) plus a human-readable NOTES markdown, so a flow
 * explored once becomes a one-call verb after a HUMAN adopts it.
 *
 * Seams tested here (behaviour, not internals):
 *
 * 1. EMIT + FAITHFUL REPLAY: given a fixture trace, the emitted module is a
 *    valid `Hand` (a default-export factory closing over `ctx.pwPage`) whose
 *    replay drives the SAME steps in order. Proven by IMPORTING the emitted
 *    module (a TEST is allowed to import it; the invariant is that `distill`
 *    itself never does) and running it against a fake recording page.
 * 2. NOTES: the emitted markdown lists the flow's steps / selectors / decisions.
 * 3. ENRICHMENTS: `--summary` / `--session-file` are OPTIONAL; omitting both
 *    still yields a scaffold from the trace alone.
 * 4. SLICE: a caller-named `[from, to]` crystallizes only that sub-flow (default
 *    = the whole session).
 * 5. NO LITERAL SECRET: a typed `{ENV:NAME}` token stays the token in the
 *    scaffold + notes (the trace already holds the token; the emit carries it
 *    through).
 *
 * The TRUST INVARIANT (distill writes no `hands.json` and never `import()`s the
 * module) is asserted at the CLI verb seam (`packages/cli/test/`) where the
 * files are actually written to a temp `--out`, mirroring the repo's
 * explicit-declarative hand-loading tests.
 */

/** Build a trace entry from a request (the result/timestamp are inconsequential here). */
function step(request: SessionRpcRequest, verb?: string): VerbTraceEntry {
	return {
		verb: verb ?? (request as {verb: string}).verb,
		request,
		result: undefined,
		at: 0,
	};
}

/**
 * A saucedemo-style login + add-to-cart sub-flow, the kind of realistic flow the
 * prd asks distill to crystallize (an eval fixture flow reused as a sub-flow).
 * The earlier steps (a snapshot probe) are the "failed probes" a slice drops.
 */
function saucedemoTrace(): VerbTraceEntry[] {
	return [
		// A probe the agent ran while exploring (dropped by a slice).
		step({verb: 'snapshot'}),
		// The sub-flow that matters:
		step({verb: 'navigate', url: 'https://www.saucedemo.com/'}),
		step({verb: 'type', locator: '#user-name', text: 'standard_user'}),
		step({verb: 'type', locator: '#password', text: '{ENV:SAUCE_PASSWORD}'}),
		step({verb: 'click', locator: '#login-button'}),
		step({
			verb: 'click',
			locator: `getByRole('button', {name: 'Add to cart'})`,
		}),
	];
}

/**
 * Load an emitted scaffold as a real ES module and return its default-export
 * factory (the `Hand`). Writing then importing PROVES the emitted string is a
 * valid, loadable `Hand` — the same shape ADR-0007's loader accepts. The import
 * happens in the TEST, never in `distill`.
 */
async function loadScaffold(scaffold: string): Promise<Hand> {
	const dir = await mkdtemp(join(tmpdir(), 'mbc-distill-'));
	tempDirs.push(dir);
	const file = join(dir, 'distilled-hand.mjs');
	await writeFile(file, scaffold, 'utf8');
	const mod = (await import(pathToFileURL(file).href)) as {default: Hand};
	return mod.default;
}

/** A fake HandContext whose `pwPage` records the Playwright calls the replay makes. */
function recordingContext(): {
	ctx: HandContext;
	calls: Array<{method: string; args: readonly unknown[]}>;
} {
	const calls: Array<{method: string; args: readonly unknown[]}> = [];
	const record =
		(method: string) =>
		(...args: readonly unknown[]) => {
			calls.push({method, args});
			return undefined;
		};
	// A locator proxy: any property access returns a recording function, and the
	// call chains (`.fill(...)`, `.click()`) are recorded with the originating
	// locator expression so we can assert the SAME steps replayed in order.
	const makeLocator = (expr: string): unknown =>
		new Proxy(
			{},
			{
				get(_t, prop: string) {
					return (...args: readonly unknown[]) => {
						calls.push({method: `locator(${expr}).${prop}`, args});
						return undefined;
					};
				},
			},
		);
	const page = {
		goto: record('goto'),
		locator: (expr: string) => makeLocator(expr),
		waitForTimeout: record('waitForTimeout'),
		waitForNavigation: record('waitForNavigation'),
		keyboard: {press: record('keyboard.press')},
		mouse: {
			click: record('mouse.click'),
			move: record('mouse.move'),
			wheel: record('mouse.wheel'),
		},
	} as unknown as HandContext['pwPage'];
	const ctx = {
		pwPage: page,
		context: {} as HandContext['context'],
		ensureOpen: () => {},
		screenshotsDir: '/tmp/unused',
	};
	return {ctx, calls};
}

const tempDirs: string[] = [];
afterEach(async () => {
	while (tempDirs.length > 0) {
		await rm(tempDirs.pop()!, {recursive: true, force: true});
	}
});

describe('distill: emit a Hand scaffold that faithfully replays the trace', () => {
	it('emits a default-export Hand closing over ctx.pwPage', async () => {
		const {scaffold} = distillTrace(saucedemoTrace());
		const hand = await loadScaffold(scaffold);

		// It is a `Hand`: a factory that, given a context, contributes named verbs.
		expect(typeof hand).toBe('function');
		const {ctx} = recordingContext();
		const contribution = hand(ctx);
		expect(typeof contribution.verbs).toBe('object');
		// The default verb name is exposed (a human renames it on adoption).
		expect(
			typeof (contribution.verbs as Record<string, unknown>)[DEFAULT_HAND_VERB],
		).toBe('function');
	});

	it('replays the SAME steps in order against ctx.pwPage', async () => {
		const {scaffold} = distillTrace(saucedemoTrace());
		const hand = await loadScaffold(scaffold);
		const {ctx, calls} = recordingContext();

		await (hand(ctx).verbs as Record<string, () => Promise<void>>)[
			DEFAULT_HAND_VERB
		]!();

		// The replay drove the same ordered steps the trace recorded: goto, two
		// fills (login), the login click, and the add-to-cart click.
		expect(calls[0]).toEqual({
			method: 'goto',
			args: ['https://www.saucedemo.com/'],
		});
		const fills = calls.filter((c) => c.method.endsWith('.fill'));
		expect(fills).toHaveLength(2);
		expect(fills[0]!.args).toEqual(['standard_user']);
		// The credential fill replays the TOKEN, never a resolved secret.
		expect(fills[1]!.args).toEqual(['{ENV:SAUCE_PASSWORD}']);
		const clicks = calls.filter((c) => c.method.endsWith('.click'));
		expect(clicks).toHaveLength(2);
		// The add-to-cart click used the recorded getByRole locator expression.
		expect(clicks[1]!.method).toContain(
			`getByRole('button', {name: 'Add to cart'})`,
		);
	});

	it('carries NO literal secret: the {ENV:NAME} token stays the token in scaffold + notes', () => {
		const {scaffold, notes} = distillTrace(saucedemoTrace());
		// The resolved secret is never anywhere; only the token appears.
		expect(scaffold).toContain('{ENV:SAUCE_PASSWORD}');
		expect(scaffold).not.toContain('standard_user_password');
		expect(notes).toContain('{ENV:SAUCE_PASSWORD}');
	});
});

describe('distill: the notes markdown', () => {
	it('lists the flow steps, the selectors, and the decisions/dead-ends', () => {
		const {notes} = distillTrace(saucedemoTrace(), {
			summary: 'Log in and add the first item to the cart.',
		});
		expect(notes).toContain('# Distilled hand');
		expect(notes).toContain('## What the flow does');
		expect(notes).toContain('Log in and add the first item to the cart.');
		expect(notes).toContain('## Steps');
		expect(notes).toContain('navigate to https://www.saucedemo.com/');
		expect(notes).toContain('## Selectors used');
		expect(notes).toContain('#login-button');
		// The leading `snapshot` probe is a read/probe left as a TODO decision.
		expect(notes).toContain('## Decisions / dead-ends');
	});
});

describe('distill: optional enrichments', () => {
	it('yields a scaffold from the trace ALONE when both enrichments are omitted', async () => {
		const {scaffold, notes} = distillTrace(saucedemoTrace());
		// Still a valid, loadable Hand with no summary/session-file.
		const hand = await loadScaffold(scaffold);
		expect(typeof hand).toBe('function');
		// The notes note the absence of a summary rather than fabricating intent.
		expect(notes).toContain('No `--summary` was given');
	});

	it('mines a --session-file transcript into its own notes section', () => {
		const {notes} = distillTrace(saucedemoTrace(), {
			sessionFile: 'user: log me in\nassistant: clicking login',
		});
		expect(notes).toContain('## Session transcript');
		expect(notes).toContain('user: log me in');
	});
});

describe('distill: the SLICE selector', () => {
	it('crystallizes only the caller-named sub-flow (dropping earlier probes)', async () => {
		// The whole trace has the leading snapshot probe at index 0; slice [1,4]
		// keeps only navigate + the two fills + the login click.
		const {scaffold} = distillTrace(saucedemoTrace(), {from: 1, to: 4});
		const hand = await loadScaffold(scaffold);
		const {ctx, calls} = recordingContext();
		await (hand(ctx).verbs as Record<string, () => Promise<void>>)[
			DEFAULT_HAND_VERB
		]!();

		// No add-to-cart click (index 5 was sliced out), and the leading snapshot
		// probe (index 0) is gone too: first call is the navigate.
		expect(calls[0]!.method).toBe('goto');
		const clicks = calls.filter((c) => c.method.endsWith('.click'));
		expect(clicks).toHaveLength(1); // only the login click
	});

	it('defaults to the WHOLE session when no slice is given', () => {
		const all = sliceTrace(saucedemoTrace());
		expect(all).toHaveLength(6);
	});

	it('clamps out-of-range bounds and yields an empty slice for an inverted range', () => {
		const entries = saucedemoTrace();
		expect(sliceTrace(entries, {from: -5, to: 99})).toHaveLength(
			entries.length,
		);
		expect(sliceTrace(entries, {from: 4, to: 1})).toEqual([]);
	});

	it('emits a valid (empty-body) scaffold for an empty trace', async () => {
		const {scaffold, notes} = distillTrace([]);
		const hand = await loadScaffold(scaffold);
		expect(typeof hand).toBe('function');
		expect(notes).toContain('The distilled slice was empty');
	});
});

describe('distill: a hand verb in the trace is left as an annotated TODO', () => {
	it('does not auto-invent a replay for a dynamically-loaded hand verb', () => {
		const trace: VerbTraceEntry[] = [
			step({verb: 'navigate', url: 'https://x.test/'}),
			step({verb: 'hand', name: 'solveCaptcha', args: []}, 'solveCaptcha'),
		];
		const options: DistillOptions = {};
		const {scaffold, notes} = distillTrace(trace, options);
		expect(scaffold).toContain('TODO');
		expect(scaffold).toContain('solveCaptcha');
		expect(notes).toContain('solveCaptcha');
	});
});
