import type {EvalEntry, EndStateCheck} from './eval-contract.js';
import type {VerbClient} from './verb-client.js';

/**
 * The SCORER (prd property; user stories 2, 9): the harness's INDEPENDENT
 * verdict, made via webhands' OWN read verbs AFTER the agent reports done. It
 * never trusts the agent's self-report; the report only TRIGGERS this.
 *
 * It reports a binary pass/fail AND the ordered milestones reached
 * (partial credit, user story 9): each milestone is itself a verb-checked end
 * state, and the scorer reports the longest reached PREFIX, the natural reading
 * of "how far did the agent get".
 */

/** The result of scoring one eval's end state. */
export interface ScoreResult {
	/** True iff every {@link EvalEntry.endState} check passed. */
	readonly passed: boolean;
	/** The ids of the milestones reached, the longest ordered prefix. */
	readonly milestonesReached: readonly string[];
	/** The total milestone count (for the legible `n/m` report). */
	readonly milestoneTotal: number;
	/** A per-check trace (label -> passed) for the report. */
	readonly checks: readonly {
		readonly describe: string;
		readonly passed: boolean;
	}[];
}

/**
 * Score an eval against the live page through the read verbs. Walks the ordered
 * milestones in sequence, stopping the partial-credit count at the first
 * UNREACHED milestone (so the result is the longest prefix the agent achieved),
 * then evaluates the final end-state assertion for the binary verdict.
 *
 * A check that THROWS counts as NOT passed (the harness could not confirm the
 * end state, so it is not a pass). Distinguishing "site down" from "agent
 * failed" is the PRECHECK's job, not the scorer's: the scorer only answers
 * "is the asserted end state present right now?".
 */
export async function scoreEval(
	entry: EvalEntry,
	verbs: VerbClient,
): Promise<ScoreResult> {
	const milestonesReached: string[] = [];
	for (const milestone of entry.milestones) {
		const reached = await safeCheck(milestone.check, verbs);
		if (!reached) break; // longest-prefix: stop at the first unreached one.
		milestonesReached.push(milestone.id);
	}

	const checks: {describe: string; passed: boolean}[] = [];
	let passed = entry.endState.length > 0; // an empty end state is never a pass.
	for (const check of entry.endState) {
		const ok = await safeCheck(check, verbs);
		checks.push({describe: check.describe, passed: ok});
		if (!ok) passed = false;
	}

	return {
		passed,
		milestonesReached,
		milestoneTotal: entry.milestones.length,
		checks,
	};
}

/** Run a check, treating a throw as "not passed" (the end state was unconfirmable). */
async function safeCheck(
	check: EndStateCheck,
	verbs: VerbClient,
): Promise<boolean> {
	try {
		return await check.check(verbs);
	} catch {
		return false;
	}
}
