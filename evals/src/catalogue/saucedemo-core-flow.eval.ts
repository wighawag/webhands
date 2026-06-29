import type {EvalEntry} from '../eval-contract.js';

/**
 * TIER-1 SauceDemo CORE-FLOW eval (prd `agent-capability-eval-harness`, user
 * story 6; task `eval-saucedemo-tier1`). The first REAL capability eval, on the
 * simplest, most stable, RESET-FREE target.
 *
 * SauceDemo (`saucedemo.com`) is a fixed public demo store with no persistent
 * server state, so this eval is trivially re-runnable and needs NO per-run
 * account hygiene (prd D2 is a Tier-2 contract, explicitly not SauceDemo). The
 * store flow the agent must compose unaided is: log in, sort the products by
 * price, add the cheapest to the cart, and complete the multi-step checkout to
 * the order-complete confirmation.
 *
 * NO-PRIMING (prd property 3): the goal-prompt names the entry URL and the
 * fixed demo login ONLY (the login credentials are PUBLIC and shown on the entry
 * page itself, so naming them is login, NOT site-DOM selector-priming). It
 * carries no selectors, no step list, and no site URL beyond the entry point;
 * the HARNESS's own end-state Playwright locators below are never handed to the
 * agent.
 *
 * END STATE asserted BY THE HARNESS (prd property 2) via webhands read verbs,
 * never the agent's self-report:
 *  - precheck landmark: the login button (`#login-button`) is present;
 *  - milestone `reached-login`: the inventory list (`.inventory_list`) rendered;
 *  - milestone `reached-cart`: the cart badge shows at least one item;
 *  - milestone `reached-checkout`: a checkout-step page was reached;
 *  - milestone `order-confirmed` / end state: the order-complete confirmation
 *    container is present AND the URL is the checkout-complete page.
 */

/** The fixed public SauceDemo entry point (named to the agent; nothing beyond). */
const ENTRY_URL = 'https://www.saucedemo.com/';

/**
 * The high-level natural-language goal handed to the UNAIDED agent. It states
 * the job and the PUBLIC fixed demo login (shown on the entry page), but NO
 * selectors, NO steps, and NO URL beyond {@link ENTRY_URL}. The no-priming guard
 * ({@link ../no-priming.js#assertNoPriming}) enforces this before any launch.
 */
const GOAL_PROMPT =
	'Go to the store at https://www.saucedemo.com/ and complete a full ' +
	'purchase. Log in with the standard demo account (username `standard_user`, ' +
	'password `secret_sauce`), sort the products so the cheapest is first, add ' +
	'the single cheapest product to the cart, then go through the checkout and ' +
	'finish the order so the order-complete confirmation is shown. Use whatever ' +
	'first name, last name, and postal code you like when the checkout asks for ' +
	'them.';

/** The Tier-1 SauceDemo core-flow eval entry (a STATIC real-site entry). */
export const saucedemoCoreFlowEval: EvalEntry = {
	id: 'saucedemo-core-flow',
	tier: 'tier-1',
	target: 'SauceDemo',
	entryUrl: ENTRY_URL,
	goalPrompt: GOAL_PROMPT,
	health: [
		{
			describe: 'the login button (#login-button) is present on the entry page',
			check: (verbs) => verbs.exists(`page.locator('#login-button')`),
		},
	],
	milestones: [
		{
			id: 'reached-login',
			check: {
				describe:
					'logged in: the inventory product list (.inventory_list) rendered',
				check: (verbs) => verbs.exists(`page.locator('.inventory_list')`),
			},
		},
		{
			id: 'reached-cart',
			check: {
				describe:
					'the cart badge shows at least one item (.shopping_cart_badge)',
				check: (verbs) => verbs.exists(`page.locator('.shopping_cart_badge')`),
			},
		},
		{
			id: 'reached-checkout',
			check: {
				describe:
					'a checkout-step page was reached (URL contains checkout-step)',
				check: async (verbs) => (await verbs.url()).includes('checkout-step'),
			},
		},
		{
			id: 'order-confirmed',
			check: {
				describe:
					'the order-complete confirmation (.checkout_complete_container) is present',
				check: (verbs) =>
					verbs.exists(`page.locator('.checkout_complete_container')`),
			},
		},
	],
	endState: [
		{
			describe:
				'the order-complete confirmation container is present on the page',
			check: (verbs) =>
				verbs.exists(`page.locator('.checkout_complete_container')`),
		},
		{
			describe:
				'the page is the checkout-complete page (URL ends checkout-complete.html)',
			check: async (verbs) => (await verbs.url()).includes('checkout-complete'),
		},
	],
};

export default saucedemoCoreFlowEval;
