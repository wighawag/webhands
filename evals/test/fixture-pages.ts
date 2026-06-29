/**
 * Controlled static fixture pages for the D3 machinery self-test (prd D3),
 * served by {@link ./fixture-server.js}. Mirrors `packages/core`'s
 * `startFixtureServer` style (in-module strings, survives no build step), but
 * lives in `evals/` so the self-test never depends on a live site and stays
 * outside the gate.
 *
 * The fixture models a TRIVIAL multi-step "task" the harness can score: a form
 * page where adding an item appends a `.task-item` row, and submitting it
 * reveals an in-page `#confirmed` landmark (NO navigation, so every milestone's
 * evidence persists on the final DOM, the way a real eval's end-observable
 * state, a cart count or an order id, is checked at the END). That gives the
 * self-test eval ordered MILESTONES (reached-list / item-added) plus a final end
 * state (confirmation), all verb-checkable against this one local DOM.
 */

const INDEX = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>eval self-test fixture</title>
	</head>
	<body>
		<h1 id="heading">Eval Self-Test Fixture</h1>
		<p id="status">ready</p>

		<!-- The landmark the precheck reads to know the entry page loaded. -->
		<div id="app-ready" data-ready="true">app loaded</div>

		<input id="task-input" type="text" aria-label="New task" />
		<button id="add" type="button">Add task</button>
		<ul id="task-list"></ul>

		<button id="submit" type="button">Submit tasks</button>
		<!-- The end-state landmark is revealed in-page on submit (no navigation),
		     so every milestone's evidence persists on the final DOM. -->
		<div id="confirmation" hidden>
			<div id="confirmed" data-order-id="eval-ok">your tasks were submitted</div>
		</div>

		<script>
			document.getElementById('add').addEventListener('click', function () {
				var value = document.getElementById('task-input').value.trim();
				if (value === '') return;
				var li = document.createElement('li');
				li.className = 'task-item';
				li.textContent = value;
				document.getElementById('task-list').appendChild(li);
				document.getElementById('status').textContent = 'item-added';
			});
			document.getElementById('submit').addEventListener('click', function () {
				// Submitting only confirms when at least one task was added.
				if (document.querySelectorAll('.task-item').length === 0) return;
				document.getElementById('confirmation').hidden = false;
				document.getElementById('status').textContent = 'submitted';
			});
		</script>
	</body>
</html>
`;

/** The fixture page table keyed by request path (`/` ⇒ index.html). */
export const FIXTURE_PAGES: Readonly<Record<string, string>> = {
	'index.html': INDEX,
};
