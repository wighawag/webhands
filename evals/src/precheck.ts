import type {EvalEntry} from './eval-contract.js';
import type {VerbClient} from './verb-client.js';

/**
 * The site-health PRECHECK (prd property; user story 10): the cheap
 * reachability/landmark read that decides FAIL vs INCONCLUSIVE.
 *
 * Before scoring a FAIL, the harness navigates the served session to the entry
 * URL and asks (through the SAME read verbs) whether the entry page loaded and
 * its expected landmarks are present. If not, the site is down / rate-limiting /
 * structurally changed, so a non-PASS is INCONCLUSIVE (and retried), NEVER a
 * capability fail. A HEALTHY site that the agent still failed is a genuine FAIL.
 */

/** The outcome of a health precheck. */
export interface HealthResult {
	/** Whether the entry site looks reachable + structurally intact. */
	readonly healthy: boolean;
	/** Which probe (or the reachability check) failed, when unhealthy. */
	readonly failedProbe?: string;
}

/**
 * Run the precheck for an eval against the live served page. Navigates to the
 * entry URL (a reachability check: a `goto` that throws ⇒ unreachable ⇒
 * unhealthy), then runs each {@link EvalEntry.health} probe. Healthy iff the
 * navigation succeeded AND every probe passed. A probe that THROWS is treated as
 * a miss (the page is not in the shape we can read), i.e. unhealthy.
 */
export async function runPrecheck(
	entry: EvalEntry,
	verbs: VerbClient,
): Promise<HealthResult> {
	try {
		await verbs.goto(entry.entryUrl);
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		return {
			healthy: false,
			failedProbe: `entry URL unreachable (${entry.entryUrl}): ${detail}`,
		};
	}
	for (const probe of entry.health) {
		let present: boolean;
		try {
			present = await probe.check(verbs);
		} catch {
			present = false;
		}
		if (!present) {
			return {healthy: false, failedProbe: probe.describe};
		}
	}
	return {healthy: true};
}
