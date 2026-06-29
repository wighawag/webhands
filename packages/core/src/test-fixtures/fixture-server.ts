import {createServer, type Server} from 'node:http';
import {FIXTURE_PAGES} from './fixture-pages.js';

/** Largest artificial response delay a fixture request may ask for (a guard so
 * a stray `?delayMs=` can never hang the suite). */
const MAX_DELAY_MS = 5_000;

/** Parse `?delayMs=N` from a request URL, clamped to `[0, MAX_DELAY_MS]`. */
function parseDelayMs(reqUrl: string): number {
	const q = reqUrl.indexOf('?');
	if (q === -1) return 0;
	const raw = new URLSearchParams(reqUrl.slice(q + 1)).get('delayMs');
	const n = raw === null ? 0 : Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(n, MAX_DELAY_MS);
}

/** A running fixture server, with the base URL to point a browser at. */
export interface FixtureServer {
	/** The base URL, e.g. `http://127.0.0.1:52831`. */
	readonly url: string;
	/** Stop the server and release the port. */
	close(): Promise<void>;
}

/**
 * Start a local HTTP server that serves the controlled static fixture pages
 * from {@link FIXTURE_PAGES}. This is the DETERMINISTIC target for later
 * verb-behaviour tests (navigate / snapshot / click / type / eval / wait /
 * cookies): those tests drive a real browser against this server instead of a
 * third-party site, so they never rot on someone else's DOM.
 *
 * Binds to `127.0.0.1` on an OS-assigned ephemeral port (pass a fixed `port`
 * only if a test needs one). `/` serves `index.html`.
 */
export async function startFixtureServer(port = 0): Promise<FixtureServer> {
	const server: Server = createServer((req, res) => {
		const reqUrl = req.url ?? '/';
		const rawPath = reqUrl.split('?')[0];
		const key = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
		const body = FIXTURE_PAGES[key];
		if (body === undefined) {
			res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
			res.end('not found');
			return;
		}
		// A `?delayMs=N` query holds the RESPONSE back by N ms before sending the
		// (otherwise normal) page. This makes a slow NAVIGATION deterministic: a
		// click that submits to `index.html?delayMs=1500` performs instantly but
		// the navigation only commits ~1.5s later, the case the `click` verb must
		// not mistake for a non-actionable element (it auto-waits for navigation
		// only when not told otherwise). Capped so a bad value cannot hang a test.
		const delayMs = parseDelayMs(reqUrl);
		const send = () => {
			res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
			res.end(body);
		};
		if (delayMs > 0) {
			setTimeout(send, delayMs);
		} else {
			send();
		}
	});

	await new Promise<void>((resolve) =>
		server.listen(port, '127.0.0.1', resolve),
	);

	const address = server.address();
	if (address === null || typeof address === 'string') {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		throw new Error('fixture server failed to bind to a TCP port');
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		close() {
			return new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		},
	};
}
