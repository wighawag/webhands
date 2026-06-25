import {createServer, type Server} from 'node:http';
import {FIXTURE_PAGES} from './fixture-pages.js';

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
		const rawPath = (req.url ?? '/').split('?')[0];
		const key = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
		const body = FIXTURE_PAGES[key];
		if (body === undefined) {
			res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
			res.end('not found');
			return;
		}
		res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
		res.end(body);
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
