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
 * A page whose submit button triggers a SLOW navigation (PRD story 8, the
 * "real submit button" path). Clicking `#slow-submit` navigates to
 * `index.html?delayMs=1500`; the fixture server holds that response back ~1.5s,
 * so the navigation the click schedules takes far longer than the verb's short
 * actionability budget. The element is a perfectly normal, visible, actionable
 * button, so `click` must perform the click and NOT mistake the slow post-click
 * navigation for a non-actionable element (which would wrongly route it to the
 * dispatch escape and re-click a page already navigating away). The test
 * asserts the effect: after the click, the reader ends up on `index.html`.
 */
const SLOW_SUBMIT = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>slow submit fixture</title>
	</head>
	<body>
		<h1 id="heading">Slow Submit Fixture</h1>
		<!-- GET form: the action's query is dropped and rebuilt from the fields,
		     so delayMs is carried as a hidden field (a bare action query would be
		     lost on submit). -->
		<form action="/index.html" method="get">
			<input type="hidden" name="delayMs" value="1500" />
			<input id="slow-submit" type="submit" value="Continue" />
		</form>
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

/**
 * A page exercising the Tier-4 coordinate `mouse` verb (prd
 * `broaden-agent-verb-surface`, R3, stories 17-18). It records WHERE a
 * coordinate click/press landed so a test asserts the verb acted at the
 * intended VIEWPORT pixel, and proves the VIEWPORT-screenshot <-> `mouse`
 * coordinate contract end to end:
 *
 * - `#hit-target` is an absolutely-positioned box at a KNOWN viewport position
 *   and size. Its `click` handler flips `#hit-state` to `hit` and records the
 *   event's `clientX,clientY` into `#hit-coords`, so a `mouse({action:'click',
 *   x, y})` at a coordinate OVER the box runs the box's handler (assert the
 *   effect), and a coordinate OUTSIDE it does NOT (the look-then-click loop is
 *   only meaningful if the click lands where the agent aimed).
 * - `#move-target` flips `#move-state` to `moved` on `mouseenter`, so a bare
 *   `mouse({action:'move', x, y})` (no button) is observable too.
 * - `#down-up-target` records `mousedown`/`mouseup` so the press/release halves
 *   are exercised.
 *
 * The page pins `margin:0` and a deterministic layout so the box's viewport
 * coordinates are stable; the test reads the box's real `getBoundingClientRect`
 * (via `eval`) and clicks its centre, so it never hard-codes a pixel that a
 * platform default could shift.
 */
const COORDINATE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>coordinate fixture</title>
		<style>
			html,
			body {
				margin: 0;
				padding: 0;
			}
			#hit-target {
				position: absolute;
				left: 100px;
				top: 80px;
				width: 120px;
				height: 90px;
				background: #4a7;
			}
			#move-target {
				position: absolute;
				left: 300px;
				top: 80px;
				width: 80px;
				height: 80px;
				background: #74a;
			}
			#down-up-target {
				position: absolute;
				left: 100px;
				top: 220px;
				width: 120px;
				height: 90px;
				background: #a74;
			}
		</style>
	</head>
	<body>
		<div id="hit-target"></div>
		<div id="move-target"></div>
		<div id="down-up-target"></div>
		<p id="hit-state">untouched</p>
		<p id="hit-coords"></p>
		<p id="move-state">idle</p>
		<p id="down-up-state">idle</p>
		<script>
			var hit = document.getElementById('hit-target');
			hit.addEventListener('click', function (e) {
				document.getElementById('hit-state').textContent = 'hit';
				document.getElementById('hit-coords').textContent =
					Math.round(e.clientX) + ',' + Math.round(e.clientY);
			});
			document
				.getElementById('move-target')
				.addEventListener('mouseenter', function () {
					document.getElementById('move-state').textContent = 'moved';
				});
			var du = document.getElementById('down-up-target');
			du.addEventListener('mousedown', function () {
				document.getElementById('down-up-state').textContent = 'down';
			});
			du.addEventListener('mouseup', function () {
				var el = document.getElementById('down-up-state');
				el.textContent = el.textContent === 'down' ? 'down-up' : 'up-only';
			});
		</script>
	</body>
</html>
`;

/**
 * A page exercising the Tier-4 `screenshot` verb's ELEMENT scope (prd
 * `broaden-agent-verb-surface`, R3, story 17). `#widget` is a fixed-size,
 * solid-colour box (a stand-in for a captcha widget) at a known size, so an
 * element-clipped screenshot of it produces a PNG whose dimensions match the
 * widget, not the viewport. A taller body makes a FULL-PAGE shot strictly
 * taller than a VIEWPORT shot, so the three scopes are distinguishable by the
 * returned dimensions.
 */
const SCREENSHOT = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>screenshot fixture</title>
		<style>
			html,
			body {
				margin: 0;
				padding: 0;
			}
			#widget {
				width: 200px;
				height: 150px;
				background: #2a6;
			}
			#tall {
				height: 3000px;
				background: linear-gradient(#fff, #036);
			}
		</style>
	</head>
	<body>
		<div id="widget">widget</div>
		<div id="tall">tall body for full-page</div>
	</body>
</html>
`;

/**
 * The SAME-ORIGIN TOKEN-HARVEST captcha child frame (prd
 * `broaden-agent-verb-surface`, stories 6-7; the
 * `frame-aware-query-token-harvest-captcha-proof` task). It is the child
 * embedded by {@link TOKEN_CAPTCHA_PARENT} as `#main-iframe`, and it carries the
 * whole token-harvest widget the way a real hCaptcha/Imperva `#main-iframe`
 * does (per `work/notes/findings/click-and-type-already-frame-scoped-via-
 * framelocator.md` and `…playwright-cross-origin-frame-captcha-mechanics.md`):
 *
 * - `div.h-captcha[data-sitekey]` is the PAGE-READABLE sitekey an agent reads
 *   through a `frameLocator('#main-iframe').locator('.h-captcha')` +
 *   `attrs:['data-sitekey']` (the one frame-aware READ the spike found missing).
 *   `data-callback="onCaptchaFinished"` names the page callback, exactly as the
 *   real widget wires it.
 * - `textarea#h-captcha-response` is the same-origin RESPONSE SINK an agent
 *   `type`s the provider token into (the delivery half the spike proved already
 *   works through the `frameLocator` hop).
 * - `window.onCaptchaFinished(token)` is the page callback: it ACCEPTS the token
 *   ONLY when it matches what was written into the sink (so a real token must
 *   travel sink -> callback, not be conjured), flips `#captcha-state` to
 *   `verified`, sets `window.__captchaSolved`, and reveals `#protected-content`
 *   (the page ADVANCES). A mismatched/empty token flips it to `rejected` and the
 *   page does NOT advance, so the proof asserts a real transition the verbs
 *   drove, not a no-op.
 *
 * webhands ships NO solver and NO key: the token is whatever the agent brings
 * (in the proof, a TEST FAKE provider mints one: no real network, no real key).
 */
const TOKEN_CAPTCHA_CHILD = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>token-harvest captcha frame</title>
	</head>
	<body>
		<h1 id="captcha-heading">Verify you are human</h1>
		<!-- The page-readable sitekey + the callback name, the real widget shape. -->
		<div
			class="h-captcha"
			data-sitekey="sk-token-harvest-abc123"
			data-callback="onCaptchaFinished"
		></div>
		<!-- The same-origin response sink the token is typed into. -->
		<textarea id="h-captcha-response" name="h-captcha-response"></textarea>
		<p id="captcha-state">pending</p>
		<div id="protected-content" style="display: none">protected resource</div>
		<script>
			window.__captchaSolved = false;
			// The page callback the agent fires AFTER writing the token into the sink.
			// It accepts the token only if it matches the sink value (the token must
			// genuinely travel sink -> callback), modelling the real widget's
			// inject-token-then-fire-callback flow. The page ADVANCES on success.
			window.onCaptchaFinished = function (token) {
				var sink = document.getElementById('h-captcha-response');
				var state = document.getElementById('captcha-state');
				if (token && token === sink.value) {
					window.__captchaSolved = true;
					state.textContent = 'verified';
					document.getElementById('protected-content').style.display = '';
					return 'verified';
				}
				state.textContent = 'rejected';
				return 'rejected';
			};
		</script>
	</body>
</html>
`;

/**
 * The PARENT page for the SAME-ORIGIN TOKEN-HARVEST captcha proof (prd
 * `broaden-agent-verb-surface`, stories 6-7). It embeds {@link
 * TOKEN_CAPTCHA_CHILD} as a SAME-ORIGIN child frame (`#main-iframe`, relative
 * `src`), mirroring the Imperva `#main-iframe` structure the findings give for
 * the reachable token-harvest path: the sitekey, the response sink, and the
 * callback ALL live one same-origin frame down, addressed via a
 * `frameLocator('#main-iframe')` hop in the locator string (no `--frame` flag,
 * R1). The top document carries only a heading, so the captcha widget is
 * genuinely IN the child frame (a top-document `.h-captcha` query is empty).
 */
const TOKEN_CAPTCHA_PARENT = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>token-harvest captcha host</title>
	</head>
	<body>
		<h1 id="host-heading">Protected page</h1>
		<iframe
			id="main-iframe"
			name="main-iframe"
			src="/token-captcha-child.html"
			width="320"
			height="240"
		></iframe>
	</body>
</html>
`;

/**
 * The Tier-4 CROSS-ORIGIN nested-frame fixture (prd
 * `broaden-agent-verb-surface`, R3, stories 17-19), mirroring the synthetic
 * doubly-nested cross-origin tree the finding
 * `playwright-cross-origin-frame-captcha-mechanics.md` spike-verified:
 *
 * ```
 * top (host)
 *  └─ iframe#child-frame       ← CROSS-ORIGIN (a second fixture-server origin)
 *     └─ iframe#child-frame    ← CROSS-ORIGIN AGAIN (a third origin)
 *        └─ the tile grid + token sink
 * ```
 *
 * Because the fixture server serves IDENTICAL pages on every port, the test
 * composes the three origins by passing each child frame's absolute URL in a
 * `?child=<url>` query param; this page reads its OWN query string and points
 * `#child-frame` at the given child URL. Every level uses the SAME iframe id
 * (`#child-frame`), so a `frameLocator('#child-frame').frameLocator('#child-frame')`
 * chain reads two cross-origin boundaries deep. With no `child` param the frame
 * is removed, so the SAME page is the host, the WAF level, and the deepest
 * captcha level depending on the URL the test embeds. The deepest level (no
 * `child`) carries the controlled tile/token state the READ asserts, and a
 * `#tile-1` widget an element-clipped screenshot targets.
 */
const NESTED_FRAME = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>nested frame fixture</title>
		<style>
			#tile-1 {
				width: 90px;
				height: 90px;
				background: #c33;
			}
		</style>
	</head>
	<body>
		<h1 id="level-heading">nested frame level</h1>
		<!-- The tile grid + token sink, present at EVERY level but meaningful at
		     the deepest (captcha) one the test reads into. -->
		<div id="challenge" class="challenge">
			<div id="tile-1" class="tile" data-tile="1">tile 1</div>
			<div class="tile" data-tile="2">tile 2</div>
			<div class="tile" data-tile="3">tile 3</div>
			<textarea id="h-captcha-response" name="h-captcha-response">deep-token-123</textarea>
		</div>
		<iframe id="child-frame" name="child-frame" width="360" height="300"></iframe>
		<script>
			// Read this level's OWN ?child=<url> and point the nested frame at it, so
			// the test composes the cross-origin tree across distinct origins. Every
			// level uses the SAME iframe id (#child-frame) so a
			// frameLocator('#child-frame').frameLocator('#child-frame') chain reads two
			// cross-origin boundaries deep.
			var params = new URLSearchParams(window.location.search);
			var child = params.get('child');
			var frame = document.getElementById('child-frame');
			if (child) {
				frame.src = child;
			} else if (frame && frame.parentNode) {
				// Deepest level: no child, remove the empty trailing iframe so the tree
				// ends cleanly at the tile grid.
				frame.parentNode.removeChild(frame);
			}
		</script>
	</body>
</html>
`;

/**
 * The Tier-4 VISION/TILE captcha fixture (prd `broaden-agent-verb-surface`, R3,
 * story 17; the `vision-tile-captcha-end-to-end-proof` task). It mirrors the
 * doubly-nested CROSS-ORIGIN tree the finding
 * `playwright-cross-origin-frame-captcha-mechanics.md` spike-verified, but unlike
 * the read-only {@link NESTED_FRAME} fixture its deepest level is an INTERACTIVE
 * tile challenge that ADVANCES when the right tiles are clicked:
 *
 * ```
 * top (host)
 *  └─ iframe#child-frame       ← CROSS-ORIGIN (a second fixture-server origin, the WAF level)
 *     └─ iframe#child-frame    ← CROSS-ORIGIN AGAIN (a third origin, the captcha level)
 *        └─ the interactive 3x3 tile grid + challenge state
 * ```
 *
 * Cross-origin composition is the SAME `?child=<url>` mechanism
 * {@link NESTED_FRAME} uses (the fixture server serves identical pages on every
 * port, so the test threads three distinct origins by passing each child's
 * absolute URL). Every level shares the iframe id `#child-frame`, so a
 * `frameLocator('#child-frame').frameLocator('#child-frame')` chain reaches the
 * deepest (captcha) level two cross-origin boundaries deep.
 *
 * The deepest level (no `?child`) is the challenge. It is the part that makes
 * this a vision/tile PROOF rather than a static read:
 *
 * - A 3x3 grid of `.tile` cells, each absolutely positioned at a KNOWN, distinct
 *   spot (so an element-clipped/viewport screenshot of the widget shows them at
 *   stable coordinates, and a `bbox` read gives each tile's VIEWPORT-relative
 *   centre — the coordinate<->screenshot bridge). Each tile carries `data-tile`
 *   (its index `0..8`) and `data-target` (`"1"` for the tiles the challenge wants
 *   selected, `"0"` otherwise). The TARGET set is fixed in the markup, so the
 *   test's selection is DETERMINISTIC (it stands in for a vision model's
 *   decision; webhands ships no solver).
 * - Clicking a tile (a real coordinate `mouse` click runs the tile's own click
 *   handler) toggles its `selected` state and appends its index to `#selection`.
 *   Clicking a tile that is NOT a target marks the attempt `wrong` (so a sloppy
 *   coordinate that hit the neighbouring tile is OBSERVABLE, not silently
 *   tolerated — the coordinate contract is load-bearing).
 * - `#submit` checks the selection against the target set; when EXACTLY the
 *   target tiles are selected it flips `#challenge-state` to `solved` and sets
 *   `window.__solved = true` (the challenge ADVANCES). Until then it reads
 *   `pending` (or `wrong` after a mis-click), so the proof asserts a real state
 *   transition the verbs drove, not a no-op.
 *
 * All challenge state lives in the deepest frame's DOM, so the proof reads it
 * through the SAME cross-origin `frameLocator` chain the clicks act through.
 */
const TILE_CAPTCHA = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>tile captcha fixture</title>
		<style>
			html,
			body {
				margin: 0;
				padding: 0;
			}
			/* #grid is the positioned WIDGET (a known size), so an element-clipped
			   screenshot of it clips the tile grid, and the absolutely-positioned
			   tiles lay out relative to IT at stable, distinct coordinates. */
			#grid {
				position: relative;
				width: 300px;
				height: 300px;
			}
			.tile {
				position: absolute;
				width: 90px;
				height: 90px;
				background: #cdd;
				box-sizing: border-box;
				border: 1px solid #899;
			}
			.tile.selected {
				background: #3a7;
			}
		</style>
	</head>
	<body>
		<!-- The child iframe comes FIRST and is pinned to the top-left, so on a
		     PARENT level (one with ?child) the nested tree starts at the viewport
		     origin and the deepest grid stays IN the viewport — the coordinate<->
		     screenshot contract only holds for on-screen tiles. The challenge UI is
		     hidden on parent levels (it is meaningful only at the deepest level). -->
		<iframe id="child-frame" name="child-frame" width="380" height="560"></iframe>
		<!-- The interactive challenge, present at EVERY level (so the chain is
		     uniform) but meaningful only at the deepest (no-child) one the proof
		     reads + clicks into. -->
		<div id="challenge" class="challenge">
			<p id="prompt">Select the marked tiles</p>
			<p id="challenge-state">pending</p>
			<p id="selection"></p>
			<div id="grid"></div>
			<button id="submit" type="button">Verify</button>
		</div>
		<script>
			// The fixed TARGET set (the tiles the challenge wants). Deterministic, so
			// the proof's selection stands in for a vision model with zero solver code.
			var TARGETS = [0, 4, 8];
			var GRID = document.getElementById('grid');
			var selection = [];
			for (var i = 0; i < 9; i++) {
				(function (index) {
					var tile = document.createElement('div');
					tile.className = 'tile';
					tile.id = 'tile-' + index;
					tile.setAttribute('data-tile', String(index));
					tile.setAttribute(
						'data-target',
						TARGETS.indexOf(index) >= 0 ? '1' : '0',
					);
					tile.style.left = (index % 3) * 100 + 'px';
					tile.style.top = Math.floor(index / 3) * 100 + 'px';
					tile.textContent = String(index);
					tile.addEventListener('click', function () {
						var at = selection.indexOf(index);
						if (at >= 0) {
							selection.splice(at, 1);
							tile.classList.remove('selected');
						} else {
							selection.push(index);
							tile.classList.add('selected');
						}
						document.getElementById('selection').textContent = selection
							.slice()
							.sort(function (a, b) {
								return a - b;
							})
							.join(',');
					});
					GRID.appendChild(tile);
				})(i);
			}

			window.__solved = false;
			document.getElementById('submit').addEventListener('click', function () {
				var chosen = selection.slice().sort(function (a, b) {
					return a - b;
				});
				var want = TARGETS.slice().sort(function (a, b) {
					return a - b;
				});
				var ok =
					chosen.length === want.length &&
					chosen.every(function (v, i) {
						return v === want[i];
					});
				var state = document.getElementById('challenge-state');
				if (ok) {
					window.__solved = true;
					state.textContent = 'solved';
				} else {
					state.textContent = 'wrong';
				}
			});

			// Cross-origin composition, mirroring NESTED_FRAME: read this level's
			// ?child=<url> and point #child-frame at it. On a PARENT level we HIDE this
			// level's own challenge UI and pin the iframe to the top, so the only thing
			// occupying the viewport is the nested tree — keeping the DEEPEST grid on
			// screen (its tiles' viewport coordinates are what the mouse verb clicks).
			// The
			// deepest level (no child) removes the empty trailing iframe and shows the
			// challenge.
			var params = new URLSearchParams(window.location.search);
			var child = params.get('child');
			var frame = document.getElementById('child-frame');
			if (child) {
				frame.src = child;
				document.getElementById('challenge').style.display = 'none';
			} else if (frame && frame.parentNode) {
				frame.parentNode.removeChild(frame);
			}
		</script>
	</body>
</html>
`;

/**
 * A page for the durable `query` `ref` (prd `broaden-agent-verb-surface`, R4;
 * task `query-durable-ref-handle`). A results list whose rows exercise the
 * REF PREFERENCE LADDER and the loud-stale contract WITHOUT any framework, by
 * driving the exact reconciliation shapes the React/Svelte spike measured via
 * plain DOM mutations:
 *
 * - Each `.result` has a per-row buy button. Charlie's button carries a STABLE
 *   UNIQUE id (`#buy-charlie`) and a `data-testid` (ladder step 1 reuse). Other
 *   buy buttons are ANONYMOUS (no id/testid/name), so a ref for them must MINT
 *   (ladder step 2).
 * - `#dupe-a` / `#dupe-b` rows both carry `data-testid="dupe"` (NON-unique), so a
 *   ref must VERIFY uniqueness and fall through (mint) rather than reuse it.
 * - `window.__prepend()` inserts a NEW row at the TOP (index drift): a positional
 *   `.nth(i)` now points at the wrong row, but a ref rides with its element.
 * - `window.__replaceCharlie()` REMOVES Charlie's row and inserts a fresh node in
 *   its place (the keyed NODE-REPLACEMENT case): a MINTED ref on it goes stale
 *   (resolve-to-zero), a reused `#buy-charlie` ref also goes stale if the new
 *   node lacks it — both must fail LOUD, never act on the wrong element.
 * - `window.__cloneAnon(id)` deep-clones an anonymous row carrying a minted attr,
 *   so its ref resolves to MORE THAN ONE element (ambiguous) — also loud-stale.
 */
const REF_LIST = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>ref list fixture</title>
	</head>
	<body>
		<h1 id="heading">Ref List Fixture</h1>
		<ul id="results">
			<li class="result" data-name="Alpha">
				<span class="title">Alpha Widget</span>
				<button class="buy">Buy</button>
			</li>
			<li class="result" data-name="Bravo">
				<span class="title">Bravo Widget</span>
				<button class="buy">Buy</button>
			</li>
			<li class="result" data-name="Charlie" id="row-charlie">
				<span class="title">Charlie Widget</span>
				<button class="buy" id="buy-charlie" data-testid="buy-charlie">
					Buy
				</button>
			</li>
			<li class="result" data-name="Delta">
				<span class="title">Delta Widget</span>
				<button class="buy">Buy</button>
			</li>
		</ul>

		<!-- two rows sharing a NON-unique data-testid, to prove uniqueness is
		     VERIFIED and a duplicate falls through the ladder to a mint. -->
		<ul id="dupes">
			<li class="dupe-row" data-testid="dupe"><button class="buy">A</button></li>
			<li class="dupe-row" data-testid="dupe"><button class="buy">B</button></li>
		</ul>

		<!-- a recorder so a test can prove WHICH buy button was clicked, not merely
		     that the click did not throw. -->
		<pre id="clicklog"></pre>

		<script>
			document.addEventListener('click', function (e) {
				var btn = e.target.closest('button.buy');
				if (!btn) return;
				var row = btn.closest('.result, .dupe-row');
				var label = row ? row.getAttribute('data-name') || row.textContent.trim() : '?';
				document.getElementById('clicklog').textContent += label + ';';
			});

			function makeRow(name) {
				var li = document.createElement('li');
				li.className = 'result';
				li.setAttribute('data-name', name);
				var title = document.createElement('span');
				title.className = 'title';
				title.textContent = name + ' Widget';
				var buy = document.createElement('button');
				buy.className = 'buy';
				buy.textContent = 'Buy';
				li.appendChild(title);
				li.appendChild(buy);
				return li;
			}

			// Index drift: a NEW row at the TOP. Existing element nodes are KEPT (a
			// reused stable attr AND a minted attr ride with them); only positions
			// shift, so a positional .nth(i) now picks the wrong row.
			window.__prepend = function () {
				var ul = document.getElementById('results');
				ul.insertBefore(makeRow('Zeta'), ul.firstElementChild);
			};

			// NODE REPLACEMENT: remove Charlie's row entirely and insert a FRESH node
			// in its place (no minted attr, no #buy-charlie). A ref minted on the old
			// Charlie button resolves to ZERO; a reused #buy-charlie ref also to ZERO.
			window.__replaceCharlie = function () {
				var old = document.getElementById('row-charlie');
				var fresh = makeRow('Charlie');
				old.parentNode.replaceChild(fresh, old);
			};

			// AMBIGUITY: deep-clone a node carrying a minted attribute so the ref now
			// resolves to MORE THAN ONE element.
			window.__cloneByAttr = function (attr, value) {
				var el = document.querySelector('[' + attr + '="' + value + '"]');
				if (!el) return false;
				var host = document.getElementById('results');
				host.appendChild(el.closest('.result, .dupe-row, button').cloneNode(true));
				return true;
			};
		</script>
	</body>
</html>
`;

/** Map of request path (relative to root, no leading slash) to page markup. */
export const FIXTURE_PAGES: Readonly<Record<string, string>> = {
	'index.html': INDEX,
	'click-type.html': CLICK_TYPE,
	'delayed.html': DELAYED_CONTENT,
	'slow-submit.html': SLOW_SUBMIT,
	'redirecting.html': REDIRECTING,
	'eval.html': EVAL,
	'cookies.html': COOKIES,
	'query-list.html': QUERY_LIST,
	'ref-list.html': REF_LIST,
	'keyboard.html': KEYBOARD,
	'hover.html': HOVER,
	'select.html': SELECT,
	'scroll.html': SCROLL,
	'drag.html': DRAG,
	'frame-parent.html': FRAME_PARENT,
	'frame-child.html': FRAME_CHILD,
	'coordinate.html': COORDINATE,
	'screenshot.html': SCREENSHOT,
	'token-captcha-parent.html': TOKEN_CAPTCHA_PARENT,
	'token-captcha-child.html': TOKEN_CAPTCHA_CHILD,
	'nested-frame.html': NESTED_FRAME,
	'tile-captcha.html': TILE_CAPTCHA,
};
