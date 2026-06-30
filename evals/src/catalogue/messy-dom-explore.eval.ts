import type {EvalEntry} from '../eval-contract.js';
import type {VerbClient} from '../verb-client.js';
import {
	computeExpectedTarget,
	type MessyDomModel,
} from '../messy-dom-fixture.js';

/**
 * The MESSY-DOM, explore-then-act TIER-3 eval (task
 * `eval-tier3-local-messy-dom-explore-then-act`). The FIRST stable tier-3 eval
 * that measures webhands' INTENDED edge: driving a MESSY, unfamiliar DOM where a
 * blind write-once script breaks down because the agent must EXPLORE (snapshot /
 * read) to FIND the right elements before it can act. It replaces the
 * head-to-head gap left by the hard-down live `magento-checkout` tier-3 (finding
 * `work/notes/findings/magento-demo-tier3-stability.md`), so the tier-3 reading
 * is reproducible and immune to third-party outages.
 *
 * It targets the LOCAL messy-DOM fixture (`../messy-dom-fixture.js`), whose every
 * value is a pure function of the per-run nonce, so this module is a BUILDER
 * `(model) => EvalEntry` (like the dynamic + ParaBank builders): the nonce-seeded
 * model is baked into the harness's end-state assertion (the correct code it
 * checks), while the GOAL stays nonce-free (it names the CONDITION - act on the
 * entry the PAGE's instruction describes - never any selector/word/code).
 *
 * THE MESSY LEVERS (why a blind script provably cannot encode the flow, all
 * nonce-seeded so a cached script is useless; both legs face the IDENTICAL DOM,
 * so the edge is the EXPLORE surface, not a rigged DOM):
 *  - NO STABLE HOOKS ON THE TARGETS: the section toggles + option rows carry NO
 *    id/testid/name/role and nonce-random class names, so neither toolkit can
 *    hardcode a selector; both must locate by visible text/structure at run time.
 *  - TARGET BY RUN-REVEALED CONTENT: the page's instruction names a nonce-seeded
 *    section WORD + option CODE; the correct controls are the matching ones. A
 *    blind script cannot pre-encode either.
 *  - MULTI-STEP REVEAL: the option rows are not on the first view - the agent
 *    must OPEN the correct section (act) to REVEAL them (read again), then act.
 *  - DECOYS + LATE CONTENT: several similar rows per section (one correct), and
 *    the rows are injected via a short setTimeout, so the agent must pace + reread.
 *
 * NO-PRIMING (prd property 3): the goal names the entry URL and the dynamic
 * CONDITION ("open the section and select the entry the page's instruction
 * describes"), with NO selectors, NO class names, NO section word, NO code, NO
 * step list. It passes {@link ../no-priming.js#assertNoPriming}.
 *
 * END STATE asserted BY THE HARNESS (prd property 2) via webhands read verbs,
 * NEVER the agent's self-report, and DETERMINISTICALLY checkable: the harness
 * reads the on-page result marker (`#explore-result`) and asserts its
 * `data-selected-code` equals the nonce-seeded correct code
 * ({@link computeExpectedTarget}). A wrong-row click never writes the marker, so a
 * decoy action is a genuine FAIL:
 *  - precheck landmark: the directory landmark (`#app-ready`) is present;
 *  - milestone `reached-directory`: the sections rendered;
 *  - milestone `section-opened`: at least one section panel was opened;
 *  - milestone `option-revealed`: at least one option row was revealed (late
 *    content arrived after a section opened);
 *  - milestone `correct-selected` / end state: the result marker carries the
 *    nonce-seeded correct code (the right row was actioned).
 */

/**
 * Build the messy-DOM explore eval for ONE run's resolved fixture model (its
 * nonce-seeded sections + correct target). The harness reads the live page for
 * its verdict; the model supplies the expected code the harness checks the
 * on-page result marker against, so the assertion stays the harness's own read.
 */
export function buildMessyDomExploreEval(
	entryUrl: string,
	model: MessyDomModel,
): EvalEntry {
	const goalPrompt =
		`You are at a small directory page at ${entryUrl} . The page shows an ` +
		'instruction describing exactly ONE entry to select: it names a section to ' +
		'open and the code of the entry within it to choose. Read the page to find ' +
		"which section and which entry the page's instruction is describing, open " +
		'that section, and select that one entry, so the page confirms your ' +
		'selection. The section names, the entries, and which one is the right ' +
		'target are only shown on the page at run time, and the entries appear a ' +
		'moment after you open a section, so read the page as you go and wait for ' +
		'the entries to load.';

	return {
		id: 'messy-dom-explore',
		tier: 'tier-3',
		target: 'local-fixture',
		entryUrl,
		goalPrompt,
		health: [
			{
				describe:
					'the directory landmark (#app-ready) is present on the entry page',
				check: (verbs) => verbs.exists(`page.locator('#app-ready')`),
			},
			{
				describe: 'the on-page instruction is shown on the entry page',
				check: (verbs) => verbs.exists(`page.locator('#explore-instruction')`),
			},
		],
		milestones: [
			{
				id: 'reached-directory',
				check: {
					describe: 'the sections rendered (#sections has at least one child)',
					check: async (verbs) =>
						(await verbs.count(`page.locator('#sections > div')`)) >= 1,
				},
			},
			{
				id: 'section-opened',
				check: {
					describe: 'at least one section panel was opened (data-open=true)',
					check: async (verbs) =>
						(await verbs.count(`page.locator('[data-open="true"]')`)) >= 1,
				},
			},
			{
				id: 'option-revealed',
				check: {
					describe:
						'at least one option row was revealed after a section opened',
					check: async (verbs) =>
						(await verbs.count(`page.locator('[data-open="true"] > div')`)) >=
						1,
				},
			},
			{
				id: 'correct-selected',
				check: {
					describe:
						'the result marker carries the nonce-seeded correct entry code',
					check: (verbs) => correctCodeSelected(verbs, model),
				},
			},
		],
		endState: [
			{
				describe:
					'the result marker (#explore-result) carries the nonce-seeded correct entry code (the right entry was actioned)',
				check: (verbs) => correctCodeSelected(verbs, model),
			},
		],
	};
}

/**
 * Did the agent action the CORRECT row? Read the on-page result marker's
 * `data-selected-code` (the marker is written ONLY when the correct row is
 * clicked) and assert it equals the nonce-seeded expected code. The expected code
 * is preferred from the live on-page instruction (so the harness asserts against
 * the page, not a remembered value); it falls back to the model's computed target
 * only if the page read fails, so a missing attribute cannot silently pass.
 */
async function correctCodeSelected(
	verbs: VerbClient,
	model: MessyDomModel,
): Promise<boolean> {
	const selected = await verbs.getAttribute(
		`page.locator('#explore-result')`,
		'data-selected-code',
	);
	if (selected === null || selected.trim() === '') return false;
	const expected = await readExpectedCode(verbs, model);
	return selected === expected;
}

/**
 * Read the EXPECTED code (the code the agent had to select). Prefer the live
 * page's instruction `data-code` (assert against the page, not a remembered
 * value); fall back to the model's computed target only if the read fails.
 */
async function readExpectedCode(
	verbs: VerbClient,
	model: MessyDomModel,
): Promise<string> {
	const raw = await verbs.getAttribute(
		`page.locator('#explore-instruction')`,
		'data-code',
	);
	if (raw !== null && raw.trim() !== '') return raw;
	return computeExpectedTarget(model).optionCode;
}

export default buildMessyDomExploreEval;
