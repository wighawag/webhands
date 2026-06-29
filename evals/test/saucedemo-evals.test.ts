import {describe, expect, it} from 'vitest';
import {saucedemoCoreFlowEval} from '../src/catalogue/saucedemo-core-flow.eval.js';
import {saucedemoDiscoveryEval} from '../src/catalogue/saucedemo-discovery.eval.js';
import {
	assertNoPriming,
	buildAgentInput,
	VERB_SURFACE_REFERENCE,
} from '../src/no-priming.js';
import type {EvalEntry} from '../src/eval-contract.js';

/**
 * OFFLINE structural checks for the Tier-1 SauceDemo eval entries (task
 * `eval-saucedemo-tier1`). These assert the eval CONTRACT + the no-priming
 * property WITHOUT touching the live SauceDemo DOM: they only read the static
 * entry objects, so they are deterministic and network-free.
 *
 * They still live under `evals/` (NOT `packages/*`), so the repo gate
 * (`pnpm test` = `pnpm --filter './packages/*' test`) never runs them; this file
 * runs only under the harness's own `self-test` vitest. The acceptance
 * criterion "no automated test added by this task runs inside `pnpm test`
 * against the live SauceDemo DOM" holds two ways: by LOCATION (outside the gate)
 * AND by NATURE (these never open SauceDemo at all; the live run is the opt-in
 * `run-eval` runner only).
 */

const ENTRY_URL = 'https://www.saucedemo.com/';

/** The two real-site entries this task ships, with a label for the report. */
const ENTRIES: ReadonlyArray<{label: string; entry: EvalEntry}> = [
	{label: 'core-flow', entry: saucedemoCoreFlowEval},
	{label: 'discovery', entry: saucedemoDiscoveryEval},
];

describe('Tier-1 SauceDemo eval entries (offline contract + no-priming checks)', () => {
	for (const {label, entry} of ENTRIES) {
		describe(label, () => {
			it('is a tier-1 SauceDemo entry at the fixed public entry URL', () => {
				expect(entry.tier).toBe('tier-1');
				expect(entry.target).toBe('SauceDemo');
				expect(entry.entryUrl).toBe(ENTRY_URL);
			});

			it('passes the no-priming guard (no selectors / no foreign URL)', () => {
				expect(() => assertNoPriming(entry)).not.toThrow();
			});

			it('hands the agent ONLY the goal-prompt + the verb-surface reference', () => {
				const input = buildAgentInput(entry);
				expect(input).toContain(entry.goalPrompt.trim());
				expect(input).toContain(VERB_SURFACE_REFERENCE);
				// No selector-shaped foreknowledge leaks into the agent's input: the
				// HARNESS-side end-state locators must never reach the agent.
				expect(input).not.toMatch(/page\.locator\(/);
				expect(input).not.toMatch(/\.inventory_list|\.shopping_cart_badge/);
				expect(input).not.toMatch(/checkout_complete_container/);
				expect(input).not.toMatch(/#login-button/);
			});

			it('names no URL beyond the single entry point', () => {
				const urls = entry.goalPrompt.match(/https?:\/\/[^\s"'`)<>]+/gi) ?? [];
				for (const url of urls) {
					expect(url.replace(/\/+$/, '')).toBe(ENTRY_URL.replace(/\/+$/, ''));
				}
			});

			it('carries the ordered milestones for partial credit', () => {
				expect(entry.milestones.map((m) => m.id)).toEqual([
					'reached-login',
					'reached-cart',
					'reached-checkout',
					'order-confirmed',
				]);
			});

			it('asserts a non-empty end state (the order-complete confirmation)', () => {
				expect(entry.endState.length).toBeGreaterThan(0);
			});
		});
	}

	it('the core-flow goal supplies the standard demo login (login, not DOM priming)', () => {
		expect(saucedemoCoreFlowEval.goalPrompt).toContain('standard_user');
		expect(saucedemoCoreFlowEval.goalPrompt).toContain('secret_sauce');
	});

	it('the discovery goal steers into the broken account WITHOUT naming the fix', () => {
		const goal = saucedemoDiscoveryEval.goalPrompt;
		// It points the agent at the broken account it must discover...
		expect(goal).toContain('problem_user');
		// ...but never names a working account or HOW problem_user is broken (the
		// agent must discover the special-user behaviour for itself).
		expect(goal).not.toContain('standard_user');
		expect(goal).not.toContain('performance_glitch_user');
		expect(goal.toLowerCase()).not.toContain('last name');
	});
});
