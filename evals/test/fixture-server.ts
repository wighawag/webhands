import {createServer, type Server} from 'node:http';
import {FIXTURE_PAGES} from './fixture-pages.js';

/**
 * A local HTTP server for the controlled self-test fixture pages, mirroring
 * `packages/core`'s `startFixtureServer` (the local-fixture style the task asks
 * the self-test to reuse). It is the DETERMINISTIC stand-in for a real site so
 * the D3 machinery proof never rots on a third party's DOM and never needs the
 * network. Binds `127.0.0.1` on an OS-assigned port; `/` serves `index.html`.
 */

/** A running fixture server with the base URL to point the harness at. */
export interface FixtureServer {
	/** The base URL, e.g. `http://127.0.0.1:52831`. */
	readonly url: string;
	/** Stop the server and release the port. */
	close(): Promise<void>;
}

/** Start the local fixture server (see {@link FixtureServer}). */
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
