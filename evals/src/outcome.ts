import type {EvalEntry} from './eval-contract.js';
import type {ScoreResult} from './scorer.js';
import {scoreEval} from './scorer.js';
import {runPrecheck} from './precheck.js';
import type {VerbClient} from './verb-client.js';

/**
 * The THREE-state OUTCOME + bounded RETRY (prd property; user story 10).
 *
 * The verdict is never just pass/fail: an external site rots, rate-limits, and
 * goes down, so the harness distinguishes "the agent failed" (FAIL) from "the
 * site was down / changed" (INCONCLUSIVE). The rule:
 *
 *  - score the end state via the read verbs;
 *  - if it PASSES, the outcome is PASS;
 *  - if it does NOT pass, run the site-health precheck: a HEALTHY site means the
 *    agent genuinely FAILED; an UNHEALTHY site means INCONCLUSIVE.
 *
 * INCONCLUSIVE is RETRIED a bounded number of times (the site may recover); a
 * genuine FAIL is NEVER retried (re-running a healthy failure just burns time).
 */

/** The three-state outcome. */
export type OutcomeKind = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

/** The full outcome of evaluating one eval's end state once. */
export interface Outcome {
	/** The three-state verdict. */
	readonly kind: OutcomeKind;
	/** The milestone/end-state score that produced it. */
	readonly score: ScoreResult;
	/** Why INCONCLUSIVE (the failed health probe), when applicable. */
	readonly inconclusiveReason?: string;
	/** How many attempts were made (1 + the number of INCONCLUSIVE retries). */
	readonly attempts: number;
}

/** What an outcome evaluation needs. */
export interface EvaluateOptions {
	/** The eval being judged. */
	readonly entry: EvalEntry;
	/** The harness's read-verb client (drives the live served page). */
	readonly verbs: VerbClient;
	/** Max attempts when INCONCLUSIVE (>= 1). Default 3. */
	readonly maxAttempts?: number;
	/**
	 * Optional hook called between INCONCLUSIVE retries (e.g. to wait/back off, or
	 * to RE-RUN the agent). Receives the attempt number just completed. The
	 * foundation's default is a no-op delay; a per-tier task may re-launch.
	 */
	readonly betweenRetries?: (attemptJustMade: number) => Promise<void>;
}

/**
 * Evaluate the eval's END STATE into a three-state {@link Outcome}, retrying
 * only INCONCLUSIVE up to `maxAttempts`. On each attempt: score; a pass ⇒ PASS;
 * a non-pass ⇒ precheck; healthy ⇒ FAIL (return immediately, never retried);
 * unhealthy ⇒ INCONCLUSIVE (retry if attempts remain). The LAST attempt's
 * INCONCLUSIVE is returned if every attempt was inconclusive.
 */
export async function evaluateOutcome(opts: EvaluateOptions): Promise<Outcome> {
	const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
	let lastScore: ScoreResult | undefined;
	let lastReason: string | undefined;
	let attempt = 0;

	while (attempt < maxAttempts) {
		attempt += 1;
		const score = await scoreEval(opts.entry, opts.verbs);
		lastScore = score;
		if (score.passed) {
			return {kind: 'PASS', score, attempts: attempt};
		}
		// Not a pass: is the SITE healthy (genuine agent FAIL) or down (INCONCLUSIVE)?
		const health = await runPrecheck(opts.entry, opts.verbs);
		if (health.healthy) {
			// A genuine agent FAIL on a healthy site: NEVER retried.
			return {kind: 'FAIL', score, attempts: attempt};
		}
		lastReason = health.failedProbe;
		if (attempt < maxAttempts && opts.betweenRetries !== undefined) {
			await opts.betweenRetries(attempt);
		}
	}

	return {
		kind: 'INCONCLUSIVE',
		score: lastScore!,
		inconclusiveReason: lastReason,
		attempts: attempt,
	};
}
