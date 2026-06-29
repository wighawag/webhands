import type {EvalEntry} from '../eval-contract.js';
import type {VerbClient} from '../verb-client.js';

/**
 * TIER-3 Magento-demo MESSY-REAL eval (prd `agent-capability-eval-harness`,
 * user story 8; task `eval-magento-tier3`). The scoreboard's regression catcher.
 *
 * The Magento demo store (`magento.softwaretestingboard.com`, the standard
 * Luma-themed Adobe Commerce demo) is a REAL, heavy, framework-rendered
 * e-commerce DOM. Its job in the scoreboard is precisely to catch the "works on
 * a clean local fixture, FAILS on a real messy production-like DOM" regression
 * that the deterministic local-fixture verb tests structurally CANNOT reveal
 * (prd ## Problem Statement, "Messy-real DOM regressions"). Where Tier-1
 * SauceDemo is a deliberately clean, stable store, Tier-3 Magento exercises the
 * SAME agent-facing verb surface against a real, reconciling, knockout-style DOM.
 *
 * NO-ACCOUNT BY DESIGN (task acceptance: avoid account state where possible).
 * The goal is search -> product -> cart -> checkout, all of which Magento's Luma
 * store allows as a GUEST: no registration, no login, no per-run identity. So
 * the prd D2 account-hygiene contract (fresh nonce-tagged identity,
 * assert-then-best-effort-delete) does NOT apply here and this entry declares no
 * cleanup. The end state is REACHING the checkout with the chosen item in the
 * cart, NOT placing an order: the demo fulfils no orders, and reaching checkout
 * is the clean, side-effect-free end state the milestone list names.
 *
 * NO-PRIMING (prd property 3), which matters MOST on a messy DOM: the goal names
 * ONLY the entry URL and a plain-language product kind to find ("a jacket"). It
 * carries NO selectors, NO step list, and NO URL beyond {@link ENTRY_URL}; the
 * HARNESS-side Luma locators below are never handed to the agent. The agent must
 * discover Magento's search box, results grid, product page, add-to-cart, and
 * checkout entirely on its own. That is the whole point of a Tier-3 messy-DOM
 * eval: a verb that regresses on a real DOM shows up as a milestone the unaided
 * agent could not reach.
 *
 * STABILITY / RATE-LIMIT FITNESS (task acceptance; prd user story 10). The
 * Magento demo is FLAKIER than the sandbox tiers: it sits behind Cloudflare and
 * has been observed returning a Cloudflare 526 (origin SSL invalid) outage
 * across all paths (see `work/notes/findings/magento-demo-tier3-stability.md`).
 * The foundation's precheck + INCONCLUSIVE handling is therefore load-bearing
 * HERE: the health probes below assert the entry page actually rendered the Luma
 * search box, so a down / rate-limited / Cloudflare-blocked Magento yields
 * INCONCLUSIVE (retried, never a capability FAIL). A capability FAIL is reserved
 * for a HEALTHY Magento the agent still could not drive.
 *
 * END STATE asserted BY THE HARNESS (prd property 2) via webhands read verbs,
 * never the agent's self-report:
 *  - precheck landmark: the Luma search box (`#search`) rendered on the entry
 *    page (a down/Cloudflare-blocked site has no such box -> INCONCLUSIVE);
 *  - milestone `reached-search-results`: a search-results page was reached (URL
 *    contains `catalogsearch/result`);
 *  - milestone `reached-product`: a product detail page was reached (the
 *    Luma product-info container + the add-to-cart button are present);
 *  - milestone `reached-cart`: the cart holds at least one line item (the cart
 *    page's item rows, read durably on the cart page);
 *  - milestone `reached-checkout` / end state: the checkout page was reached (URL
 *    under `/checkout/` with the Luma one-page-checkout wrapper rendered).
 */

/** The fixed public Magento-demo entry point (named to the agent; nothing beyond). */
const ENTRY_URL = 'https://magento.softwaretestingboard.com/';

/** Magento's cart page (a DURABLE harness read surface for the cart milestone). */
const CART_URL = 'https://magento.softwaretestingboard.com/checkout/cart/';

/**
 * The high-level natural-language goal handed to the UNAIDED agent. It names the
 * entry URL and a plain product KIND to find ("a jacket"), but NO selectors, NO
 * steps, and NO URL beyond {@link ENTRY_URL}. The no-priming guard
 * ({@link ../no-priming.js#assertNoPriming}) enforces this before any launch.
 *
 * "a jacket" is a deliberately generic catalogue term (the Luma store stocks
 * many jackets), so the goal stays mechanically verifiable, "find SOME product
 * of this kind and buy it", without leaking which product or any DOM detail.
 */
const GOAL_PROMPT =
	'Go to the online store at https://magento.softwaretestingboard.com/ and ' +
	'shop as a guest (do NOT create an account or log in). Search the store for ' +
	'a jacket, open one of the jackets from the results, add it to your shopping ' +
	'cart, and then proceed all the way to the checkout page (where it asks for ' +
	'shipping/delivery details). You do NOT need to place the order or pay; just ' +
	'reach the checkout with the jacket in your cart. If the product asks you to ' +
	'choose a size or colour before it can be added, pick any available option.';

/** The Tier-3 Magento-demo checkout eval entry (a STATIC real-site entry). */
export const magentoCheckoutEval: EvalEntry = {
	id: 'magento-checkout',
	tier: 'tier-3',
	target: 'Magento demo (Luma)',
	entryUrl: ENTRY_URL,
	goalPrompt: GOAL_PROMPT,
	health: [
		{
			describe: 'the Luma search box (#search) rendered on the entry page',
			check: (verbs) => verbs.exists(`page.locator('#search')`),
		},
	],
	milestones: [
		{
			id: 'reached-search-results',
			check: {
				describe:
					'a search-results page was reached (URL contains catalogsearch/result)',
				check: async (verbs) =>
					(await verbs.url()).includes('catalogsearch/result'),
			},
		},
		{
			id: 'reached-product',
			check: {
				describe:
					'a product detail page was reached (the add-to-cart button is present)',
				check: (verbs) =>
					verbs.exists(`page.locator('#product-addtocart-button')`),
			},
		},
		{
			id: 'reached-cart',
			check: {
				describe:
					'the cart holds at least one line item (read on the cart page)',
				check: (verbs) => cartHasItem(verbs),
			},
		},
		{
			id: 'reached-checkout',
			check: {
				describe:
					'the checkout page was reached (URL under /checkout/ with the one-page-checkout wrapper)',
				check: (verbs) => onCheckoutPage(verbs),
			},
		},
	],
	endState: [
		{
			describe:
				'the checkout page was reached (URL under /checkout/ with the Luma one-page-checkout wrapper rendered)',
			check: (verbs) => onCheckoutPage(verbs),
		},
	],
};

/**
 * Does the cart hold at least one line item? Read DURABLY: navigate the harness
 * to Magento's cart page and count the Luma cart line-item rows (`.cart.item`),
 * so the signal does not depend on whatever transient page the agent left. An
 * empty cart renders no such rows.
 */
async function cartHasItem(verbs: VerbClient): Promise<boolean> {
	await verbs.goto(CART_URL);
	const rows = await verbs.count(`page.locator('tr.cart.item, .cart.item')`);
	return rows >= 1;
}

/**
 * Is the page the agent left the Magento checkout? Read on the CURRENT page (no
 * navigation), so it reflects where the agent actually finished. Luma's one-page
 * checkout lives under `/checkout/` and renders the `#checkout` wrapper; require
 * BOTH so a bare `/checkout/cart/` (the cart, also under `/checkout/`) is not
 * mistaken for the checkout step.
 */
async function onCheckoutPage(verbs: VerbClient): Promise<boolean> {
	const url = await verbs.url();
	const atCheckout =
		/\/checkout\/?(#|$|\?)/.test(url) || url.endsWith('/checkout');
	if (!atCheckout) return false;
	return verbs.exists(`page.locator('#checkout, .opc-wrapper')`);
}

export default magentoCheckoutEval;
