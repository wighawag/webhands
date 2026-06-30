import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	resolveFixtureModel,
	computeExpectedPlan,
	lineTotal,
	startDynamicFixtureServer,
	type DynamicFixtureServer,
} from '../src/dynamic-fixture.js';
import {buildCartThresholdCheckoutEval} from '../src/catalogue/cart-threshold-checkout.eval.js';
import {startServe, type ServeSession} from '../src/serve-lifecycle.js';
import {VerbClient, type WebhandsCommand} from '../src/verb-client.js';
import {replayTrace, type ScriptedTrace} from '../src/scripted-trace.js';
import {evaluateOutcome} from '../src/outcome.js';
import {assertNoPriming, buildAgentInput} from '../src/no-priming.js';
import {mintNonce} from '../src/nonce.js';

/**
 * The DETERMINISTIC machinery self-test for the DYNAMIC cart-threshold eval
 * (task `eval-dynamic-non-scriptable-mid-run-goal-shift`, the same shape as the
 * D3 scripted-run self-test). It exercises the new eval's PLUMBING against the
 * LOCAL randomised fixture with NO real agent and NO live site:
 *
 *  - the fixture is non-scriptable BY CONSTRUCTION (a blind fixed script cannot
 *    encode the per-run stop point, proven here over many nonces);
 *  - a PRIMED read-loop trace that adds the minimal clearing cart + checks out
 *    yields PASS with all milestones;
 *  - an under-threshold trace yields a genuine FAIL (the dynamic stop condition
 *    was NOT met), proving the end-state assertion is the harness's own page
 *    read and not the agent's word;
 *  - the GOAL is no-priming-clean (names the condition, not selectors/values).
 *
 * It is PRIMED by construction (the trace IS the verb steps a real agent would
 * have to DISCOVER from the live page), so a green run is a MACHINERY proof, not
 * a capability pass. It runs under `evals/`'s OWN vitest (`self-test`), NEVER the
 * repo gate (`pnpm test` = `pnpm --filter './packages/*' test` never reaches
 * here, and this fixture is purely local anyway).
 */

/** The real built webhands bin (the harness drives the PUBLISHED surface). */
function webhandsCommand(): WebhandsCommand {
	const here = dirname(fileURLToPath(import.meta.url));
	const bin = join(here, '..', '..', 'packages', 'cli', 'dist', 'bin.js');
	return {command: process.execPath, args: [bin]};
}

describe('dynamic cart-threshold eval (machinery proof, local randomised fixture, NOT a capability subject)', () => {
	let fixture: DynamicFixtureServer;
	const tempRoots: string[] = [];
	const sessions: ServeSession[] = [];

	beforeEach(async () => {
		// A FRESH nonce-seeded page per test, so each test sees an independent
		// randomised catalogue + threshold (like a real per-run mint).
		fixture = await startDynamicFixtureServer(resolveFixtureModel(mintNonce()));
	});

	afterEach(async () => {
		while (sessions.length > 0) {
			await sessions.pop()!.stop();
		}
		while (tempRoots.length > 0) {
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
		await fixture.close();
	});

	afterAll(async () => {
		// nothing global to tear down (each test owns its fixture)
	});

	/** Make an isolated WEBHANDS_HOME with a warmed (empty) default profile. */
	async function isolatedHome(): Promise<string> {
		const home = await mkdtemp(join(tmpdir(), 'webhands-eval-dyncart-'));
		tempRoots.push(home);
		await mkdir(join(home, 'profiles', 'default'), {recursive: true});
		return home;
	}

	/** Start a harness-owned serve session against the isolated home. */
	async function serveAgainst(home: string): Promise<ServeSession> {
		const session = await startServe({webhands: webhandsCommand(), home});
		sessions.push(session);
		return session;
	}

	/**
	 * A PRIMED known-GOOD trace: add the minimal clearing cart (the harness's
	 * own re-derived plan) one item at a time, reading nothing (this is the
	 * PRIMED stand-in for the read-decide-act loop a real agent must do), then
	 * check out. Submit is in-page (no navigation) so the final DOM carries the
	 * cart subtotal AND the confirmation: every end state persists.
	 */
	function clearingTrace(): ScriptedTrace {
		const plan = computeExpectedPlan(fixture.model);
		const steps = plan.addedItemIds.map((id) => ({
			verb: 'click',
			args: [`page.locator('#add-${id}')`],
		}));
		steps.push({verb: 'click', args: [`page.locator('#checkout')`]});
		return {label: 'clearing', steps};
	}

	/**
	 * A PRIMED under-threshold trace: add just ONE item (the cheapest cart line)
	 * and check out. One item never clears the threshold (the fixture's threshold
	 * always needs several items), so the dynamic stop condition is NOT met and
	 * the harness must score a genuine FAIL.
	 */
	function underThresholdTrace(): ScriptedTrace {
		const cheapest = [...fixture.model.items].sort(
			(a, b) => lineTotal(a) - lineTotal(b),
		)[0];
		return {
			label: 'under-threshold',
			steps: [
				{verb: 'click', args: [`page.locator('#add-${cheapest.id}')`]},
				{verb: 'click', args: [`page.locator('#checkout')`]},
			],
		};
	}

	it('the fixture is NON-SCRIPTABLE: the correct item count is run-dependent, so no fixed blind add-K wins', () => {
		// A one-shot blind script must hardcode HOW MANY items to add. The eval is
		// non-scriptable because the CORRECT (minimal, non-overshooting) count VARIES
		// per run: the threshold, the prices, and the cart-only handling fee are all
		// nonce-seeded, so the size of the smallest cart that clears the threshold is
		// run-dependent. A DETERMINISTIC sweep over a fixed nonce list (no
		// Math.random, so the assertion can never flake) proves it.
		const nonces = Array.from({length: 600}, (_, i) =>
			mintNonce(1_700_000_000_000 + i * 7919),
		);

		// (a) The minimal clearing-cart size takes MULTIPLE distinct values across
		// runs, so there is no single count a blind script can hardcode that is the
		// right (minimal) answer for every run. A script that adds the goal's "only
		// as many as you need" cannot be a fixed number.
		const minimalSizes = new Set(
			nonces.map((nonce) => {
				const model = resolveFixtureModel(nonce);
				return computeExpectedPlan(model).addedItemIds.length;
			}),
		);
		expect(minimalSizes.size).toBeGreaterThan(1);

		// (b) Any SMALL fixed count under-clears on at least one run (so a blind
		// script that errs toward few items genuinely FAILS the threshold), proving
		// the stop point cannot be precomputed downward either.
		for (const k of [1, 2, 3]) {
			const underClearsSomewhere = nonces.some((nonce) => {
				const model = resolveFixtureModel(nonce);
				const byCard = [...model.items]
					.sort((a, b) => a.cardPrice - b.cardPrice)
					.slice(0, k);
				const blindSubtotal = byCard.reduce(
					(s, it) => Math.round((s + lineTotal(it)) * 100) / 100,
					0,
				);
				return !(blindSubtotal > model.threshold);
			});
			expect(underClearsSomewhere).toBe(true);
		}

		// (c) The harness's own read-loop plan ALWAYS clears (the deterministic,
		// host-checkable reference a real agent's read-decide-act loop converges to):
		// the reading agent always succeeds, the blind one cannot.
		for (const nonce of nonces) {
			const model = resolveFixtureModel(nonce);
			const plan = computeExpectedPlan(model);
			expect(plan.subtotal).toBeGreaterThan(model.threshold);
		}
	});

	it('the running subtotal is NOT precomputable from the cards (hidden handling fee)', () => {
		// Even an agent that reads EVERY card price up front cannot compute the cart
		// subtotal: the cart line adds a per-item handling fee shown only in the
		// cart, so the card-sum and the cart-sum differ. This is what forces a
		// genuine read-act-read loop rather than a single read-all-then-add script.
		const model = fixture.model;
		const sample = model.items.slice(0, 3);
		const cardSum = sample.reduce((s, it) => s + it.cardPrice, 0);
		const cartSum = sample.reduce((s, it) => s + lineTotal(it), 0);
		expect(cartSum).toBeGreaterThan(cardSum);
	});

	it('PRIMED clearing trace -> PASS with all milestones reached', async () => {
		const home = await isolatedHome();
		const entry = buildCartThresholdCheckoutEval(
			`${fixture.url}/`,
			fixture.model,
		);
		await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});

		await verbs.goto(entry.entryUrl);
		const replay = await replayTrace(clearingTrace(), {
			webhands: webhandsCommand(),
			home,
		});
		expect(replay.completed).toBe(true);

		const outcome = await evaluateOutcome({entry, verbs});
		expect(outcome.kind).toBe('PASS');
		expect(outcome.score.passed).toBe(true);
		expect(outcome.score.milestonesReached).toEqual([
			'reached-store',
			'item-in-cart',
			'subtotal-cleared-threshold',
			'order-confirmed',
		]);
	});

	it('PRIMED under-threshold trace -> FAIL on a healthy fixture (dynamic stop NOT met)', async () => {
		const home = await isolatedHome();
		const entry = buildCartThresholdCheckoutEval(
			`${fixture.url}/`,
			fixture.model,
		);
		await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});

		await verbs.goto(entry.entryUrl);
		const replay = await replayTrace(underThresholdTrace(), {
			webhands: webhandsCommand(),
			home,
		});
		expect(replay.completed).toBe(true);

		const outcome = await evaluateOutcome({entry, verbs, maxAttempts: 3});
		// The fixture is healthy, so an under-threshold checkout is a genuine FAIL,
		// not INCONCLUSIVE: the harness read the live subtotal and it did NOT clear.
		expect(outcome.kind).toBe('FAIL');
		expect(outcome.score.passed).toBe(false);
		// Partial credit: it reached the cart (one item) but never cleared the
		// threshold, so the dynamic stop milestone is NOT reached.
		expect(outcome.score.milestonesReached).toEqual([
			'reached-store',
			'item-in-cart',
		]);
		// A genuine FAIL is NOT retried.
		expect(outcome.attempts).toBe(1);
	});

	describe('no-priming (the goal names the CONDITION, not selectors/values)', () => {
		it('passes the no-priming guard', () => {
			const entry = buildCartThresholdCheckoutEval(
				`${fixture.url}/`,
				fixture.model,
			);
			expect(() => assertNoPriming(entry)).not.toThrow();
		});

		it('hands the agent ONLY the goal + the verb-surface reference (no selectors, no threshold value)', () => {
			const entry = buildCartThresholdCheckoutEval(
				`${fixture.url}/`,
				fixture.model,
			);
			const input = buildAgentInput(entry);
			expect(input).toContain(entry.goalPrompt.trim());
			// No selector/step foreknowledge, and crucially no leaked NUMBERS (the
			// threshold/prices are dynamic; naming one would defeat the eval).
			expect(input).not.toMatch(/page\.locator\(/);
			expect(input).not.toMatch(/#add-|#cart-subtotal|#checkout/);
			expect(input).not.toContain(fixture.model.threshold.toFixed(2));
		});

		it('names no URL beyond the single entry point', () => {
			const entry = buildCartThresholdCheckoutEval(
				`${fixture.url}/`,
				fixture.model,
			);
			const urls = entry.goalPrompt.match(/https?:\/\/[^\s"'`)<>]+/gi) ?? [];
			expect(urls.length).toBeGreaterThan(0);
			for (const url of urls) {
				expect(url.replace(/\/+$/, '')).toBe(
					entry.entryUrl.replace(/\/+$/, ''),
				);
			}
		});
	});
});
