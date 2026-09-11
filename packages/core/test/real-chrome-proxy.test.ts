import {connect, createServer, type Server, type Socket} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	buildRealChromeArgs,
	InvalidProxyError,
	isControllerError,
	ProxyAuthUnsupportedError,
	RealChromeTransport,
	resolveProfileLocation,
	spawnRealChrome,
	startFixtureServer,
	type FixtureServer,
	type RealChrome,
	type Session,
	type SpawnRealChromeOptions,
} from '../src/index.js';
import {
	CI_SANDBOX_ARGS,
	spawnTestChrome,
	testChromeExecutable,
} from './spawn-test-chrome.js';

/**
 * Routing a SPAWNED real Chrome through a SOCKS proxy (`--real-chrome --proxy`).
 *
 * Why this matters more here than on the Playwright launch path: `--real-chrome`
 * exists to present a REAL browser to an anti-bot system, and the exit IP is part
 * of what such a system weighs. A real browser on a datacentre IP is still on a
 * datacentre IP, and in this mode a proxy is the ONLY lever on that, since nothing
 * about the browser is ours to configure.
 *
 * Two layers, mirroring how the launch transport's proxy forwarding is tested:
 *
 * 1. The FLAGS, asserted purely through {@link buildRealChromeArgs} (no browser).
 * 2. The BEHAVIOUR, asserted end to end through a real local SOCKS5 server: the
 *    fixture page loads, and the proxy OBSERVED the connection. Forwarding a flag
 *    is not the same claim as traffic actually going through the proxy, and only
 *    the second one is worth anything to a user.
 */
describe('buildRealChromeArgs proxy flags (pure, no browser)', () => {
	const base: SpawnRealChromeOptions = {userDataDir: '/tmp/profile'};

	it('adds NO proxy flags when no proxy is given', () => {
		const args = buildRealChromeArgs(base);
		expect(args.join(' ')).not.toMatch(/--proxy-server|--host-resolver-rules/);
	});

	it('maps a socks5h:// URL to --proxy-server PLUS the no-leak DNS catch-all', () => {
		const args = buildRealChromeArgs({
			...base,
			proxy: 'socks5h://127.0.0.1:1080',
		});
		// Normalized to the scheme Chromium understands (it has no socks5h).
		expect(args).toContain('--proxy-server=socks5://127.0.0.1:1080');
		// The catch-all that stops the side channels (DNS prefetcher) leaking a raw
		// local query, while still letting Chromium resolve the proxy itself.
		expect(args).toContain(
			'--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
		);
	});

	it('maps a plain socks5:// URL WITHOUT the DNS catch-all (local DNS allowed)', () => {
		const args = buildRealChromeArgs({
			...base,
			proxy: 'socks5://proxy.example:1080',
		});
		expect(args).toContain('--proxy-server=socks5://proxy.example:1080');
		expect(args.join(' ')).not.toMatch(/--host-resolver-rules/);
	});

	it('proxyNoLeak forces (or drops) the DNS catch-all either way', () => {
		expect(
			buildRealChromeArgs({
				...base,
				proxy: 'socks5://p:1080',
				proxyNoLeak: true,
			}).join(' '),
		).toMatch(/--host-resolver-rules/);
		expect(
			buildRealChromeArgs({
				...base,
				proxy: 'socks5h://p:1080',
				proxyNoLeak: false,
			}).join(' '),
		).not.toMatch(/--host-resolver-rules/);
	});

	it('keeps the initial page LAST so caller args can still override flags', () => {
		const args = buildRealChromeArgs({
			...base,
			proxy: 'socks5h://p:1080',
			args: ['--lang=ja'],
		});
		expect(args[args.length - 1]).toBe('about:blank');
		expect(args.indexOf('--lang=ja')).toBeGreaterThan(
			args.indexOf('--proxy-server=socks5://p:1080'),
		);
	});

	it('REFUSES a proxy URL with credentials (Chrome cannot use them)', () => {
		// Chromium's own net/docs/proxy.md: "No authentication methods are supported
		// for SOCKSv5 in Chrome", and it "will not use any credentials embedded in
		// the proxy settings". Passing them through would fail every request, and
		// dropping them silently would leave the user believing their traffic was
		// authenticated and proxied. So: refuse.
		let thrown: unknown;
		try {
			buildRealChromeArgs({
				...base,
				proxy: 'socks5h://user:secret@127.0.0.1:1080',
			});
		} catch (cause) {
			thrown = cause;
		}
		expect(thrown).toBeInstanceOf(ProxyAuthUnsupportedError);
		expect(isControllerError(thrown)).toBe(true);
		expect((thrown as ProxyAuthUnsupportedError).code).toBe(
			'proxy-auth-unsupported',
		);
		// It names the workaround that actually works (terminate auth locally)...
		expect((thrown as ProxyAuthUnsupportedError).message).toMatch(/ssh -D/);
		// ...and does NOT echo the password while naming the proxy.
		expect((thrown as ProxyAuthUnsupportedError).message).not.toMatch(/secret/);
		expect((thrown as ProxyAuthUnsupportedError).message).toMatch(/\*\*\*@/);
	});

	it('still rejects a malformed proxy with the shared typed error', () => {
		// The same parser as the launch path, so a bad value cannot launch unproxied.
		expect(() =>
			buildRealChromeArgs({...base, proxy: 'http://proxy:8080'}),
		).toThrowError(InvalidProxyError);
		expect(() =>
			buildRealChromeArgs({...base, proxy: 'socks5h://host'}),
		).toThrowError(InvalidProxyError);
	});
});

/**
 * Chromium NEVER proxies loopback by default: its implicit proxy bypass list
 * exempts `localhost` / `127.0.0.1`, so a proxy flag alone leaves fixture traffic
 * going direct (observed: Chrome's own background requests appeared in the proxy
 * log while the fixture request did not). `<-loopback>` removes that implicit
 * exemption.
 *
 * This is TEST-ONLY: for a real user the loopback exemption is correct and wanted
 * (you do not want your local dev server proxied), which is why webhands does not
 * pass this flag itself. The tests need it because the only target they are allowed
 * to use is a local fixture, and the claim under test is that real page traffic
 * traverses the proxy.
 */
const PROXY_LOOPBACK_TOO = '--proxy-bypass-list=<-loopback>';

describe('real Chrome through a live SOCKS5 proxy (end to end)', () => {
	let fixture: FixtureServer;
	let proxy: TestSocksProxy;
	const sessions: Session[] = [];
	const spawned: RealChrome[] = [];
	const tempRoots: string[] = [];

	beforeAll(async () => {
		fixture = await startFixtureServer();
		proxy = await startTestSocksProxy();
	});

	afterAll(async () => {
		await proxy.close();
		await fixture.close();
	});

	afterEach(async () => {
		while (sessions.length > 0) {
			await sessions
				.pop()!
				.close()
				.catch(() => {});
		}
		while (spawned.length > 0) {
			await spawned.pop()!.close();
		}
		while (tempRoots.length > 0) {
			await rm(tempRoots.pop()!, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
		}
		proxy.reset();
	});

	it('routes page traffic THROUGH the proxy (the proxy sees the request)', async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), 'mbc-rc-proxy-'));
		tempRoots.push(userDataDir);

		const chrome = await spawnTestChrome({
			userDataDir,
			// `socks5://` (not socks5h) so Chromium may still resolve locally: the
			// fixture is on 127.0.0.1, and the DNS catch-all would block the literal
			// too on some platforms. The PROXY is what we are proving here.
			proxy: `socks5://127.0.0.1:${proxy.port}`,
			args: [PROXY_LOOPBACK_TOO],
		});
		spawned.push(chrome);

		const browser = await chromium.connectOverCDP(chrome.endpoint);
		try {
			const page = browser.contexts()[0]!.pages()[0]!;
			const response = await page.goto(`${fixture.url}/index.html`);

			// The page really loaded...
			expect(response?.ok()).toBe(true);
			expect(await page.title()).toMatch(/Fixture/i);
			// ...and it came through OUR proxy: the proxy was asked to connect to the
			// fixture's host:port. Without the flag applying, this list is empty.
			const fixturePort = Number(new URL(fixture.url).port);
			expect(proxy.connections).toContain(`127.0.0.1:${fixturePort}`);
		} finally {
			await Promise.race([
				browser.close().catch(() => {}),
				new Promise((resolve) => setTimeout(resolve, 2_000)),
			]);
		}
	});

	it('FAILS CLOSED when the proxy is unreachable (never silently direct)', async () => {
		// The property that makes a proxy trustworthy: if it is down, the request
		// fails rather than quietly leaving via the real IP. We assert it because the
		// opposite (a `direct://` fallback) is a one-word change away in Chromium's
		// flag syntax, and would be a privacy hole rather than a convenience.
		const userDataDir = await mkdtemp(join(tmpdir(), 'mbc-rc-proxy-dead-'));
		tempRoots.push(userDataDir);
		const deadPort = await unusedPort();

		const chrome = await spawnTestChrome({
			userDataDir,
			proxy: `socks5://127.0.0.1:${deadPort}`,
			args: [PROXY_LOOPBACK_TOO],
		});
		spawned.push(chrome);

		const browser = await chromium.connectOverCDP(chrome.endpoint);
		try {
			const page = browser.contexts()[0]!.pages()[0]!;
			// Bounded at 4s: Chrome RETRIES a failed SOCKS connection rather than
			// erroring immediately, so the observable is "the navigation does not
			// succeed", not a specific net error string.
			await expect(
				page.goto(`${fixture.url}/index.html`, {timeout: 4_000}),
			).rejects.toThrow();
			// THE claim: it did not quietly fall back to a direct connection, so nothing
			// left via the real IP. Asserted on the page's own URL, which is a LOCAL
			// read: `page.content()` would hang here, because Chrome keeps retrying the
			// dead SOCKS connection and the document never settles.
			expect(page.url()).toBe('about:blank');
		} finally {
			await Promise.race([
				browser.close().catch(() => {}),
				new Promise((resolve) => setTimeout(resolve, 2_000)),
			]);
		}
	}, 30_000);

	it('socks5h DEFERS DNS to the proxy (the proxy receives a HOSTNAME, not an IP)', async () => {
		// The strongest privacy claim in this feature, and previously asserted only as an
		// exact-string match on the flag. With `socks5h` webhands adds Chromium's
		// --host-resolver-rules catch-all, so the browser must NOT resolve locally: the
		// proxy should be handed the NAME to resolve (SOCKS5 address type 0x03), which is
		// also the only thing that exercises that branch of the test proxy.
		const userDataDir = await mkdtemp(join(tmpdir(), 'mbc-rc-proxy-dns-'));
		tempRoots.push(userDataDir);
		const fixturePort = Number(new URL(fixture.url).port);

		const chrome = await spawnTestChrome({
			userDataDir,
			// socks5h => noLeak => the DNS catch-all rides along. `EXCLUDE 127.0.0.1`
			// covers reaching the proxy itself; `localhost` must go to the proxy by NAME.
			proxy: `socks5h://127.0.0.1:${proxy.port}`,
			args: [PROXY_LOOPBACK_TOO],
		});
		spawned.push(chrome);

		const browser = await chromium.connectOverCDP(chrome.endpoint);
		try {
			const page = browser.contexts()[0]!.pages()[0]!;
			const response = await page.goto(
				`http://localhost:${fixturePort}/index.html`,
			);
			expect(response?.ok()).toBe(true);

			// The proxy was asked for the NAME. If Chrome had resolved locally it would
			// have sent 127.0.0.1 (address type 0x01) instead.
			expect(proxy.connections).toContain(`localhost:${fixturePort}`);
			expect(proxy.connections).not.toContain(`127.0.0.1:${fixturePort}`);
		} finally {
			await Promise.race([
				browser.close().catch(() => {}),
				new Promise((resolve) => setTimeout(resolve, 2_000)),
			]);
		}
	}, 30_000);

	it('the TRANSPORT forwards the proxy, so `serve --real-chrome --proxy` is proxied', async () => {
		// The seam-level proof: the same thing, but driven through the transport and
		// the verb surface rather than a raw spawn, which is the path the CLI takes.
		const root = await mkdtemp(join(tmpdir(), 'mbc-rc-proxy-tx-'));
		tempRoots.push(root);
		const transport = new RealChromeTransport({root}, [], {
			headless: true,
			executablePath: testChromeExecutable(),
			proxy: `socks5://127.0.0.1:${proxy.port}`,
			args: [...CI_SANDBOX_ARGS, PROXY_LOOPBACK_TOO],
			spawn: async (o) => {
				const chrome = await spawnRealChrome(o);
				spawned.push(chrome);
				return chrome;
			},
		});

		const session = await transport.open({mode: 'launch', profile: 'proxied'});
		sessions.push(session);
		await session.page.navigate(`${fixture.url}/index.html`);

		const fixturePort = Number(new URL(fixture.url).port);
		expect(proxy.connections).toContain(`127.0.0.1:${fixturePort}`);
		// The profile dir is still the dedicated one (the proxy changes egress, not
		// where state lives).
		expect(resolveProfileLocation('proxied', {root}).profileDir).toContain(
			root,
		);
	});
});

/** A minimal SOCKS5 proxy for tests: no auth, CONNECT only, records targets. */
interface TestSocksProxy {
	readonly port: number;
	/** `host:port` of every CONNECT the proxy was asked to make. */
	readonly connections: string[];
	reset(): void;
	close(): Promise<void>;
}

/**
 * Start a real (if minimal) SOCKS5 server on loopback.
 *
 * Deliberately a REAL proxy rather than a stub: the claim under test is "the
 * browser's traffic goes through the proxy", which a stub cannot establish. It
 * implements just enough of RFC 1928 for Chrome: the no-auth handshake, a CONNECT
 * request (IPv4 / IPv6 / domain-name address types), then blind piping. Recording
 * the requested target is what lets a test prove the page load went through it.
 */
async function startTestSocksProxy(): Promise<TestSocksProxy> {
	const connections: string[] = [];
	const sockets = new Set<Socket>();

	const server: Server = createServer((client) => {
		sockets.add(client);
		client.on('close', () => sockets.delete(client));
		client.on('error', () => client.destroy());

		// `connecting` exists to close a parse race: between recognising a CONNECT and
		// the upstream socket's async callback, any further client bytes would otherwise
		// be re-parsed AS A SECOND CONNECT (reading an ASCII byte as an address type and
		// either destroying the socket or recording a bogus target, which is what every
		// assertion here reads). Chrome happens to wait for the reply, but a recording
		// harness must not depend on the client's politeness.
		let stage: 'greeting' | 'request' | 'connecting' | 'piping' = 'greeting';
		let buffer = Buffer.alloc(0);

		client.on('data', (chunk) => {
			if (stage === 'piping') return;
			buffer = Buffer.concat([buffer, chunk]);

			if (stage === 'greeting') {
				// VER | NMETHODS | METHODS...
				if (buffer.length < 2) return;
				const version = buffer[0]!;
				const nMethods = buffer[1]!;
				if (buffer.length < 2 + nMethods) return;
				const methods = buffer.subarray(2, 2 + nMethods);
				buffer = buffer.subarray(2 + nMethods);
				// Check what we are about to claim: SOCKS5, and the client really did offer
				// "no auth" (0x00). Answering 0x00 regardless would let a future
				// auth-expecting client pass for the wrong reason.
				if (version !== 0x05 || !methods.includes(0x00)) {
					client.write(Buffer.from([0x05, 0xff])); // no acceptable method
					client.destroy();
					return;
				}
				client.write(Buffer.from([0x05, 0x00]));
				stage = 'request';
			}

			if (stage === 'request') {
				// VER | CMD | RSV | ATYP | ADDR | PORT
				if (buffer.length < 4) return;
				const atyp = buffer[3]!;
				let host: string;
				let offset: number;
				if (atyp === 0x01) {
					if (buffer.length < 10) return;
					host = Array.from(buffer.subarray(4, 8)).join('.');
					offset = 8;
				} else if (atyp === 0x03) {
					const len = buffer[4]!;
					if (buffer.length < 5 + len + 2) return;
					host = buffer.subarray(5, 5 + len).toString('utf8');
					offset = 5 + len;
				} else if (atyp === 0x04) {
					if (buffer.length < 22) return;
					const parts: string[] = [];
					for (let i = 4; i < 20; i += 2) {
						parts.push(buffer.readUInt16BE(i).toString(16));
					}
					host = parts.join(':');
					offset = 20;
				} else {
					// 0x08 = address type not supported (rather than a bare socket destroy,
					// which looks to the client like a crash).
					client.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
					client.destroy();
					return;
				}
				const port = buffer.readUInt16BE(offset);
				buffer = buffer.subarray(offset + 2);
				connections.push(`${host}:${port}`);
				// Claim the connection IMMEDIATELY, before the async connect callback, so
				// any bytes arriving in between are buffered rather than misparsed.
				stage = 'connecting';

				const upstream = connect({host, port}, () => {
					// 0x05 0x00 = success, then a dummy BND.ADDR/BND.PORT (Chrome ignores it).
					client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
					stage = 'piping';
					if (buffer.length > 0) {
						upstream.write(buffer);
						buffer = Buffer.alloc(0);
					}
					client.pipe(upstream);
					upstream.pipe(client);
				});
				upstream.on('error', () => {
					// 0x05 0x01 = general failure.
					client.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
					client.destroy();
				});
				sockets.add(upstream);
				upstream.on('close', () => sockets.delete(upstream));
			}
		});
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('test SOCKS proxy failed to bind');
	}

	return {
		port: address.port,
		connections,
		reset() {
			connections.length = 0;
		},
		async close() {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

/** A port nothing is listening on (bind then immediately release it). */
async function unusedPort(): Promise<number> {
	const probe = createServer();
	await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
	const address = probe.address();
	const port =
		address !== null && typeof address !== 'string' ? address.port : 0;
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	return port;
}
