import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {WebhandsCommand} from './verb-client.js';

const run = promisify(execFile);

/**
 * The `serve` LIFECYCLE OWNERSHIP (ADR-0005; spec user story 12).
 *
 * ADR-0005 made the session lifecycle EXPLICIT: a verb with no live `serve`
 * errors and never auto-spawns. So the harness must OWN bringing a `serve`
 * session up around an eval and tearing it down after. It does so by shelling
 * out to the SAME published `serve`/`stop` verbs (no back door), against an
 * ISOLATED `WEBHANDS_HOME` temp root (the endpoint file + profile live there,
 * never the real `~/.webhands`, ADR-0005 shared-write note), honoring the
 * existing `--proxy`/stealth launch options (ADR-0009).
 */

/** The endpoint file name `serve` writes under `WEBHANDS_HOME` (ADR-0005). */
const SESSION_ENDPOINT_FILENAME = 'session-endpoint.json';

/** Launch options the harness forwards to `serve` (the existing surface). */
export interface ServeLaunchOptions {
	/** The dedicated profile to launch against (warmed; defaults to `default`). */
	readonly profile?: string;
	/** Opt-in Patchright stealth launch (ADR-0009-adjacent stealth toggle). */
	readonly stealth?: boolean;
	/** Route all traffic + DNS through this SOCKS proxy URL (ADR-0009). */
	readonly proxy?: string;
	/** Drive a system browser instead of bundled Chromium. */
	readonly systemBrowser?: string;
	/** Show the browser window (default headless). */
	readonly headed?: boolean;
	/**
	 * Ask `serve` to expose the browser's CDP / remote-debugging endpoint
	 * (`--expose-cdp`), which is what gives the harness a SHARED DRIVING SURFACE:
	 * the Playwright-only baseline agent `connectOverCDP`-s to the harness's
	 * EXISTING page, so the end-state assertion reads the page the agent actually
	 * drove (finding
	 * `baseline-comparison-needs-a-shared-driving-surface-not-two-browsers`).
	 *
	 * Must be asked for explicitly: `serve` no longer opens a remote-debugging port
	 * by default (it is a code-execution surface on the logged-in page and an
	 * automation tell). The harness opts IN because the shared surface is its
	 * measurement mechanism and it runs against local fixtures on an isolated home.
	 */
	readonly exposeCdp?: boolean;
}

/** Config to start a harness-owned serve session. */
export interface StartServeOptions {
	/** How to invoke webhands (the same command the verb client uses). */
	readonly webhands: WebhandsCommand;
	/** The ISOLATED home root for this run (the endpoint/profile/screenshots dir). */
	readonly home: string;
	/** The `serve` launch options to forward. */
	readonly launch?: ServeLaunchOptions;
	/** How long to wait for the endpoint file to appear (ms). Default 60s. */
	readonly readyTimeoutMs?: number;
	/** Extra env merged into the serve process. */
	readonly env?: NodeJS.ProcessEnv;
}

/** A live, harness-owned serve session; `stop()` tears it down. */
export interface ServeSession {
	/** The endpoint URL `serve` advertised (client verbs discover this). */
	readonly url: string;
	/** The served process PID. */
	readonly pid: number;
	/**
	 * The Chromium CDP / remote-debugging endpoint of the served browser, present
	 * when `serve` exposed a SHARED driving surface (a LAUNCH session). A separate
	 * Playwright client `chromium.connectOverCDP(<cdpEndpoint>)`-s to it and drives
	 * the SAME live page this session holds, so the harness's end-state assertion
	 * reads the page the agent drove regardless of toolkit (finding
	 * `baseline-comparison-needs-a-shared-driving-surface-not-two-browsers`).
	 * `undefined` when no shared surface was advertised.
	 */
	readonly cdpEndpoint?: string;
	/** Tear the session down (runs `webhands stop`, then kills the process). */
	stop(): Promise<void>;
}

/** The shape of the endpoint file `serve` writes (ADR-0005). */
interface Endpoint {
	readonly url: string;
	readonly pid: number;
	/** The CDP endpoint `serve` advertised for the shared driving surface, if any. */
	readonly cdpEndpoint?: string;
}

/**
 * This harness requires a TCP serve, and says so the moment it is handed
 * something else (ADR-0017).
 *
 * It reads the endpoint file itself rather than importing `core`'s reader, to
 * stay decoupled from the package under test, which means it only understands
 * the `url` shape. A socket-shaped file would otherwise fall through the poll
 * loop below and be reported as "serve did not advertise an endpoint within
 * 60000ms", which is FALSE (serve is healthy) and sends the reader looking in
 * the wrong place. The harness pins `WEBHANDS_SOCKET` empty for its own child,
 * so reaching this means an endpoint file from something else.
 */
function assertTcpEndpoint(parsed: {socket?: unknown}, path: string): void {
	if (typeof parsed.socket === 'string' && parsed.socket !== '') {
		throw new Error(
			`the endpoint file ${path} advertises a UNIX SOCKET, but this eval ` +
				`harness drives the session over TCP (it reads the endpoint file ` +
				`itself and speaks only the url shape). A serve started by this ` +
				`harness pins WEBHANDS_SOCKET empty, so this file belongs to another ` +
				`session sharing this WEBHANDS_HOME: stop it, or give the harness its ` +
				`own home root.`,
		);
	}
}

/**
 * Start a harness-owned `serve` session against the ISOLATED home and return it
 * once the endpoint file appears. The harness spawns `webhands serve` as a
 * long-lived child (pinning `WEBHANDS_HOME`), polls for the endpoint file, and
 * returns a {@link ServeSession} whose `stop()` runs the published `stop` verb
 * and reaps the child. Forwards the existing `--profile`/`--proxy`/`--stealth`/
 * `--use-system-browser`/`--headed` flags untouched, plus `--expose-cdp` when the
 * caller asks for the shared driving surface.
 */
export async function startServe(
	opts: StartServeOptions,
): Promise<ServeSession> {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		...opts.env,
		WEBHANDS_HOME: opts.home,
		// PIN THE TRANSPORT TOO, for the same reason the home root is pinned.
		// `WEBHANDS_SOCKET` (ADR-0017) asks `serve` to listen on a unix socket, and
		// the operator running these evals may well have it exported: it is the
		// documented way to drive webhands from an account whose loopback is
		// filtered. Inherited here it would point the harness's own serve at the
		// user's socket path, which is OUTSIDE the isolated home we just pinned, so
		// the harness would take over the path their live session advertises. Empty
		// reads as unset, so this restores the TCP default for the child only.
		WEBHANDS_SOCKET: '',
	};
	const serveArgs = ['serve', ...serveFlags(opts.launch)];
	const child = spawn(
		opts.webhands.command,
		[...opts.webhands.args, ...serveArgs],
		{env, stdio: 'ignore'},
	);
	child.unref();

	const endpointPath = join(opts.home, SESSION_ENDPOINT_FILENAME);
	const deadline = Date.now() + (opts.readyTimeoutMs ?? 60_000);
	let endpoint: Endpoint | undefined;
	let lastChildExit: number | null = null;
	child.once('exit', (code) => {
		lastChildExit = code ?? -1;
	});
	while (Date.now() < deadline) {
		if (lastChildExit !== null) {
			throw new Error(
				`webhands serve exited early (code ${lastChildExit}) before advertising ` +
					`an endpoint; the session never came up.`,
			);
		}
		endpoint = await readEndpoint(endpointPath);
		if (endpoint !== undefined) break;
		await delay(200);
	}
	if (endpoint === undefined) {
		// Best-effort teardown of a hung child before failing.
		try {
			child.kill('SIGTERM');
		} catch {
			// already gone
		}
		throw new Error(
			`webhands serve did not advertise an endpoint within ` +
				`${opts.readyTimeoutMs ?? 60_000}ms (WEBHANDS_HOME=${opts.home}).`,
		);
	}

	const url = endpoint.url;
	const pid = endpoint.pid;
	const cdpEndpoint = endpoint.cdpEndpoint;
	let stopped = false;
	return {
		url,
		pid,
		...(cdpEndpoint !== undefined ? {cdpEndpoint} : {}),
		async stop(): Promise<void> {
			if (stopped) return;
			stopped = true;
			// Tear down via the PUBLISHED `stop` verb (closes the browser + clears
			// the endpoint file), against the SAME isolated home.
			try {
				await run(opts.webhands.command, [...opts.webhands.args, 'stop'], {
					env,
					timeout: 30_000,
				});
			} catch {
				// stop is best-effort; fall through to reaping the child.
			}
			try {
				child.kill('SIGTERM');
			} catch {
				// already gone
			}
		},
	};
}

/** Build the `serve` flag list from the forwarded launch options (existing surface). */
function serveFlags(launch: ServeLaunchOptions | undefined): string[] {
	const flags: string[] = [];
	if (launch === undefined) return flags;
	if (launch.profile !== undefined && launch.profile !== '') {
		flags.push('--profile', launch.profile);
	}
	if (launch.stealth === true) flags.push('--stealth');
	if (launch.proxy !== undefined && launch.proxy !== '') {
		flags.push('--proxy', launch.proxy);
	}
	if (launch.systemBrowser !== undefined && launch.systemBrowser !== '') {
		flags.push('--use-system-browser', launch.systemBrowser);
	}
	if (launch.headed === true) flags.push('--headed');
	// Opt-in shared driving surface: without this flag `serve` advertises no
	// cdpEndpoint, and the Playwright-baseline leg has no page to attach to.
	if (launch.exposeCdp === true) flags.push('--expose-cdp');
	return flags;
}

/** Read + parse the endpoint file, or `undefined` if absent/partial. */
async function readEndpoint(path: string): Promise<Endpoint | undefined> {
	let text: string;
	try {
		text = await readFile(path, 'utf8');
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(text) as Partial<Endpoint> & {socket?: unknown};
		// A socket-shaped file is a LOUD failure, not a "not ready yet": polling
		// for it would burn the whole ready timeout and then lie about the cause.
		assertTcpEndpoint(parsed, path);
		if (
			typeof parsed.url === 'string' &&
			parsed.url !== '' &&
			typeof parsed.pid === 'number'
		) {
			return {
				url: parsed.url,
				pid: parsed.pid,
				...(typeof parsed.cdpEndpoint === 'string' && parsed.cdpEndpoint !== ''
					? {cdpEndpoint: parsed.cdpEndpoint}
					: {}),
			};
		}
	} catch (cause) {
		// A partial write is "not ready yet"; the socket-shaped refusal above is a
		// real verdict and must not be swallowed with it.
		if (cause instanceof Error && cause.message.includes('UNIX SOCKET')) {
			throw cause;
		}
	}
	return undefined;
}

/** A small promise delay. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
