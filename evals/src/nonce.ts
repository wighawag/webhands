/**
 * The per-run NONCE (prd `agent-capability-eval-harness`, ## Resolved decisions
 * D2.1; task `eval-stateful-tier2`).
 *
 * D2's CORRECTNESS mechanism is that every run mints a FRESH, uniquely-tagged
 * identity (and, where the artifact is a value, tags the value too), so the
 * harness asserts against THIS run's artifact and never a leftover from a prior
 * run. The nonce is that tag: short, alphanumeric, monotonic-ish (a timestamp
 * base) plus randomness, so it is unique per run AND usable verbatim in places a
 * site constrains (a username, a transfer amount's cents).
 *
 * It is deliberately tiny and pure (no I/O): the Tier-2 eval BUILDERS take a
 * nonce and bake it into the goal-prompt + the end-state assertion, so a run is
 * reproducible from its nonce alone.
 */

/** Base-36 alphabet keeps a nonce short and URL/username-safe. */
function toBase36(n: number): string {
	return Math.floor(n).toString(36);
}

/**
 * Mint a fresh per-run nonce: a base-36 timestamp suffixed with a few random
 * base-36 chars. The timestamp keeps successive runs ordered + near-unique; the
 * random tail removes the tiny same-millisecond collision risk. The result is
 * lowercase `[0-9a-z]+`, safe to drop into a username or a memo.
 */
export function mintNonce(now: number = Date.now()): string {
	const time = toBase36(now);
	const rand = toBase36(Math.floor(Math.random() * 36 ** 4)).padStart(4, '0');
	return `${time}${rand}`;
}

/**
 * Derive the per-run TRANSFER AMOUNT (ParaBank's nonce-tagged ARTIFACT, D2.1).
 * ParaBank's internal transfer has no free-text memo, so the AMOUNT is the value
 * we tag: a fixed whole-dollar base ($500, the goal's headline figure) plus a
 * two-digit per-run cents tag derived from the nonce, e.g. `500.37`. The cents
 * tag makes THIS run's transfer row distinguishable on the confirmation /
 * activity surface from any leftover $500.00 transfer, so the end-state
 * assertion (and ParaBank's find-by-amount) targets exactly this run.
 *
 * Returns the canonical two-decimal string ParaBank renders + matches on.
 */
export function nonceTransferAmount(nonce: string, baseDollars = 500): string {
	// Fold the nonce into a stable 1..99 cents tag (never `.00`, so it is always
	// visibly distinct from a plain whole-dollar leftover transfer).
	let acc = 0;
	for (const ch of nonce) {
		acc = (acc * 31 + ch.charCodeAt(0)) % 99;
	}
	const cents = acc + 1; // 1..99
	return `${baseDollars}.${String(cents).padStart(2, '0')}`;
}

/**
 * Derive the per-run ParaBank USERNAME from the nonce: a short prefix + the
 * nonce. ParaBank requires a unique username per registration; a collision (a
 * re-used nonce) surfaces as a registration failure, which the harness reads as
 * INCONCLUSIVE (a signup/environment limit), never a capability fail.
 */
export function nonceUsername(nonce: string): string {
	return `whe${nonce}`;
}
