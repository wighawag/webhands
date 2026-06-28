import {InvalidProxyError} from './errors.js';

/**
 * A parsed SOCKS proxy ready to hand to Playwright/Chromium.
 *
 * This is the SINGLE place webhands turns a user-facing `--proxy` SOCKS URL into
 * the concrete launch inputs Chromium needs: the `proxy.server`/credentials
 * Playwright forwards, plus the extra command-line arg that forces DNS through
 * the proxy (no DNS leak). Keeping the brittle parsing + Chromium-flag knowledge
 * in one module mirrors how the launch transport confines its other
 * Playwright/Chromium details.
 */
export interface ParsedSocksProxy {
	/**
	 * The Playwright `proxy.server` value, always normalized to `socks5://host:port`.
	 *
	 * Chromium's `--proxy-server` understands `socks5://` but NOT the `socks5h://`
	 * convention, so we normalize the scheme here and carry the "resolve DNS at
	 * the proxy / block local DNS" intent separately in {@link noLeak} instead of
	 * in the scheme string.
	 */
	readonly server: string;
	/** Optional proxy username (from a `user:pass@` userinfo component). */
	readonly username?: string;
	/** Optional proxy password (from a `user:pass@` userinfo component). */
	readonly password?: string;
	/** The proxy host, used to build the DNS catch-all EXCLUDE rule. */
	readonly host: string;
	/**
	 * Whether to enforce NO local DNS (force every hostname to resolve at the
	 * proxy). When `true`, the transport adds a `--host-resolver-rules` catch-all
	 * so even Chromium components that bypass `--proxy-server` (DNS prefetcher,
	 * etc.) cannot leak a raw DNS query (see {@link hostResolverRulesArg}).
	 */
	readonly noLeak: boolean;
}

/**
 * The SOCKS schemes we accept on a `--proxy` value.
 *
 * - `socks5h://` is the widely-used convention meaning "resolve DNS at the
 *   proxy" (no local DNS, no leak). We map it to {@link ParsedSocksProxy.noLeak}
 *   `true`.
 * - `socks5://` means "SOCKS5, local DNS allowed" by the same convention. NOTE:
 *   Chromium ALREADY resolves URL hostnames at the proxy under `--proxy-server`,
 *   but other components (the DNS prefetcher) can still issue raw local DNS, so
 *   plain `socks5://` does NOT by itself guarantee no leak.
 *
 * `socks://` is accepted as an alias for `socks5://` (some tools emit it).
 */
const SCHEME_NO_LEAK: Readonly<Record<string, boolean>> = {
	'socks5h:': true,
	'socks5:': false,
	'socks:': false,
};

/**
 * Parse a user-facing `--proxy` SOCKS URL into a {@link ParsedSocksProxy}.
 *
 * Accepts `socks5h://`, `socks5://`, or `socks://` with a host and port and an
 * optional `user:pass@` userinfo. Anything else (missing host/port, an http(s)
 * proxy, a bare host with no scheme) is a typed {@link InvalidProxyError} so the
 * caller refuses LOUDLY rather than launching unproxied.
 *
 * `forceNoLeak`, when set, overrides the scheme's implied DNS behaviour: pass
 * `true` to enforce no local DNS even for a plain `socks5://` URL, or `false` to
 * allow local DNS even for `socks5h://`. When omitted, the SCHEME decides
 * (`socks5h` => no-leak, `socks5`/`socks` => local DNS allowed).
 */
export function parseSocksProxy(
	value: string,
	forceNoLeak?: boolean,
): ParsedSocksProxy {
	const trimmed = value.trim();
	if (trimmed === '') {
		throw new InvalidProxyError(value);
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch (cause) {
		throw new InvalidProxyError(value, undefined, {cause});
	}

	const schemeNoLeak = SCHEME_NO_LEAK[url.protocol];
	if (schemeNoLeak === undefined) {
		// Not a SOCKS scheme (e.g. http://, https://, socks4://, or no scheme).
		throw new InvalidProxyError(value);
	}
	if (url.hostname === '' || url.port === '') {
		// A host AND an explicit port are both required: Chromium's --proxy-server
		// needs the port, and we will not guess a default.
		throw new InvalidProxyError(value);
	}

	const noLeak = forceNoLeak ?? schemeNoLeak;
	const server = `socks5://${url.hostname}:${url.port}`;

	const proxy: ParsedSocksProxy = {
		server,
		host: url.hostname,
		noLeak,
		...(url.username !== ''
			? {username: decodeURIComponent(url.username)}
			: {}),
		...(url.password !== ''
			? {password: decodeURIComponent(url.password)}
			: {}),
	};
	return proxy;
}

/**
 * Build the Chromium `--host-resolver-rules` argument that prevents ANY local
 * DNS resolution, the catch-all the Chromium SOCKS design doc prescribes for a
 * leak-free SOCKS proxy.
 *
 * `MAP * ~NOTFOUND` maps every hostname to an invalid address so Chromium never
 * issues a real local DNS query; `EXCLUDE <host>` lets Chromium still resolve
 * the proxy server's own address (otherwise every request fails with
 * PROXY_CONNECTION_FAILED). URL loads themselves resolve at the proxy via
 * `--proxy-server`; this arg closes the side channels (DNS prefetcher, etc.).
 */
export function hostResolverRulesArg(host: string): string {
	return `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE ${host}`;
}
