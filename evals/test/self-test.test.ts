import {mkdtemp, mkdir, rm, readdir, stat} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {startFixtureServer, type FixtureServer} from './fixture-server.js';
import {buildSelfTestEval} from '../src/catalogue/self-test-fixture.eval.js';
import {startServe, type ServeSession} from '../src/serve-lifecycle.js';
import {VerbClient, type WebhandsCommand} from '../src/verb-client.js';
import {replayTrace, type ScriptedTrace} from '../src/scripted-trace.js';
import {evaluateOutcome} from '../src/outcome.js';
import {runPrecheck} from '../src/precheck.js';
import {
	assertNoPriming,
	buildAgentInput,
	PrimingViolationError,
	VERB_SURFACE_REFERENCE,
} from '../src/no-priming.js';
import type {EvalEntry} from '../src/eval-contract.js';

/**
 * The DETERMINISTIC SCRIPTED-RUN self-test (prd D3): the gate-testable-BY-NATURE
 * machinery proof. It exercises the harness's OWN logic (the serve lifecycle,
 * the read-verb end-state assertion, milestone scoring, the three-state
 * pass/fail/INCONCLUSIVE decision, the precheck, the no-priming guard) against a
 * LOCAL FIXTURE, with NO real agent and NO live site.
 *
 * A known-good PRIMED scripted trace must yield PASS + the right milestones; a
 * known-bad trace must yield FAIL. It is PRIMED by construction (the trace IS
 * the verb steps a real agent would have to discover), so it is NEVER a
 * capability pass: it is a machinery check.
 *
 * It runs under `evals/`'s OWN vitest (the `self-test` script), NOT the repo
 * gate (`pnpm test` = `pnpm --filter './packages/*' test` never reaches here).
 */

/** The real built webhands bin (the harness drives the PUBLISHED surface). */
function webhandsCommand(): WebhandsCommand {
	const here = dirname(fileURLToPath(import.meta.url));
	const bin = join(here, '..', '..', 'packages', 'cli', 'dist', 'bin.js');
	return {command: process.execPath, args: [bin]};
}

/**
 * A known-GOOD primed trace: add a task, then submit to reveal the in-page
 * confirmation. Submit is an in-page button (no navigation), so the final DOM
 * carries the task row AND the visible confirmation: every end state persists.
 */
function knownGoodTrace(): ScriptedTrace {
	return {
		label: 'known-good',
		steps: [
			{verb: 'type', args: [`page.locator('#task-input')`, 'buy milk']},
			{verb: 'click', args: [`page.locator('#add')`]},
			{verb: 'click', args: [`page.locator('#submit')`]},
		],
	};
}

/**
 * A known-BAD primed trace: it adds a task (reaching the `item-added`
 * milestone) but NEVER submits, so the confirmation stays hidden and the final
 * end state is never reached. The site is healthy, so the harness must score
 * this a genuine FAIL.
 */
function knownBadTrace(): ScriptedTrace {
	return {
		label: 'known-bad',
		steps: [
			{verb: 'type', args: [`page.locator('#task-input')`, 'buy milk']},
			{verb: 'click', args: [`page.locator('#add')`]},
		],
	};
}

describe('D3 scripted-run self-test (machinery proof, local fixture, NOT a capability subject)', () => {
	let fixture: FixtureServer;
	const tempRoots: string[] = [];
	const sessions: ServeSession[] = [];

	beforeAll(async () => {
		fixture = await startFixtureServer();
	});

	afterAll(async () => {
		await fixture.close();
	});

	afterEach(async () => {
		while (sessions.length > 0) {
			await sessions.pop()!.stop();
		}
		while (tempRoots.length > 0) {
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
	});

	/** Make an isolated WEBHANDS_HOME with a warmed (empty) default profile. */
	async function isolatedHome(): Promise<string> {
		const home = await mkdtemp(join(tmpdir(), 'webhands-eval-selftest-'));
		tempRoots.push(home);
		await mkdir(join(home, 'profiles', 'default'), {recursive: true});
		return home;
	}

	/** Start a harness-owned serve session against the isolated home + fixture. */
	async function serveAgainst(home: string): Promise<ServeSession> {
		const session = await startServe({webhands: webhandsCommand(), home});
		sessions.push(session);
		return session;
	}

	it('known-GOOD trace -> PASS with all milestones reached', async () => {
		const home = await isolatedHome();
		const entry = buildSelfTestEval(fixture.url);
		const session = await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});

		// The harness navigates to the entry URL (as the precheck/agent setup would).
		await verbs.goto(entry.entryUrl);
		// Replay the PRIMED known-good trace as the pseudo-agent's actions.
		const replay = await replayTrace(knownGoodTrace(), {
			webhands: webhandsCommand(),
			home,
		});
		expect(replay.completed).toBe(true);

		// The harness makes its OWN verdict via the read verbs (not the trace's word).
		const outcome = await evaluateOutcome({entry, verbs});
		expect(outcome.kind).toBe('PASS');
		expect(outcome.score.passed).toBe(true);
		expect(outcome.score.milestonesReached).toEqual([
			'reached-list',
			'item-added',
		]);
		void session;
	});

	it('known-BAD trace -> FAIL on a healthy site (partial milestone credit, NOT retried)', async () => {
		const home = await isolatedHome();
		const entry = buildSelfTestEval(fixture.url);
		await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});

		await verbs.goto(entry.entryUrl);
		const replay = await replayTrace(knownBadTrace(), {
			webhands: webhandsCommand(),
			home,
		});
		expect(replay.completed).toBe(true);

		const outcome = await evaluateOutcome({entry, verbs, maxAttempts: 3});
		// The fixture (entry page) is healthy, so a non-pass is a genuine FAIL.
		expect(outcome.kind).toBe('FAIL');
		expect(outcome.score.passed).toBe(false);
		// Partial credit: it reached item-added but never the confirmation.
		expect(outcome.score.milestonesReached).toEqual([
			'reached-list',
			'item-added',
		]);
		// A genuine FAIL is NOT retried.
		expect(outcome.attempts).toBe(1);
	});

	it('precheck reports a HEALTHY entry page (the FAIL-vs-INCONCLUSIVE gate)', async () => {
		const home = await isolatedHome();
		const entry = buildSelfTestEval(fixture.url);
		await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});

		await verbs.goto(entry.entryUrl);
		const health = await runPrecheck(entry, verbs);
		expect(health.healthy).toBe(true);
	});

	it('precheck reports UNHEALTHY for an unreachable entry URL -> drives INCONCLUSIVE', async () => {
		const home = await isolatedHome();
		const base = buildSelfTestEval(fixture.url);
		// Point the entry URL at a dead port so the precheck fails reachability.
		const dead: EvalEntry = {...base, entryUrl: 'http://127.0.0.1:1/'};
		await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});

		const health = await runPrecheck(dead, verbs);
		expect(health.healthy).toBe(false);

		// A non-pass against an UNHEALTHY site is INCONCLUSIVE, retried up to the
		// bound (a genuine FAIL would not be retried). maxAttempts:2 => 2 attempts.
		const outcome = await evaluateOutcome({entry: dead, verbs, maxAttempts: 2});
		expect(outcome.kind).toBe('INCONCLUSIVE');
		expect(outcome.attempts).toBe(2);
	});

	it('shared-write isolation: the real ~/.webhands is UNTOUCHED', async () => {
		const realEndpoint = join(homedir(), '.webhands', 'session-endpoint.json');
		const realExistedBefore = await fileExists(realEndpoint);

		const home = await isolatedHome();
		const entry = buildSelfTestEval(fixture.url);
		await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});
		await verbs.goto(entry.entryUrl);

		// Our endpoint file lives under the TEMP home, not the real home.
		const entries = await readdir(home);
		expect(entries).toContain('session-endpoint.json');
		// The real shared location was neither created nor removed by our run.
		expect(await fileExists(realEndpoint)).toBe(realExistedBefore);
	});

	describe('no-priming guard (enforced, not a comment)', () => {
		it('builds agent input as ONLY the goal-prompt + the verb-surface reference', () => {
			const entry = buildSelfTestEval(fixture.url);
			const input = buildAgentInput(entry);
			expect(input).toContain(entry.goalPrompt);
			expect(input).toContain(VERB_SURFACE_REFERENCE);
			// No selector/step foreknowledge leaks into the agent's input.
			expect(input).not.toMatch(/page\.locator\(/);
			expect(input).not.toMatch(/#task-list|#submit|#add/);
		});

		it('REJECTS a goal-prompt carrying a selector', () => {
			const entry: EvalEntry = {
				...buildSelfTestEval(fixture.url),
				goalPrompt: `Click page.locator('#submit') to finish.`,
			};
			expect(() => assertNoPriming(entry)).toThrow(PrimingViolationError);
		});

		it('REJECTS a goal-prompt naming a URL other than the entry point', () => {
			const base = buildSelfTestEval(fixture.url);
			const entry: EvalEntry = {
				...base,
				goalPrompt: `${base.goalPrompt} Start at http://example.com/login.`,
			};
			expect(() => assertNoPriming(entry)).toThrow(PrimingViolationError);
		});

		it('ALLOWS a goal-prompt naming the entry URL itself', () => {
			const base = buildSelfTestEval(fixture.url);
			const entry: EvalEntry = {
				...base,
				goalPrompt: `${base.goalPrompt} The site is at ${base.entryUrl}.`,
			};
			expect(() => assertNoPriming(entry)).not.toThrow();
		});
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
