import type {EvalEntry} from '../eval-contract.js';
import type {VerbClient} from '../verb-client.js';
import type {DynamicFixtureModel} from '../dynamic-fixture.js';

/**
 * The DYNAMIC, non-one-shot-scriptable eval (task
 * `eval-dynamic-non-scriptable-mid-run-goal-shift`; idea
 * `work/notes/ideas/dynamic-evals-that-cannot-be-one-shot-scripted.md`). The
 * FIRST eval a write-once-run-once BLIND script cannot win, because the correct
 * actions resolve ONLY from live, varying page state, so both toolkits must
 * observe-then-act. It measures the verb surface's look->decide->act value the
 * statically-scriptable tier-1/2/3 evals under-measure (`evals/SCOREBOARD.md`).
 *
 * It targets the LOCAL dynamic fixture (`../dynamic-fixture.js`), whose every
 * value is a pure function of the per-run nonce, so this module is a BUILDER
 * `(model) => EvalEntry` (like the ParaBank + self-test builders): the nonce-
 * seeded model is baked into the harness's end-state assertion (the threshold it
 * reads), while the GOAL stays nonce-free (it names the CONDITION, never values).
 *
 * THE DYNAMIC LEVERS (why a blind script provably cannot encode the flow):
 *  - MID-RUN TERMINATION ON A LIVE VALUE: "add items until the shown subtotal
 *    EXCEEDS the shown free-shipping threshold, then check out". The threshold is
 *    nonce-randomised and only on the page, so no fixed script encodes the stop.
 *  - RUNTIME-REVEALED VARYING TARGET: the catalogue's prices + order are
 *    nonce-seeded, so which/how many items clear the threshold varies per run.
 *  - SUBTOTAL NOT PRECOMPUTABLE FROM THE CARDS: a per-item handling fee is added
 *    in the cart ONLY, so even reading every card price up front cannot compute
 *    the running subtotal, the agent must add, READ the live cart subtotal, and
 *    decide. That forces a genuine read-act-read LOOP a single script cannot
 *    one-shot (the crux the idea note flags: Playwright CAN read-and-branch in
 *    one script, so the levers must defeat even that).
 *
 * NO-PRIMING (prd property 3): the goal names the entry URL and the dynamic
 * CONDITION ("until the subtotal shown on the page is greater than the
 * free-shipping threshold shown on the page"), with NO selectors, NO specific
 * values, NO step list. It passes {@link ../no-priming.js#assertNoPriming}.
 *
 * END STATE asserted BY THE HARNESS (prd property 2) via webhands read verbs,
 * NEVER the agent's self-report, and DETERMINISTICALLY checkable despite the
 * dynamic path: the harness reads the on-page final subtotal + the on-page
 * threshold and asserts the order completed AND the final subtotal EXCEEDS the
 * threshold. It does NOT re-derive the agent's item choices, so ANY valid cart
 * that clears the threshold passes:
 *  - precheck landmark: the store landmark (`#app-ready`) is present;
 *  - milestone `reached-store`: the catalogue rendered;
 *  - milestone `item-in-cart`: at least one cart line was added;
 *  - milestone `subtotal-cleared-threshold`: the live cart subtotal exceeds the
 *    shown threshold (the dynamic stop condition was MET on the page);
 *  - milestone `order-confirmed` / end state: the order-complete confirmation is
 *    present AND its final subtotal exceeds the threshold.
 */

/**
 * Build the dynamic cart-threshold eval for ONE run's resolved fixture model
 * (its nonce-seeded threshold + catalogue). The harness reads the live page for
 * its verdict; the model supplies only the fallback threshold value used if the
 * page read fails, so the assertion stays the harness's own page read.
 */
export function buildCartThresholdCheckoutEval(
	entryUrl: string,
	model: DynamicFixtureModel,
): EvalEntry {
	const goalPrompt =
		`You are shopping at a small online store at ${entryUrl} . The store ` +
		'offers free shipping once your cart subtotal goes OVER a threshold the ' +
		'page shows you. Add items to your cart until the cart subtotal shown on ' +
		'the page is GREATER THAN that free-shipping threshold shown on the page, ' +
		'then check out so the order-complete confirmation is shown. Add only as ' +
		'many items as you need to get past the threshold. The exact prices, the ' +
		'threshold, and how the subtotal adds up are only shown on the page at run ' +
		'time, so read the page as you go.';

	return {
		id: 'cart-threshold-checkout',
		tier: 'tier-2',
		target: 'local-fixture',
		entryUrl,
		goalPrompt,
		health: [
			{
				describe:
					'the store landmark (#app-ready) is present on the entry page',
				check: (verbs) => verbs.exists(`page.locator('#app-ready')`),
			},
			{
				describe: 'the free-shipping threshold is shown on the entry page',
				check: (verbs) =>
					verbs.exists(`page.locator('#free-shipping-threshold')`),
			},
		],
		milestones: [
			{
				id: 'reached-store',
				check: {
					describe: 'the catalogue rendered (#catalogue is present)',
					check: (verbs) => verbs.exists(`page.locator('#catalogue')`),
				},
			},
			{
				id: 'item-in-cart',
				check: {
					describe: 'at least one item was added to the cart (.cart-line)',
					check: async (verbs) =>
						(await verbs.count(`page.locator('.cart-line')`)) >= 1,
				},
			},
			{
				id: 'subtotal-cleared-threshold',
				check: {
					describe:
						'the live cart subtotal exceeds the shown free-shipping threshold',
					check: (verbs) => cartSubtotalExceedsThreshold(verbs, model),
				},
			},
			{
				id: 'order-confirmed',
				check: {
					describe:
						'the order-complete confirmation (#order-confirmed) is present',
					check: (verbs) => verbs.exists(`page.locator('#order-confirmed')`),
				},
			},
		],
		endState: [
			{
				describe:
					'the order-complete confirmation is present AND its final subtotal exceeds the shown threshold',
				check: (verbs) => orderClearedThreshold(verbs, model),
			},
		],
	};
}

/**
 * Read the on-page THRESHOLD (the value the agent had to beat). Prefer the live
 * page's `data-threshold` (the harness asserts against the page, not a
 * remembered number); fall back to the model's threshold only if the read fails,
 * so a missing attribute cannot silently pass the assertion.
 */
async function readThreshold(
	verbs: VerbClient,
	model: DynamicFixtureModel,
): Promise<number> {
	const raw = await verbs.getAttribute(
		`page.locator('#free-shipping-threshold')`,
		'data-threshold',
	);
	const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
	return Number.isFinite(parsed) ? parsed : model.threshold;
}

/**
 * Does the LIVE cart subtotal (read off the page) exceed the shown threshold?
 * The dynamic stop condition, read purely from the page so it is deterministic
 * regardless of which items the agent chose.
 */
async function cartSubtotalExceedsThreshold(
	verbs: VerbClient,
	model: DynamicFixtureModel,
): Promise<boolean> {
	const raw = await verbs.getAttribute(
		`page.locator('#cart-subtotal')`,
		'data-subtotal',
	);
	if (raw === null) return false;
	const subtotal = Number.parseFloat(raw);
	if (!Number.isFinite(subtotal)) return false;
	const threshold = await readThreshold(verbs, model);
	return subtotal > threshold;
}

/**
 * The END STATE: the order completed AND its FINAL subtotal (read off the
 * confirmation) exceeds the shown threshold. Both reads are the harness's own,
 * so a valid run of ANY clearing cart passes and an under-threshold checkout
 * FAILs, without re-deriving the agent's choices.
 */
async function orderClearedThreshold(
	verbs: VerbClient,
	model: DynamicFixtureModel,
): Promise<boolean> {
	const confirmed = await verbs.exists(`page.locator('#order-confirmed')`);
	if (!confirmed) return false;
	const raw = await verbs.getAttribute(
		`page.locator('#order-confirmed')`,
		'data-final-subtotal',
	);
	if (raw === null) return false;
	const finalSubtotal = Number.parseFloat(raw);
	if (!Number.isFinite(finalSubtotal)) return false;
	const threshold = await readThreshold(verbs, model);
	return finalSubtotal > threshold;
}

export default buildCartThresholdCheckoutEval;
