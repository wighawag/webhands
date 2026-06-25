/**
 * The controlled static fixture pages served by {@link startFixtureServer}.
 *
 * Kept as in-module strings (rather than separate `.html` assets) so they
 * survive `tsc` compilation into `dist` without a copy step, and so the
 * deterministic verb tests have a single source of truth for the markup they
 * assert against. Later verb-behaviour tasks extend these pages with whatever
 * controlled elements they need; the seam scaffold ships a minimal index page.
 */

const INDEX = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>webhands fixture</title>
	</head>
	<body>
		<h1 id="heading">Fixture Page</h1>
		<p id="status">ready</p>
		<input id="query" type="text" aria-label="Query" />
		<button id="search" type="button">Search</button>
	</body>
</html>
`;

/**
 * A page whose content is rendered LATE, client-side: the "Loaded" heading and a
 * marker element are injected by script ~150ms after the `load` event fires, the
 * way an XHR-rendered price or a hydrated result list appears AFTER the document
 * itself has settled. So the `load`-settled `goto` returns BEFORE this content
 * exists, and only `wait({kind: 'locator'})` (PRD story 10) makes a reader block
 * until it does. The delay is deterministic (driven by `setTimeout` against the
 * fixture's own clock, not a network round-trip), so the wait-for-selector test
 * is not flaky.
 */
const DELAYED_CONTENT = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>delayed content fixture</title>
	</head>
	<body>
		<h1 id="heading">Loading…</h1>
		<div id="results"></div>
		<script>
			window.setTimeout(function () {
				document.getElementById('heading').textContent = 'Loaded';
				var el = document.createElement('p');
				el.id = 'late';
				el.setAttribute('aria-label', 'Late Content');
				el.textContent = 'late content rendered';
				document.getElementById('results').appendChild(el);
			}, 150);
		</script>
	</body>
</html>
`;

/**
 * A page exercising the `click` and `type` verbs (PRD story 8).
 *
 * - `#search` is a VISIBLE button; clicking it runs its handler, which writes
 *   `clicked` into `#status`. A normal `click()` (actionability-checked)
 *   handles this path.
 * - `#query` is a VISIBLE text input the `type` verb fills.
 * - `#hidden-toggle` is a HIDDEN custom control (`display:none`), the case the
 *   prd calls out: a normal `click()` AUTO-WAITS for the element to become
 *   visible/actionable and TIMES OUT, because it never does. The verb's escape
 *   path DISPATCHES a click event (no actionability check); the handler then
 *   sets `#hidden-state` to `toggled`, so the test can assert the dispatch path
 *   actually fired the element's behaviour (not merely that it did not throw).
 */
const CLICK_TYPE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>click + type fixture</title>
	</head>
	<body>
		<h1 id="heading">Click + Type Fixture</h1>
		<p id="status">idle</p>
		<input id="query" type="text" aria-label="Query" />
		<button id="search" type="button">Search</button>

		<!-- A hidden custom control: a normal click times out (never actionable);
		     only a dispatched click fires its handler. -->
		<div id="hidden-toggle" role="button" aria-label="Hidden Toggle" style="display: none"></div>
		<p id="hidden-state">untoggled</p>

		<script>
			document.getElementById('search').addEventListener('click', function () {
				document.getElementById('status').textContent = 'clicked';
			});
			document
				.getElementById('hidden-toggle')
				.addEventListener('click', function () {
					document.getElementById('hidden-state').textContent = 'toggled';
				});
		</script>
	</body>
</html>
`;

/**
 * A page that NAVIGATES itself to `index.html` ~150ms after load, the way a
 * landing/redirect page bounces to the real destination. `goto` here settles on
 * THIS page's `load`; only `wait({kind: 'navigation'})` (PRD story 10) blocks
 * until the subsequent navigation has settled, after which a reader is on
 * `index.html`. Deterministic (a `setTimeout`-driven `location.assign`), so the
 * wait-for-navigation test is not flaky.
 */
const REDIRECTING = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>redirecting fixture</title>
	</head>
	<body>
		<h1 id="heading">Redirecting…</h1>
		<script>
			window.setTimeout(function () {
				window.location.assign('/index.html');
			}, 150);
		</script>
	</body>
</html>
`;

/**
 * A page carrying controlled, deterministic state for the `eval` verb (PRD
 * story 9) to read back. The escape-hatch tests evaluate expressions against
 * THIS fixture's own state and assert the serialized result, never against
 * third-party DOM (PRD "Testing Decisions"):
 *
 * - `#marker` holds a known text the verb can read.
 * - `window.__fixture` is a known object graph (a number, a string, a nested
 *   array) so an object result can be asserted by value.
 * - `window.__fixtureAsync()` resolves to a known value after a tick, so the
 *   Promise-awaiting behaviour of `eval` is exercised on the fixture's own
 *   clock (deterministic, not a network round-trip).
 * - `window.__fixtureCircular` is a circular structure, the controlled case for
 *   asserting that the transport's structured clone PRESERVES circular refs (a
 *   `[Circular]` marker) rather than throwing, unlike a JSON-based encoding.
 */
const EVAL = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>eval fixture</title>
	</head>
	<body>
		<h1 id="heading">Eval Fixture</h1>
		<p id="marker">marker-value</p>
		<script>
			window.__fixture = {
				count: 42,
				label: 'fixture-label',
				nested: [1, 2, 3],
			};
			window.__fixtureAsync = function () {
				return new Promise(function (resolve) {
					window.setTimeout(function () {
						resolve('async-resolved');
					}, 10);
				});
			};
			var circular = {};
			circular.self = circular;
			window.__fixtureCircular = circular;
		</script>
	</body>
</html>
`;

/**
 * A page that SETS its own cookies client-side on load (PRD story 11), so the
 * `cookies export`/`cookies import` round-trip exports cookies the PAGE
 * created (not only ones seeded through the seam) and re-imports them into a
 * fresh context. Two cookies make the round-trip meaningful: a session-like
 * value and a second name, so the test asserts the whole set crosses, not just
 * one. `document.cookie` writes are visible to the browser context's cookie
 * store, which is exactly what the seam's `cookies()` reads.
 */
const COOKIES = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>cookies fixture</title>
	</head>
	<body>
		<h1 id="heading">Cookies Fixture</h1>
		<p id="status">setting cookies</p>
		<script>
			document.cookie = 'mbc_session=session-value-123; path=/';
			document.cookie = 'mbc_pref=dark-mode; path=/';
			document.getElementById('status').textContent = 'cookies set';
		</script>
	</body>
</html>
`;

/** Map of request path (relative to root, no leading slash) to page markup. */
export const FIXTURE_PAGES: Readonly<Record<string, string>> = {
	'index.html': INDEX,
	'click-type.html': CLICK_TYPE,
	'delayed.html': DELAYED_CONTENT,
	'redirecting.html': REDIRECTING,
	'eval.html': EVAL,
	'cookies.html': COOKIES,
};
