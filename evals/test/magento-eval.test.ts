import {describe, expect, it} from 'vitest';
import {magentoCheckoutEval} from '../src/catalogue/magento-checkout.eval.js';
import {
	assertNoPriming,
	buildAgentInput,
	VERB_SURFACE_REFERENCE,
} from '../src/no-priming.js';

/**
 * OFFLINE structural checks for the Tier-3 Magento-demo eval entry (task
 * `eval-magento-tier3`). They assert the eval CONTRACT, the no-priming property,
 * the ordered milestones, the no-account stance, and the recorded
 * stability/INCONCLUSIVE posture, WITHOUT touching the live Magento DOM: they
 * read the static entry object only, so they are deterministic and network-free.
 *
 * They live under `evals/` (NOT `packages/*`), so the repo gate (`pnpm test` =
 * `pnpm --filter './packages/*' test`) never runs them; they run only under the
 * harness's own `self-test` vitest. The acceptance criterion "no automated test
 * added here hits the live Magento DOM inside the gate" holds two ways: by
 * LOCATION (outside the gate) AND by NATURE (these never open Magento at all;
 * the live run is the opt-in `run-eval` runner only).
 */

const ENTRY_URL = 'https://magento.softwaretestingboard.com/';

describe('Tier-3 Magento eval entry (offline contract + no-priming checks)', () => {
	it('is a tier-3 Magento entry at the fixed public entry URL', () => {
		expect(magentoCheckoutEval.tier).toBe('tier-3');
		expect(magentoCheckoutEval.target).toContain('Magento');
		expect(magentoCheckoutEval.entryUrl).toBe(ENTRY_URL);
		expect(magentoCheckoutEval.id).toBe('magento-checkout');
	});

	it('passes the no-priming guard (no selectors / no foreign URL)', () => {
		expect(() => assertNoPriming(magentoCheckoutEval)).not.toThrow();
	});

	it('hands the agent ONLY the goal-prompt + the verb-surface reference (no harness selectors leak)', () => {
		const input = buildAgentInput(magentoCheckoutEval);
		expect(input).toContain(magentoCheckoutEval.goalPrompt.trim());
		expect(input).toContain(VERB_SURFACE_REFERENCE);
		// The HARNESS-side Luma locators must never reach the agent: this matters
		// MOST on a messy DOM, where a leaked selector would defeat the whole point.
		expect(input).not.toMatch(/page\.locator\(/);
		expect(input).not.toMatch(/product-addtocart-button|catalogsearch|#search/);
		expect(input).not.toMatch(/opc-wrapper|cart\.item|#checkout/);
	});

	it('names no URL beyond the single entry point', () => {
		const urls =
			magentoCheckoutEval.goalPrompt.match(/https?:\/\/[^\s"'`)<>]+/gi) ?? [];
		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) {
			expect(url.replace(/\/+$/, '')).toBe(ENTRY_URL.replace(/\/+$/, ''));
		}
	});

	it('carries the ordered milestones for partial credit (story 8/9)', () => {
		expect(magentoCheckoutEval.milestones.map((m) => m.id)).toEqual([
			'reached-search-results',
			'reached-product',
			'reached-cart',
			'reached-checkout',
		]);
	});

	it('asserts a non-empty end state (the checkout page reached)', () => {
		expect(magentoCheckoutEval.endState.length).toBeGreaterThan(0);
	});

	it('is a NO-ACCOUNT guest flow: no per-run hygiene, no cleanup, no login priming', () => {
		// The goal steers the agent to shop as a GUEST (acceptance: avoid account
		// state where possible), so prd D2 does not apply and no cleanup is declared.
		expect(magentoCheckoutEval.cleanup).toBeUndefined();
		const goal = magentoCheckoutEval.goalPrompt.toLowerCase();
		expect(goal).toContain('guest');
		expect(goal).not.toContain('register');
		expect(goal).not.toContain('password');
	});

	it('declares a health probe so a down/blocked Magento yields INCONCLUSIVE, not FAIL (story 10)', () => {
		// The precheck landmark is what lets the foundation report INCONCLUSIVE on a
		// flaky/Cloudflare-blocked Magento instead of a capability FAIL: a non-empty
		// health probe set is the seam that distinguishes the two.
		expect(magentoCheckoutEval.health.length).toBeGreaterThan(0);
	});
});
