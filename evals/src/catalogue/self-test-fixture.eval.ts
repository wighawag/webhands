import type {EvalEntry} from '../eval-contract.js';

/**
 * The TRIVIAL catalogue entry exercised ONLY by the D3 machinery self-test (prd
 * D3; task: "Ship at least one trivial catalogue entry exercised only by the
 * self-test fixture"). One file per eval (work/ contract rule 2: no shared
 * manifest); the catalogue is the set of `*.eval.ts` modules.
 *
 * It targets the LOCAL self-test fixture (`evals/test/fixture-pages.ts`), so its
 * `entryUrl` is the fixture server's ephemeral base URL, supplied at run time:
 * this module exports a BUILDER `(baseUrl) => EvalEntry` rather than a static
 * entry. A real-site per-tier eval (SauceDemo/Magento) exports a STATIC entry
 * with a fixed URL instead; both are just `EvalEntry`s.
 *
 * CRUCIAL: this is a MACHINERY check, never a capability subject. It is only
 * ever driven by the PRIMED scripted trace (the D3 fixture), which the
 * no-priming rule does NOT bind. A green run here proves the harness's logic,
 * NOT an agent's capability.
 */

/** The fixture's milestone/end-state goal in plain language (no priming). */
const GOAL_PROMPT =
	'On the page you are given, add a task to the list, then submit the tasks ' +
	'and reach the confirmation that they were submitted.';

/**
 * Build the self-test eval entry against a fixture base URL (an ephemeral
 * `http://127.0.0.1:<port>`). The end states are all verb-checkable against the
 * local fixture DOM:
 *  - precheck landmark: the entry page's `#app-ready` is present;
 *  - milestone `reached-list`: the empty task list element exists;
 *  - milestone `item-added`: at least one `.task-item` row was appended;
 *  - end state: the in-page confirmation `#confirmed` became VISIBLE on submit.
 */
export function buildSelfTestEval(baseUrl: string): EvalEntry {
	const entryUrl = `${baseUrl}/`;
	return {
		id: 'self-test-fixture',
		tier: 'self-test',
		target: 'local-fixture',
		entryUrl,
		goalPrompt: GOAL_PROMPT,
		health: [
			{
				describe: 'entry page landmark #app-ready is present',
				check: (verbs) => verbs.exists(`page.locator('#app-ready')`),
			},
		],
		milestones: [
			{
				id: 'reached-list',
				check: {
					describe: 'the task list element exists',
					check: (verbs) => verbs.exists(`page.locator('#task-list')`),
				},
			},
			{
				id: 'item-added',
				check: {
					describe: 'at least one task row was added',
					check: async (verbs) =>
						(await verbs.count(`page.locator('.task-item')`)) >= 1,
				},
			},
		],
		endState: [
			{
				describe: 'the submitted-tasks confirmation (#confirmed) is visible',
				check: (verbs) => verbs.isVisible(`page.locator('#confirmed')`),
			},
		],
	};
}
