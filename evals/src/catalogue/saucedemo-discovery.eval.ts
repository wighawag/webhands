import type {EvalEntry} from '../eval-contract.js';

/**
 * TIER-1 SauceDemo DISCOVERY eval (prd `agent-capability-eval-harness`, user
 * story 6; task `eval-saucedemo-tier1`): a goal whose success REQUIRES the agent
 * to DISCOVER special-user behaviour it was NOT told about, and ADAPT, rather
 * than follow a scripted path.
 *
 * SauceDemo ships several SPECIAL demo accounts whose names are listed on the
 * login page but whose BEHAVIOUR is not described there. `problem_user` has a
 * subtly BROKEN UI: in particular its checkout-step-one form rejects the
 * last-name field, so a purchase CANNOT be completed under that account no
 * matter how correctly the agent drives the visible flow. The goal steers the
 * agent to START as `problem_user`; the only way to reach the order-complete
 * confirmation is to NOTICE that this account is broken and SWITCH to a working
 * demo account (e.g. `standard_user` or `performance_glitch_user`) and finish
 * there. A naive agent that simply follows "log in as problem_user and check
 * out" gets stuck at checkout and never reaches the confirmation, so a PASS here
 * is unambiguous evidence of unaided discovery + adaptation.
 *
 * NO-PRIMING (prd property 3): the goal names the entry URL, the PUBLIC fixed
 * demo password, and the demo USERNAMES (all shown on the entry page itself, so
 * this is login info, not site-DOM foreknowledge). It does NOT say WHICH account
 * is broken or HOW, does NOT name the working account to use, and carries no
 * selectors, no steps, and no URL beyond the entry point. The agent must work
 * out the special-user behaviour for itself.
 *
 * END STATE asserted BY THE HARNESS (prd property 2) via webhands read verbs:
 * the order-complete confirmation container is present AND the URL is the
 * checkout-complete page (the same mechanical end state as the core flow, but
 * here reaching it PROVES the agent escaped the broken account). Milestones give
 * partial credit for how far the unaided adaptation got.
 */

/** The fixed public SauceDemo entry point (named to the agent; nothing beyond). */
const ENTRY_URL = 'https://www.saucedemo.com/';

/**
 * The high-level natural-language goal handed to the UNAIDED agent. It names the
 * PUBLIC demo credentials (shown on the entry page) and steers the agent into
 * the broken account, but reveals NOTHING about which account is broken or how,
 * and names no working account, no selectors, and no URL beyond
 * {@link ENTRY_URL}. The no-priming guard enforces this before any launch.
 */
const GOAL_PROMPT =
	'Go to the store at https://www.saucedemo.com/ and complete a full purchase ' +
	'of any one product, finishing the checkout so the order-complete ' +
	'confirmation is shown. The demo password for every account is ' +
	'`secret_sauce`, and the login page lists the available demo usernames. ' +
	'Start by logging in as `problem_user`. If you find that this account is ' +
	'unable to complete the purchase, work out what is wrong, pick a different ' +
	'demo account that works, and complete the purchase there instead.';

/** The Tier-1 SauceDemo discovery eval entry (a STATIC real-site entry). */
export const saucedemoDiscoveryEval: EvalEntry = {
	id: 'saucedemo-discovery',
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
					'logged in to some account: the inventory list (.inventory_list) rendered',
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
				'the page is the checkout-complete page (URL contains checkout-complete)',
			check: async (verbs) => (await verbs.url()).includes('checkout-complete'),
		},
	],
};

export default saucedemoDiscoveryEval;
