import type {EvalEntry} from '../eval-contract.js';
import type {VerbClient} from '../verb-client.js';
import {mintNonce, nonceTransferAmount, nonceUsername} from '../nonce.js';

/**
 * TIER-2 ParaBank STATEFUL/BRANCHING eval (prd `agent-capability-eval-harness`,
 * user stories 7, 11; ## Resolved decisions D2; task `eval-stateful-tier2`).
 *
 * ParaBank (`parabank.parasoft.com`) is a fake online bank: a CONSEQUENTIAL,
 * strongly-stateful, branching flow (register -> open a second account ->
 * transfer funds -> confirm the transaction) on a SHARED public instance with NO
 * clean account delete. It is the first Tier-2 target shipped (AutomationExercise
 * can follow as a second `*.eval.ts` entry with an in-flow delete cleanup).
 *
 * D2 ACCOUNT HYGIENE, the heart of this task, in strict order:
 *  1. FRESH per-run NONCE-tagged identity every run: a unique username AND a
 *     nonce-tagged TRANSFER AMOUNT (ParaBank has no free-text memo, so the AMOUNT
 *     is the tagged artifact, e.g. `$500.37`). The harness asserts against THIS
 *     run's amount, never a leftover $500.00 transfer, so re-runs are independent
 *     and the assertion is unambiguous. This is the CORRECTNESS mechanism; it
 *     does not depend on any cleanup succeeding.
 *  2. ASSERT the end state + milestones BEFORE any cleanup (the scorer/outcome).
 *  3. ParaBank has NO clean delete, so this entry declares NO {@link EvalEntry.cleanup}
 *     and leans entirely on the nonce-tagged artifact. A missing delete NEVER
 *     flips the verdict (D2.3).
 *  4. (Moot here, since there is no cleanup.) A FAIL/INCONCLUSIVE run keeps state
 *     for inspection; only a clean PASS would trigger cleanup (D2.4) where one
 *     exists.
 *
 * This eval is a per-run BUILDER `(nonce) => EvalEntry` (like the self-test
 * builder), because the nonce must be baked into BOTH the goal-prompt (the
 * amount the agent is told to transfer, a VALUE not a selector, so no priming)
 * AND the harness's end-state assertion (the amount it looks for). The runner
 * mints a fresh nonce per invocation.
 *
 * NO-PRIMING (prd property 3): the goal names the entry URL, a username/password
 * to register with, and the exact transfer amount (all VALUES the agent uses,
 * not site-DOM selectors/steps). It carries no selectors, no step list, and no
 * URL beyond the entry point; the HARNESS-side ParaBank locators below are never
 * handed to the agent.
 *
 * END STATE asserted BY THE HARNESS (prd property 2) via webhands read verbs,
 * NEVER the agent's self-report, and targeted at THIS run's nonce artifact:
 *  - precheck landmark: the login form (`input[name='username']`) is present;
 *  - milestone `reached-registered`: logged in (the account-overview table is
 *    reachable, i.e. a session exists);
 *  - milestone `opened-second-account`: the overview lists at least TWO accounts;
 *  - milestone `transfer-submitted`: the page the agent left confirms a transfer
 *    ("Transfer Complete!");
 *  - end state `transfer-confirmed`: a transaction for THIS run's nonce-tagged
 *    AMOUNT is present in an account's activity (read durably from the overview +
 *    that account's activity page), so the leftover-transfer ambiguity is closed.
 */

/** The fixed public ParaBank entry point (named to the agent; nothing beyond). */
const ENTRY_URL = 'https://parabank.parasoft.com/parabank/index.htm';

/** ParaBank's logged-in account-overview page (a DURABLE harness read surface). */
const OVERVIEW_URL = 'https://parabank.parasoft.com/parabank/overview.htm';

/**
 * Build the Tier-2 ParaBank eval for ONE run's nonce. The nonce produces a fresh
 * username + a nonce-tagged transfer amount; both are baked into the goal-prompt
 * AND the end-state assertion so the harness checks exactly this run's artifact.
 */
export function buildParabankTransferEval(
	nonce: string = mintNonce(),
): EvalEntry {
	const username = nonceUsername(nonce);
	const amount = nonceTransferAmount(nonce); // e.g. "500.37"
	const password = `Pw-${nonce}`;

	const goalPrompt =
		'You are using ParaBank, a demo online bank at ' +
		`${ENTRY_URL} . Do the following as a NEW customer:\n` +
		`1. Register a brand-new account using the username "${username}" and the ` +
		`password "${password}" (make up any personal details the form asks for).\n` +
		'2. Once registered and logged in, open a SECOND bank account for yourself ' +
		'(any account type) so you have at least two accounts.\n' +
		`3. Transfer exactly $${amount} from one of your accounts to your other ` +
		'account.\n' +
		'4. Complete the transfer so the "Transfer Complete" confirmation is shown.\n' +
		`Use the exact amount $${amount} for the transfer; it identifies your run.`;

	return {
		id: 'parabank-transfer',
		tier: 'tier-2',
		target: 'ParaBank',
		entryUrl: ENTRY_URL,
		goalPrompt,
		health: [
			{
				describe:
					"the login form (input[name='username']) is present on the entry page",
				check: (verbs) =>
					verbs.exists(`page.locator('input[name="username"]')`),
			},
			{
				describe: 'the Register link is present on the entry page',
				check: (verbs) =>
					verbs.exists(`page.locator('a[href*="register.htm"]')`),
			},
		],
		milestones: [
			{
				id: 'reached-registered',
				check: {
					describe:
						'logged in: the account-overview table is reachable (a session exists)',
					check: (verbs) => loggedIn(verbs),
				},
			},
			{
				id: 'opened-second-account',
				check: {
					describe: 'the account overview lists at least two accounts',
					check: (verbs) => accountCount(verbs).then((n) => n >= 2),
				},
			},
			{
				id: 'transfer-submitted',
				check: {
					describe:
						'a transfer confirmation ("Transfer Complete!") is on the page the agent left',
					check: (verbs) => transferConfirmationShown(verbs),
				},
			},
			{
				id: 'transfer-confirmed',
				check: {
					describe: `a transaction for this run's amount ($${amount}) is in an account's activity`,
					check: (verbs) => nonceTransactionPresent(verbs, amount),
				},
			},
		],
		endState: [
			{
				describe: `a transaction for this run's nonce-tagged amount ($${amount}) is present in an account's activity`,
				check: (verbs) => nonceTransactionPresent(verbs, amount),
			},
		],
	};
}

/**
 * Is there a logged-in session? The harness navigates to the account overview;
 * ParaBank shows `#accountTable` only when authenticated (otherwise it redirects
 * to the login error page), so the table's presence is a durable "logged in"
 * signal that does not depend on whatever transient page the agent left.
 */
async function loggedIn(verbs: VerbClient): Promise<boolean> {
	await verbs.goto(OVERVIEW_URL);
	return verbs.exists(`page.locator('#accountTable')`);
}

/**
 * How many accounts does the overview list? Each account is a row whose first
 * cell links to that account's activity (`activity.htm?id=...`); counting those
 * links is a stable account count. Navigates to the overview first.
 */
async function accountCount(verbs: VerbClient): Promise<number> {
	await verbs.goto(OVERVIEW_URL);
	return verbs.count(`page.locator('#accountTable a[href*="activity.htm"]')`);
}

/**
 * Does the page the agent left show ParaBank's transfer confirmation? Read on
 * the CURRENT page (no navigation), so it reflects where the agent finished. The
 * confirmation panel renders the "Transfer Complete!" title.
 */
async function transferConfirmationShown(verbs: VerbClient): Promise<boolean> {
	const text = (await verbs.snapshot()).toLowerCase();
	return text.includes('transfer complete');
}

/**
 * Is THIS run's nonce-tagged transfer present in an account's activity (the
 * unambiguous end-state assertion, D2.1)? Read DURABLY: navigate the overview,
 * read each account's activity page, and look for the exact nonce amount in the
 * activity table. Targeting the nonce amount is what makes the assertion immune
 * to a leftover $500.00 transfer from a prior run on this shared instance.
 *
 * Best-effort + bounded: reads at most the first few accounts (a fresh customer
 * has two), and any read error counts as "not found" (the scorer treats a throw
 * as not-passed; the precheck decides FAIL-vs-INCONCLUSIVE separately).
 */
async function nonceTransactionPresent(
	verbs: VerbClient,
	amount: string,
): Promise<boolean> {
	await verbs.goto(OVERVIEW_URL);
	const accountLinks = await verbs.count(
		`page.locator('#accountTable a[href*="activity.htm"]')`,
	);
	const toScan = Math.min(accountLinks, 5);
	for (let i = 0; i < toScan; i++) {
		const href = await verbs.getAttribute(
			`page.locator('#accountTable a[href*="activity.htm"]').nth(${i})`,
			'href',
		);
		if (href === null) continue;
		const activityUrl = absoluteParabankUrl(href);
		await verbs.goto(activityUrl);
		// ParaBank renders amounts as e.g. "$500.37"; match the nonce amount as a
		// substring of the activity page text (with and without the $ prefix).
		const text = await verbs.snapshot();
		if (text.includes(`$${amount}`) || text.includes(amount)) {
			return true;
		}
		// Re-read the overview before scanning the next account (we navigated away).
		await verbs.goto(OVERVIEW_URL);
	}
	return false;
}

/** Resolve a ParaBank relative `activity.htm?id=...` href to an absolute URL. */
function absoluteParabankUrl(href: string): string {
	try {
		return new URL(href, OVERVIEW_URL).toString();
	} catch {
		return `https://parabank.parasoft.com/parabank/${href.replace(/^\/+/, '')}`;
	}
}

export default buildParabankTransferEval;
