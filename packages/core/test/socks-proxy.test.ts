import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
	hostResolverRulesArg,
	InvalidProxyError,
	isControllerError,
	parseSocksProxy,
	PlaywrightLaunchTransport,
	resolveProfileLocation,
	type StealthChromiumImporter,
} from '../src/index.js';

describe('parseSocksProxy', () => {
	it('parses a socks5h:// URL as no-leak with a normalized socks5 server', () => {
		const p = parseSocksProxy('socks5h://proxy.example:1080');
		expect(p).toEqual({
			server: 'socks5://proxy.example:1080',
			host: 'proxy.example',
			noLeak: true,
		});
	});

	it('parses a socks5:// URL as local-DNS-allowed (noLeak false)', () => {
		const p = parseSocksProxy('socks5://127.0.0.1:9050');
		expect(p).toEqual({
			server: 'socks5://127.0.0.1:9050',
			host: '127.0.0.1',
			noLeak: false,
		});
	});

	it('accepts socks:// as an alias for socks5:// (local DNS allowed)', () => {
		const p = parseSocksProxy('socks://host:1080');
		expect(p.server).toBe('socks5://host:1080');
		expect(p.noLeak).toBe(false);
	});

	it('extracts and URL-decodes user:pass@ credentials', () => {
		const p = parseSocksProxy('socks5h://us%40er:p%3Ass@host:1080');
		expect(p.username).toBe('us@er');
		expect(p.password).toBe('p:ss');
		// Credentials are NOT echoed into the server string.
		expect(p.server).toBe('socks5://host:1080');
	});

	it('forceNoLeak overrides the scheme both ways', () => {
		// socks5:// forced to no-leak.
		expect(parseSocksProxy('socks5://host:1080', true).noLeak).toBe(true);
		// socks5h:// forced to allow local DNS.
		expect(parseSocksProxy('socks5h://host:1080', false).noLeak).toBe(false);
	});

	it('throws a typed InvalidProxyError on non-SOCKS or malformed values', () => {
		for (const bad of [
			'',
			'   ',
			'host:1080', // no scheme
			'http://host:1080', // wrong scheme
			'https://host:1080',
			'socks4://host:1080', // unsupported socks version
			'socks5h://host', // no port
			'socks5h://:1080', // no host
			'not a url',
		]) {
			const err = (() => {
				try {
					parseSocksProxy(bad);
					return undefined;
				} catch (e) {
					return e;
				}
			})();
			expect(err, `expected ${JSON.stringify(bad)} to throw`).toBeInstanceOf(
				InvalidProxyError,
			);
			expect(isControllerError(err)).toBe(true);
			expect((err as InvalidProxyError).code).toBe('invalid-proxy');
			expect((err as InvalidProxyError).value).toBe(bad);
		}
	});
});

describe('hostResolverRulesArg', () => {
	it('builds the Chromium catch-all that blocks local DNS but excludes the proxy host', () => {
		expect(hostResolverRulesArg('proxy.example')).toBe(
			'--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE proxy.example',
		);
	});
});

/**
 * HERMETIC proxy-launch wiring: NO real browser, NO network. We reuse the
 * transport's internal stealth-import seam purely as a launch SPY (the SAME
 * launchOptions object is built for vanilla and stealth alike), so we can assert
 * exactly what Playwright would receive for a `--proxy` launch.
 */
describe('PlaywrightLaunchTransport proxy wiring (hermetic)', () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		while (tempRoots.length > 0) {
			const dir = tempRoots.pop()!;
			await rm(dir, {recursive: true, force: true});
		}
	});

	async function makeSetUpProfile(name = 'default'): Promise<{root: string}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-proxy-'));
		tempRoots.push(root);
		const loc = resolveProfileLocation(name, {root});
		await mkdir(loc.profileDir, {recursive: true});
		return {root};
	}

	function fakeContext() {
		const page = {} as never;
		return {
			pages: () => [page],
			newPage: async () => page,
			on: () => {},
		} as never;
	}

	function launchSpyTransport(
		root: string,
		proxy: string,
		proxyNoLeak?: boolean,
	) {
		const launchSpy = vi.fn(async () => fakeContext());
		const importStealthChromium: StealthChromiumImporter = async () => ({
			chromium: {launchPersistentContext: launchSpy as never},
		});
		const transport = new PlaywrightLaunchTransport({root}, [], {
			// Use the stealth path only as a launch SPY; the proxy logic is shared.
			stealth: true,
			noViewport: false,
			proxy,
			...(proxyNoLeak !== undefined ? {proxyNoLeak} : {}),
			importStealthChromium,
		});
		return {transport, launchSpy};
	}

	it('forwards a socks5h:// proxy AND the no-leak --host-resolver-rules arg', async () => {
		const {root} = await makeSetUpProfile('p1');
		const {transport, launchSpy} = launchSpyTransport(
			root,
			'socks5h://proxy.example:1080',
		);
		await transport.open({mode: 'launch', profile: 'p1'});

		const [, options] = launchSpy.mock.calls[0]!;
		expect((options as {proxy?: unknown}).proxy).toEqual({
			server: 'socks5://proxy.example:1080',
		});
		expect((options as {args?: string[]}).args).toContain(
			'--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE proxy.example',
		);
	});

	it('forwards a socks5:// proxy WITHOUT the no-leak arg (local DNS allowed)', async () => {
		const {root} = await makeSetUpProfile('p2');
		const {transport, launchSpy} = launchSpyTransport(
			root,
			'socks5://127.0.0.1:9050',
		);
		await transport.open({mode: 'launch', profile: 'p2'});

		const [, options] = launchSpy.mock.calls[0]!;
		expect((options as {proxy?: unknown}).proxy).toEqual({
			server: 'socks5://127.0.0.1:9050',
		});
		// No no-leak DNS arg, and (no extraLaunchArgs) => no args key at all.
		expect('args' in (options as object)).toBe(false);
	});

	it('proxyNoLeak:true forces the DNS arg even for a plain socks5:// URL', async () => {
		const {root} = await makeSetUpProfile('p3');
		const {transport, launchSpy} = launchSpyTransport(
			root,
			'socks5://host:1080',
			true,
		);
		await transport.open({mode: 'launch', profile: 'p3'});

		const [, options] = launchSpy.mock.calls[0]!;
		expect((options as {args?: string[]}).args).toContain(
			'--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE host',
		);
	});

	it('forwards proxy credentials to the Playwright proxy option', async () => {
		const {root} = await makeSetUpProfile('p4');
		const {transport, launchSpy} = launchSpyTransport(
			root,
			'socks5h://user:pass@host:1080',
		);
		await transport.open({mode: 'launch', profile: 'p4'});

		const [, options] = launchSpy.mock.calls[0]!;
		expect((options as {proxy?: unknown}).proxy).toEqual({
			server: 'socks5://host:1080',
			username: 'user',
			password: 'pass',
		});
	});

	it('rejects a malformed proxy with InvalidProxyError before launching', async () => {
		const {root} = await makeSetUpProfile('p5');
		const {transport, launchSpy} = launchSpyTransport(
			root,
			'http://not-socks:1080',
		);
		await expect(
			transport.open({mode: 'launch', profile: 'p5'}),
		).rejects.toBeInstanceOf(InvalidProxyError);
		// Never reached the browser launch.
		expect(launchSpy).not.toHaveBeenCalled();
	});
});
