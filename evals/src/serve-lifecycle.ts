import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {WebhandsCommand} from './verb-client.js';

const run = promisify(execFile);

/**
 * The `serve` LIFECYCLE OWNERSHIP (ADR-0005; prd user story 12).
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
 * Start a harness-owned `serve` session against the ISOLATED home and return it
 * once the endpoint file appears. The harness spawns `webhands serve` as a
 * long-lived child (pinning `WEBHANDS_HOME`), polls for the endpoint file, and
 * returns a {@link ServeSession} whose `stop()` runs the published `stop` verb
 * and reaps the child. Forwards the existing `--profile`/`--proxy`/`--stealth`/
 * `--use-system-browser`/`--headed` flags untouched (no new option).
 */
export async function startServe(
	opts: StartServeOptions,
): Promise<ServeSession> {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		...opts.env,
		WEBHANDS_HOME: opts.home,
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
		const parsed = JSON.parse(text) as Partial<Endpoint>;
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
	} catch {
		// partial write; treat as not-yet-ready
	}
	return undefined;
}

/** A small promise delay. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
