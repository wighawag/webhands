import {describe, expect, it, vi} from 'vitest';
import {buildParabankTransferEval} from '../src/catalogue/parabank-transfer.eval.js';
import {runPostPassCleanup} from '../src/run-eval.js';
import {mintNonce, nonceTransferAmount, nonceUsername} from '../src/nonce.js';
import {
	assertNoPriming,
	buildAgentInput,
	VERB_SURFACE_REFERENCE,
} from '../src/no-priming.js';
import type {EvalCleanup, EvalEntry} from '../src/eval-contract.js';
import type {VerbClient} from '../src/verb-client.js';

/**
 * OFFLINE structural + machinery checks for the Tier-2 ParaBank eval (task
 * `eval-stateful-tier2`). They assert the eval CONTRACT, the no-priming property,
 * the per-run NONCE tagging, and the D2 assert-then-best-effort-cleanup ORDER,
 * WITHOUT touching the live ParaBank DOM: they read the built entry objects and
 * drive the cleanup decision with a fake verb client, so they are deterministic
 * and network-free.
 *
 * They live under `evals/` (NOT `packages/*`), so the repo gate (`pnpm test` =
 * `pnpm --filter './packages/*' test`) never runs them; they run only under the
 * harness's own `self-test` vitest. The acceptance criterion "no automated test
 * added here hits the live Tier-2 DOM inside the gate" holds two ways: by
 * LOCATION (outside the gate) AND by NATURE (these never open ParaBank at all;
 * the live run is the opt-in `run-eval` runner only).
 */

const ENTRY_URL = 'https://parabank.parasoft.com/parabank/index.htm';

describe('Tier-2 ParaBank eval (offline contract + no-priming + nonce + D2 order)', () => {
	it('is a tier-2 ParaBank entry at the fixed public entry URL', () => {
		const entry = buildParabankTransferEval('abc123');
		expect(entry.tier).toBe('tier-2');
		expect(entry.target).toBe('ParaBank');
		expect(entry.entryUrl).toBe(ENTRY_URL);
		expect(entry.id).toBe('parabank-transfer');
	});

	it('passes the no-priming guard (no selectors / no foreign URL)', () => {
		const entry = buildParabankTransferEval('abc123');
		expect(() => assertNoPriming(entry)).not.toThrow();
	});

	it('hands the agent ONLY the goal-prompt + the verb-surface reference (no harness selectors leak)', () => {
		const entry = buildParabankTransferEval('abc123');
		const input = buildAgentInput(entry);
		expect(input).toContain(entry.goalPrompt.trim());
		expect(input).toContain(VERB_SURFACE_REFERENCE);
		// The HARNESS-side ParaBank locators must never reach the agent.
		expect(input).not.toMatch(/page\.locator\(/);
		expect(input).not.toMatch(/#accountTable|activity\.htm|input\[name/);
	});

	it('names no URL beyond the single entry point', () => {
		const entry = buildParabankTransferEval('abc123');
		const urls = entry.goalPrompt.match(/https?:\/\/[^\s"'`)<>]+/gi) ?? [];
		for (const url of urls) {
			expect(url.replace(/\/+$/, '')).toBe(ENTRY_URL.replace(/\/+$/, ''));
		}
	});

	it('carries the ordered milestones for partial credit', () => {
		const entry = buildParabankTransferEval('abc123');
		expect(entry.milestones.map((m) => m.id)).toEqual([
			'reached-registered',
			'opened-second-account',
			'transfer-submitted',
			'transfer-confirmed',
		]);
	});

	it('asserts a non-empty end state targeting THIS run nonce amount', () => {
		const nonce = 'abc123';
		const entry = buildParabankTransferEval(nonce);
		const amount = nonceTransferAmount(nonce);
		expect(entry.endState.length).toBeGreaterThan(0);
		expect(entry.endState[0].describe).toContain(amount);
	});

	it('ParaBank declares NO cleanup (no clean delete -> leans on the nonce artifact, D2.3)', () => {
		const entry = buildParabankTransferEval('abc123');
		expect(entry.cleanup).toBeUndefined();
	});

	describe('per-run NONCE tagging (D2.1, the correctness mechanism)', () => {
		it('mints a fresh, unique, alphanumeric nonce each run', () => {
			const a = mintNonce();
			const b = mintNonce();
			expect(a).toMatch(/^[0-9a-z]+$/);
			expect(a).not.toBe(b);
		});

		it('two runs get DIFFERENT usernames + amounts (independent re-runs)', () => {
			const e1 = buildParabankTransferEval(mintNonce());
			const e2 = buildParabankTransferEval(mintNonce());
			expect(e1.goalPrompt).not.toBe(e2.goalPrompt);
		});

		it('the goal-prompt and the end-state assertion carry the SAME nonce amount', () => {
			const nonce = 'zzz999';
			const amount = nonceTransferAmount(nonce);
			const entry = buildParabankTransferEval(nonce);
			// The agent is TOLD the exact amount (a value, not a selector)...
			expect(entry.goalPrompt).toContain(`$${amount}`);
			// ...and the harness asserts that SAME amount (so it targets this run).
			expect(entry.endState[0].describe).toContain(amount);
		});

		it('the username carries the nonce and the amount is a 2-decimal non-.00 value', () => {
			const nonce = 'abc123';
			expect(nonceUsername(nonce)).toContain(nonce);
			const amount = nonceTransferAmount(nonce);
			expect(amount).toMatch(/^500\.\d{2}$/);
			expect(amount).not.toBe('500.00');
		});
	});

	describe('D2 assert-then-best-effort-cleanup ORDER (machinery, never flips verdict)', () => {
		/** A fake verb client; cleanup never actually drives a browser here. */
		const fakeVerbs = {} as unknown as VerbClient;

		/** A spying cleanup that records it ran. */
		function spyCleanup(): {cleanup: EvalCleanup; ran: () => boolean} {
			const run = vi.fn(async () => {});
			return {
				cleanup: {describe: 'best-effort delete', run},
				ran: () => run.mock.calls.length > 0,
			};
		}

		function withCleanup(cleanup: EvalCleanup): EvalEntry {
			return {...buildParabankTransferEval('abc123'), cleanup};
		}

		it('a clean PASS runs the cleanup (assert FIRST, delete SECOND)', async () => {
			const {cleanup, ran} = spyCleanup();
			const status = await runPostPassCleanup(
				withCleanup(cleanup),
				fakeVerbs,
				'PASS',
			);
			expect(status).toBe('ran');
			expect(ran()).toBe(true);
		});

		it('a FAIL does NOT run cleanup (keep state for inspection, D2.4)', async () => {
			const {cleanup, ran} = spyCleanup();
			const status = await runPostPassCleanup(
				withCleanup(cleanup),
				fakeVerbs,
				'FAIL',
			);
			expect(status).toBe('skipped');
			expect(ran()).toBe(false);
		});

		it('an INCONCLUSIVE run does NOT run cleanup (keep state for inspection, D2.4)', async () => {
			const {cleanup, ran} = spyCleanup();
			const status = await runPostPassCleanup(
				withCleanup(cleanup),
				fakeVerbs,
				'INCONCLUSIVE',
			);
			expect(status).toBe('skipped');
			expect(ran()).toBe(false);
		});

		it('a THROWING cleanup is swallowed (best-effort: never flips the PASS)', async () => {
			const cleanup: EvalCleanup = {
				describe: 'failing delete',
				run: async () => {
					throw new Error('delete-account flow changed');
				},
			};
			// Must NOT throw, and must report the failure WITHOUT affecting the verdict.
			const status = await runPostPassCleanup(
				withCleanup(cleanup),
				fakeVerbs,
				'PASS',
			);
			expect(status).toBe('failed');
		});

		it('an entry with NO cleanup (ParaBank) is "skipped" on PASS (absent delete is fine)', async () => {
			const entry = buildParabankTransferEval('abc123');
			expect(entry.cleanup).toBeUndefined();
			const status = await runPostPassCleanup(entry, fakeVerbs, 'PASS');
			expect(status).toBe('skipped');
		});
	});
});
