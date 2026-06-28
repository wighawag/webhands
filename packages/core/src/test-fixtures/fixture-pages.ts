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

/**
 * A structured-LIST page for the Tier-1 `query` extraction verb plus the state
 * verbs `exists`/`count`/`isVisible`/`getAttribute` (prd
 * `broaden-agent-verb-surface`, R2). Controlled, deterministic markup the seam
 * tests assert one ROW PER MATCH against, never third-party DOM:
 *
 * - `.result` is a LIST of three rows (a mini shopping result set), each with a
 *   distinct `data-asin` attribute, a `.title` text, a `.price` text, and an
 *   anchor with an `href` — so a multi-match `query` returns three rows and
 *   `--limit` can bound them. The title/price live in CHILD elements so a row's
 *   `innerText` property carries the whole composed text (proving `props` reads
 *   live runtime state, not markup).
 * - `#optin` is a checkbox whose `checked` ATTRIBUTE is absent in the markup but
 *   whose live `checked` PROPERTY is set `true` by script after load — the
 *   controlled attrs-vs-props DIVERGENCE: `attrs:['checked']` reads `null`
 *   (no markup attribute) while `props:['checked']` reads `true` (live state).
 *   It also carries `value="on"` (a present markup attribute) and a runtime
 *   `type` property, so an attribute and a property that genuinely differ are
 *   both observable on one element.
 * - `#hidden-row` is a present-but-HIDDEN element (`display:none`) carrying a
 *   `data-sitekey`, so `pw:['visible']` reads `false` for it (actionability-
 *   grade visibility) while a `getAttribute('data-sitekey')` still reads its
 *   value, and a VISIBLE `#shown-row` reads `pw:['visible'] === true`.
 * - There is deliberately NO `.absent` element, so a `query`/`count`/`exists`
 *   against `.absent` exercises the empty match-set (`[]` / `0` / `false`).
 */
const QUERY_LIST = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>query list fixture</title>
	</head>
	<body>
		<h1 id="heading">Query List Fixture</h1>

		<ul id="results">
			<li class="result" data-asin="A001">
				<a class="link" href="/item/A001"
					><span class="title">Alpha Widget</span></a
				>
				<span class="price">$10.00</span>
			</li>
			<li class="result" data-asin="B002">
				<a class="link" href="/item/B002"
					><span class="title">Bravo Widget</span></a
				>
				<span class="price">$20.00</span>
			</li>
			<li class="result" data-asin="C003">
				<a class="link" href="/item/C003"
					><span class="title">Charlie Widget</span></a
				>
				<span class="price">$30.00</span>
			</li>
		</ul>

		<!-- attrs-vs-props divergence: no \`checked\` attribute in markup, but the
		     live \`checked\` property is set true after load. -->
		<input id="optin" type="checkbox" value="on" />

		<!-- a present-but-hidden element carrying a readable attribute -->
		<div
			id="hidden-row"
			class="sitekey"
			data-sitekey="sk-hidden-123"
			style="display: none"
		></div>
		<div id="shown-row" class="sitekey" data-sitekey="sk-shown-456">visible</div>

		<script>
			// Toggle the live property WITHOUT touching the markup attribute, so
			// attrs:['checked'] (null) and props:['checked'] (true) genuinely differ.
			document.getElementById('optin').checked = true;
		</script>
	</body>
</html>
`;

/**
 * A page exercising the Tier-2 `press` verb (prd `broaden-agent-verb-surface`,
 * story 8). It RECORDS keyboard events deterministically so a test asserts the
 * verb fired the right key, not merely that it did not throw:
 *
 * - `#focus-input` is a text input. A `keydown` listener appends each event's
 *   `key` (and a `+` for each held modifier) to `#keylog`, so a single key, a
 *   named key (Enter/ArrowLeft), and a chord (`Control+a`) are all observable.
 * - `#counter` is driven by ArrowUp/ArrowDown on a SECOND input (`#game`),
 *   modelling a game's keyboard control: ArrowUp increments, ArrowDown
 *   decrements, so `press('ArrowUp')` at that locator moves the counter.
 * - The page focuses `#focus-input` on load, so a `press(key)` with NO locator
 *   (the focused-element form) lands there — the test asserts the focused-element
 *   path AND the at-a-locator path against the SAME recorder.
 */
const KEYBOARD = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>keyboard fixture</title>
	</head>
	<body>
		<h1 id="heading">Keyboard Fixture</h1>
		<input id="focus-input" type="text" aria-label="Focus Input" />
		<pre id="keylog"></pre>

		<input id="game" type="text" aria-label="Game" />
		<p id="counter">0</p>

		<script>
			function describe(e) {
				var mods = '';
				if (e.ctrlKey) mods += 'Control+';
				if (e.altKey) mods += 'Alt+';
				if (e.shiftKey) mods += 'Shift+';
				if (e.metaKey) mods += 'Meta+';
				return mods + e.key;
			}
			var MODIFIER_KEYS = {Control: 1, Alt: 1, Shift: 1, Meta: 1};
			var log = document.getElementById('keylog');
			document
				.getElementById('focus-input')
				.addEventListener('keydown', function (e) {
					// A chord (Control+a) fires a bare-modifier keydown (key === 'Control')
					// before the real key; ignore those so the log records one entry per
					// logical press.
					if (MODIFIER_KEYS[e.key]) return;
					log.textContent += (log.textContent ? ',' : '') + describe(e);
				});

			var counter = document.getElementById('counter');
			document.getElementById('game').addEventListener('keydown', function (e) {
				if (e.key === 'ArrowUp')
					counter.textContent = String(Number(counter.textContent) + 1);
				if (e.key === 'ArrowDown')
					counter.textContent = String(Number(counter.textContent) - 1);
			});

			// Focus the recorder input so a press() with NO locator lands here.
			document.getElementById('focus-input').focus();
		</script>
	</body>
</html>
`;

/**
 * A page exercising the Tier-2 `hover` verb (prd `broaden-agent-verb-surface`,
 * story 9). `#menu` reveals a `#menu-item` ONLY while `#menu` is hovered (CSS
 * `:hover`), AND a `mouseenter` listener flips `#hover-state` to `entered`, so
 * the test asserts the hover affordance fired (the item became visible / the
 * state changed), not merely that `hover` did not throw — something `click`
 * could not surface.
 */
const HOVER = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>hover fixture</title>
		<style>
			#menu-item {
				display: none;
			}
			#menu:hover #menu-item {
				display: block;
			}
		</style>
	</head>
	<body>
		<h1 id="heading">Hover Fixture</h1>
		<div id="menu">
			Menu
			<div id="menu-item">Reveal-on-hover item</div>
		</div>
		<p id="hover-state">idle</p>
		<script>
			document.getElementById('menu').addEventListener('mouseenter', function () {
				document.getElementById('hover-state').textContent = 'entered';
			});
		</script>
	</body>
</html>
`;

/**
 * A page exercising the Tier-2 `select` verb (prd `broaden-agent-verb-surface`,
 * story 10). `#color` is a native `<select>` with three options whose VALUE and
 * LABEL deliberately DIFFER (value `r` / label `Red`, etc.), so a select-by-value
 * and a select-by-label are distinguishable. A `change` listener mirrors the
 * chosen value into `#chosen`, and the test also reads the live `value`
 * property, so the choice is asserted as reflected in the element's STATE.
 */
const SELECT = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>select fixture</title>
	</head>
	<body>
		<h1 id="heading">Select Fixture</h1>
		<select id="color" aria-label="Color">
			<option value="r">Red</option>
			<option value="g">Green</option>
			<option value="b">Blue</option>
		</select>
		<p id="chosen">r</p>
		<script>
			var sel = document.getElementById('color');
			sel.addEventListener('change', function () {
				document.getElementById('chosen').textContent = sel.value;
			});
		</script>
	</body>
</html>
`;

/**
 * A page exercising the Tier-2 `scroll` verb (prd `broaden-agent-verb-surface`,
 * story 11). The body is much taller than the viewport, with `#far-target` near
 * the BOTTOM (off-viewport at load), so:
 *
 * - `scroll --to (#far-target)` brings it into view (its `pw:['visible']` /
 *   `scrollY` change is observable).
 * - `scroll --by 0,400` scrolls the page DOWN by 400px, so `window.scrollY`
 *   moves by the given amount.
 *
 * A tall `#spacer` provides the scroll distance; `#far-target` sits after it.
 */
const SCROLL = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>scroll fixture</title>
	</head>
	<body>
		<h1 id="heading">Scroll Fixture</h1>
		<div id="spacer" style="height: 4000px">spacer</div>
		<div id="far-target">Far target at the bottom</div>
	</body>
</html>
`;

/**
 * A page exercising the Tier-2 `drag` verb (prd `broaden-agent-verb-surface`,
 * story 12). `#drag-source` is a draggable element and `#drop-target` is a drop
 * zone wired with the HTML5 drag-and-drop events: on `drop`, the handler moves
 * the source INTO the target and flips `#drop-state` to `dropped`, so the test
 * asserts the drop handler RAN (the DOM order / state changed), not merely that
 * `drag` did not throw.
 */
const DRAG = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>drag fixture</title>
		<style>
			#drag-source,
			#drop-target {
				width: 120px;
				height: 120px;
				margin: 10px;
			}
			#drag-source {
				background: #cde;
			}
			#drop-target {
				background: #edc;
			}
		</style>
	</head>
	<body>
		<h1 id="heading">Drag Fixture</h1>
		<div id="drag-source" draggable="true">Drag me</div>
		<div id="drop-target">Drop here</div>
		<p id="drop-state">idle</p>
		<script>
			var source = document.getElementById('drag-source');
			var target = document.getElementById('drop-target');
			source.addEventListener('dragstart', function (e) {
				e.dataTransfer.setData('text/plain', 'drag-source');
			});
			target.addEventListener('dragover', function (e) {
				e.preventDefault();
			});
			target.addEventListener('drop', function (e) {
				e.preventDefault();
				target.appendChild(source);
				document.getElementById('drop-state').textContent = 'dropped';
			});
		</script>
	</body>
</html>
`;

/**
 * The SAME-ORIGIN child frame embedded by {@link FRAME_PARENT} (Tier-3
 * frame-scoped `eval`, prd `broaden-agent-verb-surface`, story 13). It carries
 * controlled, deterministic state the parent's top document CANNOT see, so a
 * frame-scoped `eval` is proved to actually land IN the child:
 *
 * - `#child-marker` holds a text only present in the child document, so
 *   `eval --frame` reading it proves the expression ran in the child (the top
 *   document's `document.getElementById('child-marker')` is `null`).
 * - `window.__childValue` is a runtime-only JS value the top frame's page world
 *   cannot reach, the "read a runtime-only value" case.
 * - `window.fireCallback()` flips `#callback-state` to `fired` and sets
 *   `window.__callbackFired`, modelling a captcha `data-callback`: a frame-scoped
 *   `eval` firing it has an OBSERVABLE effect inside the child (the
 *   backward-compatible top-frame `eval` cannot reach it).
 */
const FRAME_CHILD = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>frame child fixture</title>
	</head>
	<body>
		<h1 id="child-heading">Frame Child</h1>
		<p id="child-marker">child-only-value</p>
		<p id="callback-state">idle</p>
		<script>
			window.__childValue = 'runtime-only-child-value';
			window.__callbackFired = false;
			window.fireCallback = function () {
				window.__callbackFired = true;
				document.getElementById('callback-state').textContent = 'fired';
				return 'callback-result';
			};
		</script>
	</body>
</html>
`;

/**
 * The PARENT page for the Tier-3 frame-scoped `eval` (prd
 * `broaden-agent-verb-surface`, story 13). It embeds {@link FRAME_CHILD} as a
 * SAME-ORIGIN child frame (`#main-iframe`, relative `src`), mimicking the
 * Imperva `#main-iframe` structure the idea names. The top document carries a
 * DIFFERENT `#child-marker`-less state so a test can tell the top frame from the
 * child frame:
 *
 * - `#top-marker` holds a top-document-only text; there is deliberately no
 *   `#child-marker` in the top document, so `eval` with no frame reading
 *   `document.getElementById('child-marker')` is `null` (backward-compatible
 *   top-frame default) while `eval --frame '#main-iframe'` reading it is the
 *   child value.
 * - `#cross-iframe` is an iframe whose `src` is set by the TEST to a SECOND
 *   fixture server (a different port == a different origin), so a frame-scoped
 *   `eval` against it must fail LOUD with the cross-origin typed error. It is
 *   left blank here and pointed cross-origin by the test (the fixture server
 *   serves one origin, so the cross-origin half is wired in the test).
 */
const FRAME_PARENT = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>frame parent fixture</title>
	</head>
	<body>
		<h1 id="heading">Frame Parent</h1>
		<p id="top-marker">top-only-value</p>
		<iframe
			id="main-iframe"
			name="main-iframe"
			src="/frame-child.html"
			width="320"
			height="200"
		></iframe>
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
	'query-list.html': QUERY_LIST,
	'keyboard.html': KEYBOARD,
	'hover.html': HOVER,
	'select.html': SELECT,
	'scroll.html': SCROLL,
	'drag.html': DRAG,
	'frame-parent.html': FRAME_PARENT,
	'frame-child.html': FRAME_CHILD,
};
