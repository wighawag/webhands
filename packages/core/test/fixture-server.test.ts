import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {startFixtureServer, type FixtureServer} from '../src/index.js';

describe('fixture server', () => {
	let server: FixtureServer;

	beforeAll(async () => {
		server = await startFixtureServer();
	});

	afterAll(async () => {
		await server.close();
	});

	it('binds to a loopback URL', () => {
		expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
	});

	it('serves the controlled index page at /', async () => {
		const res = await fetch(`${server.url}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		const html = await res.text();
		expect(html).toContain('id="search"');
		expect(html).toContain('Fixture Page');
	});

	it('404s an unknown path', async () => {
		const res = await fetch(`${server.url}/does-not-exist.html`);
		expect(res.status).toBe(404);
	});
});
