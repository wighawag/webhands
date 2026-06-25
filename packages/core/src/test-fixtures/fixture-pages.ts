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
		<title>my-browser-controller fixture</title>
	</head>
	<body>
		<h1 id="heading">Fixture Page</h1>
		<p id="status">ready</p>
		<input id="query" type="text" aria-label="Query" />
		<button id="search" type="button">Search</button>
	</body>
</html>
`;

/** Map of request path (relative to root, no leading slash) to page markup. */
export const FIXTURE_PAGES: Readonly<Record<string, string>> = {
	'index.html': INDEX,
};
