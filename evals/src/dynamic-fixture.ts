import {createServer, type Server} from 'node:http';
import {mintNonce} from './nonce.js';

/**
 * The DYNAMIC, non-one-shot-scriptable LOCAL fixture (task
 * `eval-dynamic-non-scriptable-mid-run-goal-shift`; idea
 * `work/notes/ideas/dynamic-evals-that-cannot-be-one-shot-scripted.md`).
 *
 * WHY a local fixture and not a live sandbox: the spike needs a target that is
 * HOST-DETERMINISTIC (the harness can re-derive the correct end state exactly,
 * for a deterministic self-test) yet AGENT-UNPREDICTABLE (a blind script cannot
 * precompute the flow). A live store gives realism but its values are not under
 * our control, so we cannot make the per-run variation a clean nonce-seeded
 * function the self-test can check, and it can flake the run. A small randomised
 * local fixture, seeded by the per-run {@link mintNonce} nonce, gives BOTH: every
 * value is a pure function of the nonce (deterministic to us) but only revealed
 * on the page at run time (opaque to the agent). (Decision recorded in the task
 * report + `evals/SCOREBOARD.md`.)
 *
 * THE NON-SCRIPTABLE LEVERS (combined so a single BLIND script provably cannot
 * encode the flow, AND a single READ-ALL-UPFRONT script still gets the wrong
 * answer):
 *
 *  1. MID-RUN TERMINATION ON A LIVE ON-PAGE VALUE (the strongest lever). The
 *     goal is "add items to the cart until the shown subtotal exceeds the shown
 *     free-shipping threshold, then check out". The threshold is randomised per
 *     run and only printed on the page, so no fixed script encodes the stop
 *     point; the agent must read the live subtotal and decide whether to loop.
 *  2. RUNTIME-REVEALED VARYING TARGET. The catalogue's prices AND their order are
 *     nonce-seeded, so which items (and how many) clear the threshold varies per
 *     run and is only visible at run time.
 *  3. SUBTOTAL NOT PRECOMPUTABLE FROM THE CARDS. Adding an item applies a
 *     per-item, nonce-seeded "handling fee" that is shown ONLY in the cart line,
 *     never on the product card. So even a capable agent that reads EVERY card
 *     price up front cannot compute the running subtotal: it must add, READ the
 *     live cart subtotal, then decide. This is what forces a genuine
 *     read-act-read LOOP rather than a single read-all-then-add-the-right-set
 *     script, the crux of "a single Playwright script, even one that branches on
 *     a first read, cannot one-shot it".
 *
 * Every per-run value derives from the nonce via the pure helpers below, so
 * {@link computeExpectedPlan} can re-derive the minimal correct cart the harness
 * (and the deterministic self-test) checks against, WITHOUT re-running the agent.
 */

/** One catalogue item: a stable id, a display name, and its nonce-seeded prices. */
export interface FixtureItem {
	/** A stable per-item id used in DOM ids (`add-<id>`), e.g. `item-0`. */
	readonly id: string;
	/** The human-readable product name shown on the card. */
	readonly name: string;
	/** The base price shown on the product CARD (dollars, 2dp as a number). */
	readonly cardPrice: number;
	/**
	 * The per-item HANDLING FEE added in the cart line only (dollars). NOT shown
	 * on the card, so the running subtotal is not precomputable from the cards.
	 */
	readonly handlingFee: number;
}

/** The fully-resolved per-run fixture model (everything derives from the nonce). */
export interface DynamicFixtureModel {
	/** The per-run nonce that seeds every value (so a cached script is useless). */
	readonly nonce: string;
	/** The free-shipping threshold the cart subtotal must EXCEED (dollars). */
	readonly threshold: number;
	/** The catalogue, in the nonce-seeded display order. */
	readonly items: readonly FixtureItem[];
}

/** A seeded, deterministic PRNG (mulberry32) so a nonce reproduces the page. */
function seededRng(seedText: string): () => number {
	// Fold the nonce text into a 32-bit seed.
	let h = 1779033703 ^ seedText.length;
	for (let i = 0; i < seedText.length; i++) {
		h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	let a = h >>> 0;
	return function next(): number {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Round to cents (2dp) as a number, avoiding float drift in the page math. */
function toCents(dollars: number): number {
	return Math.round(dollars * 100) / 100;
}

/** A small fixed pool of product names (the NAMES are stable; prices vary). */
const PRODUCT_NAMES: readonly string[] = [
	'Cobalt Mug',
	'Linen Notebook',
	'Maple Coaster',
	'Slate Bottle',
	'Amber Lamp',
	'Cedar Pencil Set',
	'Ivory Tote',
	'Onyx Keyring',
];

/** How many items the catalogue shows (enough that the right subset varies). */
const ITEM_COUNT = 6;

/**
 * Resolve the full per-run fixture model from a nonce: a nonce-seeded threshold
 * and a nonce-seeded, nonce-ORDERED catalogue (base card price + a hidden
 * handling fee per item). Pure: the SAME nonce always yields the SAME model, so
 * the harness can re-derive the expected end state for the self-test.
 */
export function resolveFixtureModel(
	nonce: string = mintNonce(),
): DynamicFixtureModel {
	const rng = seededRng(nonce);
	// A threshold in a range that needs SEVERAL items to clear (so the loop is
	// real), but is always clearable with the catalogue below.
	const threshold = toCents(40 + rng() * 30); // $40.00 .. $70.00

	const items: FixtureItem[] = [];
	for (let i = 0; i < ITEM_COUNT; i++) {
		const cardPrice = toCents(8 + rng() * 22); // $8.00 .. $30.00
		const handlingFee = toCents(0.5 + rng() * 4.5); // $0.50 .. $5.00 (cart-only)
		items.push({
			id: `item-${i}`,
			name: PRODUCT_NAMES[i % PRODUCT_NAMES.length],
			cardPrice,
			handlingFee,
		});
	}

	// Nonce-seeded display order (Fisher-Yates with the same RNG), so WHICH items
	// appear cheapest-first, and therefore which subset clears the threshold,
	// varies per run.
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}

	return {nonce, threshold, items};
}

/** The cart-LINE price of an item (what the cart actually charges per add). */
export function lineTotal(item: FixtureItem): number {
	return toCents(item.cardPrice + item.handlingFee);
}

/** The minimal correct cart the harness re-derives (host-deterministic). */
export interface ExpectedPlan {
	/** The item ids, in add order, of a minimal clearing cart. */
	readonly addedItemIds: readonly string[];
	/** The subtotal that minimal cart reaches (always > the threshold). */
	readonly subtotal: number;
	/** The threshold that cart must exceed (echoed for convenience). */
	readonly threshold: number;
}

/**
 * Re-derive ONE valid minimal plan that clears the threshold: add items in
 * CHEAPEST-CART-LINE-FIRST order until the live subtotal EXCEEDS the threshold.
 * This is the harness's deterministic reference for the self-test (a primed
 * trace can replay exactly this), NOT the only valid solution: the end-state
 * assertion accepts ANY cart whose shown subtotal exceeds the threshold, so a
 * real agent need not match this plan. Pure function of the model/nonce.
 */
export function computeExpectedPlan(model: DynamicFixtureModel): ExpectedPlan {
	const byLine = [...model.items].sort((a, b) => lineTotal(a) - lineTotal(b));
	const addedItemIds: string[] = [];
	let subtotal = 0;
	for (const item of byLine) {
		subtotal = toCents(subtotal + lineTotal(item));
		addedItemIds.push(item.id);
		if (subtotal > model.threshold) break;
	}
	return {addedItemIds, subtotal, threshold: model.threshold};
}

/** Render the per-run fixture HTML for a resolved model. */
export function renderFixtureHtml(model: DynamicFixtureModel): string {
	const cards = model.items
		.map(
			(item) => `
			<li class="product-card" data-item="${item.id}">
				<span class="product-name">${item.name}</span>
				<span class="product-price">$${item.cardPrice.toFixed(2)}</span>
				<button id="add-${item.id}" class="add-to-cart" type="button"
					data-line="${lineTotal(item).toFixed(2)}">Add to cart</button>
			</li>`,
		)
		.join('');

	// The line totals are embedded as data attributes the PAGE script reads to
	// keep the live subtotal; they are NOT printed as text on the card (the card
	// shows only the base price), so the agent cannot read the running subtotal
	// off the catalogue. The threshold IS printed (the agent must read it).
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Dynamic cart fixture (nonce ${model.nonce})</title>
	</head>
	<body>
		<h1 id="heading">Threshold Checkout Fixture</h1>
		<div id="app-ready" data-ready="true">store loaded</div>

		<p>
			Free shipping once your cart subtotal is OVER
			<span id="free-shipping-threshold" data-threshold="${model.threshold.toFixed(
				2,
			)}">$${model.threshold.toFixed(2)}</span>.
		</p>

		<ul id="catalogue">${cards}
		</ul>

		<section id="cart">
			<h2>Cart</h2>
			<ul id="cart-items"></ul>
			<p>
				Subtotal:
				<span id="cart-subtotal" data-subtotal="0.00">$0.00</span>
			</p>
			<button id="checkout" type="button">Check out</button>
		</section>

		<!-- Revealed in-page on checkout (no navigation), so the end state and
		     the final subtotal both persist on the final DOM for the harness. -->
		<div id="order-complete" hidden>
			<div id="order-confirmed" data-final-subtotal="0.00">
				Order complete. Final subtotal:
				<span id="final-subtotal">$0.00</span>
			</div>
		</div>

		<script>
			(function () {
				var subtotal = 0;
				var threshold = ${model.threshold};
				function fmt(n) {
					return '$' + (Math.round(n * 100) / 100).toFixed(2);
				}
				function refresh() {
					var el = document.getElementById('cart-subtotal');
					el.textContent = fmt(subtotal);
					el.setAttribute('data-subtotal', (Math.round(subtotal * 100) / 100).toFixed(2));
				}
				var buttons = document.querySelectorAll('.add-to-cart');
				for (var i = 0; i < buttons.length; i++) {
					buttons[i].addEventListener('click', function (ev) {
						var btn = ev.currentTarget;
						var line = parseFloat(btn.getAttribute('data-line'));
						subtotal = Math.round((subtotal + line) * 100) / 100;
						var li = document.createElement('li');
						li.className = 'cart-line';
						li.setAttribute('data-line', line.toFixed(2));
						li.textContent = btn.parentNode.querySelector('.product-name').textContent + ' ' + fmt(line);
						document.getElementById('cart-items').appendChild(li);
						refresh();
					});
				}
				document.getElementById('checkout').addEventListener('click', function () {
					// Checkout only confirms once the cart has at least one item (an
					// empty cart cannot clear the threshold); the harness asserts the
					// shown final subtotal EXCEEDS the threshold, so an under-threshold
					// checkout is a genuine FAIL, not a crash.
					if (document.querySelectorAll('.cart-line').length === 0) return;
					var confirmed = document.getElementById('order-confirmed');
					confirmed.setAttribute('data-final-subtotal', (Math.round(subtotal * 100) / 100).toFixed(2));
					document.getElementById('final-subtotal').textContent = fmt(subtotal);
					document.getElementById('order-complete').hidden = false;
					void threshold;
				});
			})();
		</script>
	</body>
</html>
`;
}

/** A running dynamic-fixture server bound to one per-run model. */
export interface DynamicFixtureServer {
	/** The base URL, e.g. `http://127.0.0.1:52831`. */
	readonly url: string;
	/** The per-run model the served page renders (its nonce, threshold, items). */
	readonly model: DynamicFixtureModel;
	/** Stop the server and release the port. */
	close(): Promise<void>;
}

/**
 * Start a local HTTP server that serves ONE per-run dynamic fixture page (the
 * resolved `model`). Mirrors {@link ../test/fixture-server.js}'s style but lives
 * in `src/` so BOTH the deterministic self-test AND the live `run-eval` runner
 * can serve the same page. Binds `127.0.0.1` on an OS-assigned port; every path
 * serves the one fixture page (so a trailing-slash entry URL just works).
 */
export async function startDynamicFixtureServer(
	model: DynamicFixtureModel = resolveFixtureModel(),
): Promise<DynamicFixtureServer> {
	const html = renderFixtureHtml(model);
	const server: Server = createServer((_req, res) => {
		res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
		res.end(html);
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

	const address = server.address();
	if (address === null || typeof address === 'string') {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		throw new Error('dynamic fixture server failed to bind to a TCP port');
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		model,
		close() {
			return new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		},
	};
}
