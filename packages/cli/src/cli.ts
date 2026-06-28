import {Cli, z} from 'incur';
import {
	buildPrompt,
	resolveProfileLocation,
	serializeCookies,
	deserializeCookies,
	locator,
	PlaywrightAttachTransport,
	PlaywrightLaunchTransport,
	readSessionEndpoint,
	clearSessionEndpoint,
	SessionAlreadyActiveError,
	startSessionServer,
	type Cookie,
	type MouseInput,
	type OpenTarget,
	type RunningSessionServer,
	type ScreenshotOptions,
	type ScreenshotScope,
	type ScrollTarget,
	type SelectChoice,
	type Session,
	type SessionServerOptions,
	type Transport,
	type WaitCondition,
} from '@webhands/core';
import {readFile, writeFile} from 'node:fs/promises';
import {mapControllerError} from './errors.js';
import {
	createDefaultSessionProvider,
	type SessionProvider,
} from './session-provider.js';
import {setupProfile} from '@webhands/core';
import {VERSION} from './version.js';

/**
 * The CLI binary name. Used both as the `incur` CLI name and (echoed back from
 * `c.name`) inside every fix-command message, so a suggested command always
 * matches how the user invoked the tool.
 */
export const CLI_NAME = 'webhands';

const DESCRIPTION =
	'Drive a real, logged-in browser (launch or attach) and run page verbs ' +
	'(goto, snapshot, click, type, eval, wait, cookies) with structured output.';

/**
 * The default profile name a page verb / launch / setup-profile targets when
 * the user does not name one. A single, predictable default keeps the common
 * case a one-word command; a user with several sessions passes `--profile`.
 */
export const DEFAULT_PROFILE = 'default';

/** Injectable dependencies, so CLI-level tests exercise the WIRING with no real browser. */
export interface CliDeps {
	/**
	 * How a verb command obtains a live session. Defaults to the v1 Playwright
	 * provider; tests inject a stub-backed (or throwing) provider to assert the
	 * envelope/cta/manifest and the typed-error fix messages without a browser.
	 * See {@link SessionProvider}.
	 */
	readonly sessionProvider?: SessionProvider;
	/**
	 * The `setup-profile` orchestration (defaults to `core`'s `setupProfile`).
	 * Injectable so the `setup-profile` command's wiring is testable headlessly.
	 */
	readonly setupProfile?: typeof setupProfile;
	/** Overrides for the controller home root (tests pass a temp dir). */
	readonly home?: {root?: string; env?: NodeJS.ProcessEnv};
	/**
	 * How the `serve` command brings up the single long-lived session (ADR-0005).
	 * Defaults to {@link startSessionServer} bound to the v1 Playwright transports;
	 * injectable so `serve`/`stop` wiring is testable with a stub transport and no
	 * real browser, and so a test can drive the server lifecycle deterministically.
	 */
	readonly serveSession?: ServeSession;
	/**
	 * The version string reported by `--version`, the help header, and the MCP
	 * server. Defaults to {@link VERSION} (this package's `package.json` version);
	 * injectable so a test can assert the wiring deterministically.
	 */
	readonly version?: string;
}

/**
 * The `serve`-command seam: bring up the ONE long-lived session for a target and
 * return the running server (its advertised endpoint + an explicit `stop`). The
 * default wraps `core`'s {@link startSessionServer} with the v1 Playwright
 * transports; tests inject a stub-backed one.
 */
export type ServeSession = (
	target: OpenTarget,
	options: {root?: string; env?: NodeJS.ProcessEnv},
	launchPolicy?: LaunchPolicy,
) => Promise<RunningSessionServer>;

/**
 * Transport-construction policy for a LAUNCH-mode open: the opt-in stealth
 * toggle and the optional system browser to drive. Kept SEPARATE from
 * {@link OpenTarget} so the seam stays free of Playwright/CDP/stealth concepts
 * (ADR-0003); it rides alongside the target into the transport constructor only.
 * Ignored for attach (the user's own browser is reused as-is).
 */
export interface LaunchPolicy {
	/** Opt-in Patchright-backed stealth launch. Default off. */
	readonly stealth?: boolean;
	/**
	 * Drive a browser already installed on the system (e.g. `'chrome'`) instead
	 * of the bundled Chromium. Omit for bundled Chromium.
	 */
	readonly systemBrowser?: string;
	/**
	 * Don't impose a fixed emulated viewport (Playwright's `viewport: null`): let
	 * the real window drive its own size, a hardening tweak Patchright recommends
	 * for its stealth recipe. When omitted, `core` leaves Playwright's default in
	 * place EXCEPT under stealth, where it defaults the no-viewport on. Set `false`
	 * to keep the fixed viewport even under stealth.
	 */
	readonly noViewport?: boolean;
	/**
	 * Route ALL traffic and DNS through one SOCKS proxy, as a SOCKS URL
	 * (`socks5h://host:1080` or `socks5://user:pass@host:1080`). `socks5h` tunnels
	 * DNS too (no leak); `socks5` allows local DNS. Omit for a direct connection.
	 */
	readonly proxy?: string;
}

// --- shared schema fragments ----------------------------------------------

/**
 * Connection options shared by the page verbs and `serve`: WHICH browser the
 * single session targets. In the ADR-0005 model the `serve` command consumes
 * these to bring the ONE long-lived session up (launch a profile, or attach to
 * an endpoint); the page VERBS are thin clients that drive whatever session is
 * already live, so for them these options are vestigial selectors of the launch
 * mode only when `serve` reads them. They live here as ONE shared fragment so
 * `serve` and the verbs describe the open the same way.
 */
const connectionOptions = z.object({
	profile: z
		.string()
		.default(DEFAULT_PROFILE)
		.describe('Dedicated profile to launch against (launch mode).'),
	endpoint: z
		.string()
		.optional()
		.describe(
			'Remote-debugging endpoint of a browser you already started ' +
				'(attach mode, Chromium-only). When set, attach is used instead of launch.',
		),
});

/** Resolve the {@link OpenTarget} for a page verb from its connection options. */
function targetFrom(options: {profile: string; endpoint?: string}): OpenTarget {
	if (options.endpoint !== undefined && options.endpoint !== '') {
		return {mode: 'attach', endpoint: options.endpoint};
	}
	return {mode: 'launch', profile: options.profile};
}

/**
 * Stealth launch options shared by `serve` and `launch`. Opt-in and default
 * OFF: vanilla Playwright stays the default. These are CONSUMED when the single
 * session is brought up (the `serve` path actually builds the transport with
 * them, ADR-0005); see the work/ observation
 * `launch-command-connection-options-vestigial-vs-serve`.
 */
const stealthOptions = z.object({
	stealth: z
		.boolean()
		.default(false)
		.describe(
			'Launch via the optional Patchright fork to evade the CDP automation ' +
				'tell (requires `pnpm add patchright`). Default: off (vanilla Playwright).',
		),
	'use-system-browser': z
		.string()
		.optional()
		.describe(
			"Drive a browser already installed on the system (e.g. 'chrome', " +
				"'msedge') instead of the bundled Chromium.",
		),
	proxy: z
		.string()
		.optional()
		.describe(
			'Route ALL traffic and DNS through a SOCKS proxy. Give a SOCKS URL: ' +
				'socks5h://host:1080 tunnels DNS through the proxy too (no leak), ' +
				'socks5://host:1080 allows local DNS. A user:pass@ prefix is allowed.',
		),
	// Modelled as a `viewport` boolean so incur's `--no-<flag>` negation gives the
	// task-mandated `--no-viewport`: passing `--no-viewport` sets `viewport=false`
	// (i.e. noViewport=true). Absent => undefined => core decides the default
	// (no-viewport defaults ON under --stealth). Pass `--viewport` to force the
	// fixed emulated viewport even under stealth.
	viewport: z
		.boolean()
		.optional()
		.describe(
			'Emulate a fixed viewport. Use --no-viewport to let the real browser ' +
				'window drive its own size (a hardening tweak Patchright recommends). ' +
				'When unset, --no-viewport behaviour defaults ON under --stealth. ' +
				'Reduces but does not eliminate detection.',
		),
});

/** Resolve the {@link LaunchPolicy} from the shared stealth option fields. */
function launchPolicyFrom(options: {
	stealth?: boolean;
	'use-system-browser'?: string;
	viewport?: boolean;
	proxy?: string;
}): LaunchPolicy {
	return {
		stealth: options.stealth === true,
		systemBrowser:
			options['use-system-browser'] !== undefined &&
			options['use-system-browser'] !== ''
				? options['use-system-browser']
				: undefined,
		// Tri-state: `viewport` undefined leaves core's (stealth-driven) default;
		// `--no-viewport` (viewport=false) => noViewport:true; `--viewport` => false.
		// Only forward when the flag was given.
		...(options.viewport !== undefined ? {noViewport: !options.viewport} : {}),
		// Only forward --proxy when given, so the policy object stays minimal (the
		// `serve` wiring tests assert it by exact shape).
		...(options.proxy !== undefined && options.proxy !== ''
			? {proxy: options.proxy}
			: {}),
	};
}

/** The structured output schema shared by verbs that act on a page but return no data. */
const actionOutput = z.object({
	ok: z.literal(true).describe('The verb completed.'),
	verb: z.string().describe('The verb that ran.'),
});

// --- cta wording (one source of truth) ------------------------------------

/**
 * Call-to-action hints suggesting likely NEXT verbs after a run (PRD story 13),
 * so an agent can chain navigate -> snapshot -> click without extra prompting.
 * The chain mirrors how a human reads then acts on a page: after navigating or
 * waiting you SNAPSHOT to see the page; after a snapshot you CLICK/TYPE/EVAL;
 * after acting you snapshot again to observe the effect. Kept in one map so the
 * suggested chain is consistent across commands.
 */
function nextSnapshot() {
	return {
		command: 'snapshot',
		description:
			'Read the page (accessibility tree + text) to decide what to do next.',
	};
}
function nextAct() {
	return [
		{
			command: 'click',
			description: 'Click an element addressed by a Playwright locator string.',
		},
		{
			command: 'type',
			description:
				'Type into an element addressed by a Playwright locator string.',
		},
		{
			command: 'query',
			description:
				'Read structured data (attrs/props/visibility) out of matched elements.',
		},
		{
			command: 'eval',
			description: 'Run JavaScript in the page as an escape hatch.',
		},
	];
}

// --- session helper --------------------------------------------------------

/**
 * Open a session, run `fn` against its page, and ALWAYS close the session.
 * Centralises the open/close lifecycle so every verb command is just its verb
 * body, and a typed `core` open error (missing binary / missing profile)
 * propagates to the command's catch for mapping.
 */
async function withSession<T>(
	provider: SessionProvider,
	target: OpenTarget,
	fn: (session: Session) => Promise<T>,
): Promise<T> {
	const session = await provider.call(undefined, target);
	try {
		return await fn(session);
	} finally {
		await session.close();
	}
}

/**
 * Build the `incur` CLI that wraps `core`'s verb surface (PRD Implementation
 * Decisions — `cli`; stories 12-14, 17).
 *
 * Because it is built on `incur`, the SAME binary is also an MCP server
 * (`--mcp` / `mcp add`) and emits a skills / `--llms` manifest with NO bespoke
 * MCP code: those come from incur for free. Each command declares zod
 * `args`/`options`/`output` schemas (so input is validated and output has a
 * known shape), returns the structured TOON/JSON envelope, and attaches `cta`
 * next-verb hints. Typed `core` errors (missing binary / missing profile) are
 * mapped to the user-facing message + exact fix command via
 * {@link mapControllerError}.
 *
 * Returns the built `Cli` WITHOUT calling `.serve()`, so a test can drive it via
 * `serve(argv, {stdout, exit})` or `cli.fetch(req)` and the bin entry owns the
 * real `.serve()`.
 */
export function createCli(deps: CliDeps = {}) {
	const binary = CLI_NAME;
	const provider =
		deps.sessionProvider ?? createDefaultSessionProvider(deps.home ?? {});
	const runSetupProfile = deps.setupProfile ?? setupProfile;
	const serveSession = deps.serveSession ?? defaultServeSession;
	const home = deps.home ?? {};

	const cli = Cli.create(binary, {
		description: DESCRIPTION,
		version: deps.version ?? VERSION,
		// `outputPolicy: 'all'` (the default) — humans and agents both see output.
	});

	// --- mode commands: setup-profile / launch / attach --------------------

	cli.command('setup-profile', {
		description:
			'Open the dedicated profile HEADED so you log in / clear a challenge ONCE; ' +
			'later launch --headless reuses the saved session.',
		options: z.object({
			profile: z
				.string()
				.default(DEFAULT_PROFILE)
				.describe('Name of the dedicated profile to set up.'),
		}),
		output: z.object({
			profile: z.string().describe('The profile that was set up.'),
			profileDir: z
				.string()
				.describe('Its dedicated user-data directory on disk.'),
		}),
		async run(c) {
			try {
				const {session, location} = await runSetupProfile({
					profile: c.options.profile,
					...(deps.home ?? {}),
				});
				// `setup-profile` HOLDS the headed window open for the human's login:
				// block until the user closes the browser (or it otherwise ends),
				// THEN report success. (Earlier this closed the session immediately,
				// so the window opened and vanished in the same tick.) On close the
				// persistent context has flushed the new state to the profile dir, so
				// the profile is set up and `launch` is the right next step.
				await session.waitForClose();
				return c.ok(
					{profile: location.profile, profileDir: location.profileDir},
					{
						cta: {
							commands: [
								{
									command: 'launch',
									options: {profile: location.profile},
									description:
										'Launch this profile headless now that it is set up.',
								},
							],
						},
					},
				);
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('launch', {
		description:
			'Launch a browser the controller spawns (headed or headless) against the dedicated profile.',
		options: z.object({
			profile: z
				.string()
				.default(DEFAULT_PROFILE)
				.describe('Dedicated profile to launch against.'),
			headed: z
				.boolean()
				.default(false)
				.describe('Show the browser window (default: headless).'),
			...stealthOptions.shape,
		}),
		output: z.object({
			mode: z.literal('launch'),
			profile: z.string(),
			headed: z.boolean(),
			stealth: z.boolean(),
			systemBrowser: z.string().optional(),
			noViewport: z.boolean().optional(),
			proxy: z.string().optional(),
		}),
		async run(c) {
			try {
				const policy = launchPolicyFrom(c.options);
				return await withSession(
					provider,
					{
						mode: 'launch',
						profile: c.options.profile,
						headed: c.options.headed,
					},
					async () =>
						c.ok(
							{
								mode: 'launch' as const,
								profile: c.options.profile,
								headed: c.options.headed,
								stealth: policy.stealth === true,
								...(policy.systemBrowser !== undefined
									? {systemBrowser: policy.systemBrowser}
									: {}),
								...(policy.noViewport !== undefined
									? {noViewport: policy.noViewport}
									: {}),
								...(policy.proxy !== undefined ? {proxy: policy.proxy} : {}),
							},
							{
								cta: {
									commands: [
										{
											command: 'goto',
											description: 'Navigate the launched page to a URL.',
										},
										nextSnapshot(),
									],
								},
							},
						),
				);
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	// --- lifecycle: serve / stop (ADR-0005, cross-invocation persistence) ----

	cli.command('serve', {
		description:
			'Start the long-lived session server: launch (or attach) the ONE browser ' +
			'and keep it alive so later verb invocations drive the SAME live page. ' +
			'Runs until stopped (Ctrl-C or `stop`).',
		options: connectionOptions.extend({
			headed: z
				.boolean()
				.default(false)
				.describe('Show the browser window (default: headless).'),
			...stealthOptions.shape,
		}),
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('serve'),
			url: z.string().describe('The endpoint client verbs discover and call.'),
			pid: z
				.number()
				.describe('The served process PID (for `stop` / signals).'),
		}),
		async run(c) {
			try {
				// Single session in v1: refuse to bring up a second while one is live.
				const existing = await readSessionEndpoint(home);
				if (existing !== undefined) {
					throw new SessionAlreadyActiveError();
				}
				const target: OpenTarget =
					c.options.endpoint !== undefined && c.options.endpoint !== ''
						? {mode: 'attach', endpoint: c.options.endpoint}
						: {
								mode: 'launch',
								profile: c.options.profile,
								headed: c.options.headed,
							};
				const server = await serveSession(
					target,
					home,
					launchPolicyFrom(c.options),
				);
				// Explicit teardown on signal: closing the browser + clearing the
				// endpoint file is the server's `stop`. We DO NOT auto-spawn and we DO
				// NOT auto-teardown on anything but an explicit stop/signal (ADR-0005).
				const onSignal = () => {
					void server.stop().finally(() => process.exit(0));
				};
				process.once('SIGINT', onSignal);
				process.once('SIGTERM', onSignal);
				return c.ok(
					{
						ok: true as const,
						verb: 'serve' as const,
						url: server.endpoint.url,
						pid: server.endpoint.pid,
					},
					{
						cta: {
							commands: [
								{
									command: 'goto',
									description:
										'Navigate the served live page (from a separate invocation).',
								},
								{
									command: 'stop',
									description: 'Tear the served session down.',
								},
							],
						},
					},
				);
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('stop', {
		description:
			'Tear down the long-lived session server: close the browser and stop serving.',
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('stop'),
			stopped: z
				.boolean()
				.describe('Whether a live server was found and signalled to stop.'),
		}),
		async run(c) {
			try {
				const endpoint = await readSessionEndpoint(home);
				if (endpoint === undefined) {
					// Nothing to stop: report it plainly rather than error. Idempotent
					// teardown is friendlier than a failure on a second `stop`.
					return c.ok({
						ok: true as const,
						verb: 'stop' as const,
						stopped: false,
					});
				}
				// The served session lives in a SEPARATE process; signal it to run its
				// own clean teardown (close browser + clear endpoint file). Then clear
				// the endpoint file here too so discovery reflects the stop even if the
				// process was already gone (stale endpoint).
				try {
					process.kill(endpoint.pid, 'SIGTERM');
				} catch {
					// The process is already gone; clearing the file below suffices.
				}
				await clearSessionEndpoint(home);
				return c.ok({
					ok: true as const,
					verb: 'stop' as const,
					stopped: true,
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('attach', {
		description:
			'Attach to a browser you already started with remote debugging (Chromium-only), reusing live tabs.',
		options: z.object({
			endpoint: z
				.string()
				.describe(
					'Remote-debugging endpoint of the running browser (e.g. http://127.0.0.1:9222).',
				),
		}),
		output: z.object({
			mode: z.literal('attach'),
			endpoint: z.string(),
		}),
		async run(c) {
			try {
				return await withSession(
					provider,
					{mode: 'attach', endpoint: c.options.endpoint},
					async () =>
						c.ok(
							{mode: 'attach' as const, endpoint: c.options.endpoint},
							{
								cta: {
									commands: [
										{
											command: 'goto',
											description: 'Navigate the attached page to a URL.',
										},
										nextSnapshot(),
									],
								},
							},
						),
				);
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	// --- page verbs --------------------------------------------------------

	cli.command('goto', {
		description: 'Navigate the active page to a URL and let it settle.',
		args: z.object({url: z.string().describe('The URL to navigate to.')}),
		options: connectionOptions,
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('goto'),
			url: z.string().describe('The URL that was navigated to.'),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.navigate(c.args.url);
					return c.ok(
						{ok: true as const, verb: 'goto' as const, url: c.args.url},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('snapshot', {
		description:
			'Return a token-cheap structured view of the page (accessibility tree + text, or --full raw DOM).',
		options: connectionOptions.extend({
			full: z
				.boolean()
				.default(false)
				.describe('Return the raw DOM instead of the accessibility view.'),
		}),
		output: z.object({
			url: z.string().describe('The page URL at snapshot time.'),
			view: z
				.enum(['accessibility', 'full'])
				.describe('Which view this snapshot carries.'),
			content: z
				.string()
				.describe('The structured, agent-readable page content.'),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const snap = await s.page.snapshot({full: c.options.full});
					return c.ok(snap, {cta: {commands: nextAct()}});
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('click', {
		description:
			'Click the element addressed by a raw Playwright locator string.',
		args: z.object({
			locator: z
				.string()
				.describe(
					"A raw Playwright locator expression, e.g. getByRole('button', { name: 'Search' }). " +
						'With --by-ref, a durable `ref` from `query --with-refs` instead.',
				),
		}),
		options: connectionOptions.extend({
			'by-ref': z
				.boolean()
				.default(false)
				.describe(
					'Treat the argument as a durable `ref` from `query --with-refs`: ' +
						'resolve it but fail LOUD (stale-ref) if it now matches zero or more ' +
						'than one element, instead of silently clicking the wrong one.',
				),
		}),
		output: actionOutput.extend({verb: z.literal('click')}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.click(
						locator(c.args.locator),
						c.options['by-ref'] ? {byRef: true} : undefined,
					);
					return c.ok(
						{ok: true as const, verb: 'click' as const},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('type', {
		description:
			'Type text into the element addressed by a raw Playwright locator string.',
		args: z.object({
			locator: z
				.string()
				.describe(
					'A raw Playwright locator expression for the target input. ' +
						'With --by-ref, a durable `ref` from `query --with-refs` instead.',
				),
			text: z.string().describe('The text to type into the element.'),
		}),
		options: connectionOptions.extend({
			'by-ref': z
				.boolean()
				.default(false)
				.describe(
					'Treat the locator argument as a durable `ref` from `query --with-refs`: ' +
						'resolve it but fail LOUD (stale-ref) if it now matches zero or more ' +
						'than one element, instead of silently typing into the wrong one.',
				),
		}),
		output: actionOutput.extend({verb: z.literal('type')}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.type(
						locator(c.args.locator),
						c.args.text,
						c.options['by-ref'] ? {byRef: true} : undefined,
					);
					return c.ok(
						{ok: true as const, verb: 'type' as const},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('eval', {
		description:
			'Run a JavaScript EXPRESSION in the active page and return its serializable result.',
		args: z.object({
			expression: z
				.string()
				.describe(
					'A JS expression evaluated in the page context (e.g. document.title).',
				),
		}),
		// The ONE `--frame` flag on the surface (R1): `eval` runs page-world JS and
		// cannot carry a `frameLocator(...)` the way locator-taking verbs do, so it
		// gets an explicit SAME-ORIGIN frame selector. Omitted == top-document eval.
		options: connectionOptions.extend({
			frame: z
				.string()
				.optional()
				.describe(
					'Evaluate inside the named SAME-ORIGIN child frame instead of the top ' +
						"document: a CSS selector for the iframe element (e.g. '#main-iframe'). " +
						'A cross-origin frame is unreachable and fails loud.',
				),
		}),
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('eval'),
			result: z
				.unknown()
				.describe('The expression result, structurally cloned by value.'),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const result = await s.page.eval(
						c.args.expression,
						c.options.frame !== undefined
							? {frame: c.options.frame}
							: undefined,
					);
					return c.ok(
						{ok: true as const, verb: 'eval' as const, result},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	// --- Tier-1 read verbs: query + state shorthands (prd broaden-agent-verb-
	// surface, R2/R5). Each is its own incur command, so one definition yields
	// both the CLI command and the MCP tool. List flags (--attr/--prop/--pw) are
	// REPEATABLE, not comma-joined (R5): incur arrays collect each occurrence.
	// There is NO --frame flag (frame scope rides IN the locator string, R1).

	cli.command('query', {
		description:
			'Read structured data out of the element(s) a Playwright locator matches: ' +
			'one row per match carrying exactly the requested DOM attributes (--attr), ' +
			'live JS properties (--prop), and Playwright extras (--pw visible|bbox).',
		args: z.object({
			locator: z
				.string()
				.describe(
					'A raw Playwright locator expression addressing the element(s) to read. ' +
						"Frame scope rides in the string, e.g. frameLocator('#f').locator('#x').",
				),
		}),
		options: connectionOptions.extend({
			attr: z
				.array(z.string())
				.default([])
				.describe(
					'A DOM ATTRIBUTE to read (getAttribute), e.g. href. Repeatable.',
				),
			prop: z
				.array(z.string())
				.default([])
				.describe(
					'A live JS PROPERTY to read (el[name]), e.g. innerText. Repeatable.',
				),
			pw: z
				.array(z.enum(['visible', 'bbox']))
				.default([])
				.describe(
					'A Playwright extra to include: visible (actionability-grade) or ' +
						'bbox (viewport-pixel box). Repeatable.',
				),
			limit: z.coerce
				.number()
				.optional()
				.describe('Bound the number of rows returned.'),
			'with-refs': z
				.boolean()
				.default(false)
				.describe(
					'Also return a durable `ref` per row — a locator handle you feed back ' +
						'to `click`/`type` --by-ref to act on THAT element even after the ' +
						'list mutates (fixes the .nth() index-drift footgun). Reuses a ' +
						'stable unique attribute (id/data-testid/…) when present, mints ' +
						'a namespaced data-webhands-ref only as a fallback. Off by default: ' +
						'the default query is a pure read and mutates nothing.',
				),
		}),
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('query'),
			rows: z
				.array(
					z.object({
						attrs: z.record(z.string(), z.string().nullable()).optional(),
						props: z.record(z.string(), z.unknown()).optional(),
						pw: z
							.object({
								visible: z.boolean().optional(),
								bbox: z
									.object({
										x: z.number(),
										y: z.number(),
										width: z.number(),
										height: z.number(),
									})
									.nullable()
									.optional(),
							})
							.optional(),
						ref: z
							.string()
							.optional()
							.describe(
								'A durable locator handle for this element (only with --with-refs); ' +
									'pass it to click/type --by-ref to act on it later.',
							),
					}),
				)
				.describe(
					'One row per matched element, each carrying the asked fields.',
				),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const rows = await s.page.query(locator(c.args.locator), {
						attrs: c.options.attr,
						props: c.options.prop,
						pw: c.options.pw,
						...(c.options.limit !== undefined ? {limit: c.options.limit} : {}),
						...(c.options['with-refs'] ? {refs: true} : {}),
					});
					return c.ok(
						{ok: true as const, verb: 'query' as const, rows},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('count', {
		description:
			'Count how many elements a Playwright locator matches (a match-set size).',
		args: z.object({
			locator: z.string().describe('A raw Playwright locator expression.'),
		}),
		options: connectionOptions,
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('count'),
			count: z.number().describe('How many elements matched.'),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const count = await s.page.count(locator(c.args.locator));
					return c.ok(
						{ok: true as const, verb: 'count' as const, count},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('exists', {
		description:
			'Whether a Playwright locator matches at least one element (count > 0).',
		args: z.object({
			locator: z.string().describe('A raw Playwright locator expression.'),
		}),
		options: connectionOptions,
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('exists'),
			exists: z.boolean().describe('Whether any element matched.'),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const exists = await s.page.exists(locator(c.args.locator));
					return c.ok(
						{ok: true as const, verb: 'exists' as const, exists},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('is-visible', {
		description:
			'Whether the first match is actionability-grade visible (a present-but-hidden ' +
			'element reads false).',
		args: z.object({
			locator: z.string().describe('A raw Playwright locator expression.'),
		}),
		options: connectionOptions,
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('isVisible'),
			visible: z.boolean().describe("The first match's visibility."),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const visible = await s.page.isVisible(locator(c.args.locator));
					return c.ok(
						{ok: true as const, verb: 'isVisible' as const, visible},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('get-attribute', {
		description:
			'Read a single DOM attribute off the first match (null if absent or no match).',
		args: z.object({
			locator: z.string().describe('A raw Playwright locator expression.'),
		}),
		options: connectionOptions.extend({
			name: z
				.string()
				.describe('The DOM attribute name to read (e.g. href, data-sitekey).'),
		}),
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('getAttribute'),
			name: z.string().describe('The attribute that was read.'),
			value: z
				.string()
				.nullable()
				.describe('The attribute value, or null if absent / no match.'),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const value = await s.page.getAttribute(
						locator(c.args.locator),
						c.options.name,
					);
					return c.ok(
						{
							ok: true as const,
							verb: 'getAttribute' as const,
							name: c.options.name,
							value,
						},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	// --- Tier-2 rich input verbs: press / hover / select / scroll / drag (prd
	// broaden-agent-verb-surface, stories 8-12, R5). Each is its own incur
	// command, so one definition yields both the CLI command and the MCP tool.
	// Positional-arg + small-flag, mirroring `click` (R5); `select`/`scroll` use
	// loud "exactly one of" validation, mirroring `wait`. No --frame flag: frame
	// scope rides IN the locator string (R1).

	cli.command('press', {
		description:
			'Press a keyboard key or chord (e.g. Enter, ArrowLeft, w, Control+A) at a ' +
			'locator or, with no locator, the focused element.',
		args: z.object({
			key: z
				.string()
				.describe(
					'A key or chord in Playwright grammar: a key name (Enter, ArrowLeft, ' +
						'a) or Modifier+Key (Control+A, Shift+Tab).',
				),
		}),
		options: connectionOptions.extend({
			locator: z
				.string()
				.optional()
				.describe(
					'A raw Playwright locator expression to press the key at (focuses it ' +
						'first). Omit to press at the focused element.',
				),
		}),
		output: actionOutput.extend({verb: z.literal('press')}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const target =
						c.options.locator !== undefined && c.options.locator !== ''
							? locator(c.options.locator)
							: undefined;
					await s.page.press(c.args.key, target);
					return c.ok(
						{ok: true as const, verb: 'press' as const},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('hover', {
		description:
			'Hover the pointer over the element a Playwright locator addresses ' +
			'(reveal hover menus / on-hover controls).',
		args: z.object({
			locator: z.string().describe('A raw Playwright locator expression.'),
		}),
		options: connectionOptions,
		output: actionOutput.extend({verb: z.literal('hover')}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.hover(locator(c.args.locator));
					return c.ok(
						{ok: true as const, verb: 'hover' as const},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('select', {
		description:
			'Choose an option in the native <select> a Playwright locator addresses, ' +
			'by --value OR --label (exactly one).',
		args: z.object({
			locator: z
				.string()
				.describe('A raw Playwright locator expression for the <select>.'),
		}),
		options: connectionOptions.extend({
			value: z
				.string()
				.optional()
				.describe("Match the option's value attribute (value form)."),
			label: z
				.string()
				.optional()
				.describe("Match the option's visible label text (label form)."),
		}),
		output: actionOutput.extend({
			verb: z.literal('select'),
			by: z.enum(['value', 'label']),
		}),
		async run(c) {
			const choice = selectChoiceFrom(c.options);
			if (choice === undefined) {
				return c.error({
					code: 'invalid-select',
					message: 'select needs exactly one of --value <v> or --label <l>.',
				});
			}
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.select(locator(c.args.locator), choice);
					return c.ok(
						{
							ok: true as const,
							verb: 'select' as const,
							by: 'value' in choice ? ('value' as const) : ('label' as const),
						},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('scroll', {
		description:
			'Scroll the page, either --to a Playwright locator (bring it into view) ' +
			'or --by a dx,dy pixel delta (exactly one).',
		options: connectionOptions.extend({
			to: z
				.string()
				.optional()
				.describe(
					'A raw Playwright locator expression to scroll into view (to form).',
				),
			by: z
				.string()
				.optional()
				.describe(
					'A dx,dy pixel delta to scroll by, e.g. 0,400 (down) or -100,0 (by form).',
				),
		}),
		output: actionOutput.extend({
			verb: z.literal('scroll'),
			form: z.enum(['to', 'by']),
		}),
		async run(c) {
			const target = scrollTargetFrom(c.options);
			if (target === undefined) {
				return c.error({
					code: 'invalid-scroll',
					message:
						'scroll needs exactly one of --to <locator> or --by <dx,dy> ' +
						'(dx,dy two numbers, e.g. 0,400).',
				});
			}
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.scroll(target);
					return c.ok(
						{
							ok: true as const,
							verb: 'scroll' as const,
							form: 'to' in target ? ('to' as const) : ('by' as const),
						},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('drag', {
		description:
			'Drag the element a source locator addresses onto the element a target ' +
			'locator addresses (drag-reorder UIs, drag-slider challenges).',
		args: z.object({
			source: z
				.string()
				.describe('A raw Playwright locator expression for the drag source.'),
			target: z
				.string()
				.describe('A raw Playwright locator expression for the drop target.'),
		}),
		options: connectionOptions,
		output: actionOutput.extend({verb: z.literal('drag')}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.drag(locator(c.args.source), locator(c.args.target));
					return c.ok(
						{ok: true as const, verb: 'drag' as const},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	// --- Tier-4 coordinate + screenshot verbs: mouse / screenshot (prd
	// broaden-agent-verb-surface, R3/R5, stories 17-19). Each is its own incur
	// command, so one definition yields both the CLI command and the MCP tool.
	// The seam stays string/number-typed (ADR-0003 as amended by the Tier-4 ADR):
	// `mouse` passes plain numbers + an enum, `screenshot` returns a file PATH
	// (never image bytes). The MCP `screenshot` result surfaces that path as the
	// attachment-capable `path` field an agent reads/attaches.

	cli.command('mouse', {
		description:
			'Coordinate mouse input at VIEWPORT CSS-pixels (Playwright page.mouse, NOT ' +
			'OS screen coordinates): click / move / down / up at --x,--y. A pixel in a ' +
			'VIEWPORT screenshot maps directly to these coordinates (the look-then-click ' +
			'loop); a FULL-PAGE screenshot does NOT.',
		options: connectionOptions.extend({
			action: z
				.enum(['click', 'move', 'down', 'up'])
				.default('click')
				.describe('What to do at the coordinate (default: click).'),
			x: z.coerce.number().describe('Viewport CSS-pixel X (left-relative).'),
			y: z.coerce.number().describe('Viewport CSS-pixel Y (top-relative).'),
			button: z
				.enum(['left', 'right', 'middle'])
				.default('left')
				.describe('Which button for click/down/up (default: left).'),
		}),
		output: actionOutput.extend({
			verb: z.literal('mouse'),
			action: z.enum(['click', 'move', 'down', 'up']),
			x: z.number(),
			y: z.number(),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const input: MouseInput = {
						action: c.options.action,
						x: c.options.x,
						y: c.options.y,
						button: c.options.button,
					};
					await s.page.mouse(input);
					return c.ok(
						{
							ok: true as const,
							verb: 'mouse' as const,
							action: c.options.action,
							x: c.options.x,
							y: c.options.y,
						},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('screenshot', {
		description:
			'Capture the page to a PNG FILE and return its PATH (never image bytes): ' +
			'--scope viewport (default, coordinate-matched to mouse) | full (whole page, ' +
			'NOT coordinate-matched) | element (clipped to --locator, REQUIRED for element). ' +
			'--out overrides the path (validated to stay under the managed dir).',
		options: connectionOptions.extend({
			scope: z
				.enum(['viewport', 'full', 'element'])
				.default('viewport')
				.describe(
					'Region to capture: viewport (default) | full | element (needs --locator).',
				),
			locator: z
				.string()
				.optional()
				.describe(
					'A raw Playwright locator expression to clip to (REQUIRED for --scope ' +
						'element, rejected otherwise). Frame scope rides in the string.',
				),
			out: z
				.string()
				.optional()
				.describe(
					'Override the output PNG path (validated to stay under the managed dir).',
				),
		}),
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('screenshot'),
			// `path` is the attachment-capable field (R5): a plain file PATH an agent
			// reads / attaches; no image bytes ever cross the seam.
			path: z
				.string()
				.describe('The PNG file path (read/attach this; never bytes).'),
			width: z.number().describe('The PNG pixel width.'),
			height: z.number().describe('The PNG pixel height.'),
		}),
		async run(c) {
			const options = screenshotOptionsFrom(c.options);
			if (options === undefined) {
				return c.error({
					code: 'invalid-screenshot',
					message:
						'screenshot --scope element requires --locator <expr>; --locator is ' +
						'only valid with --scope element.',
				});
			}
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const shot = await s.page.screenshot(options);
					return c.ok(
						{
							ok: true as const,
							verb: 'screenshot' as const,
							path: shot.path,
							width: shot.width,
							height: shot.height,
						},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	cli.command('wait', {
		description:
			'Pace actions by waiting for a timeout, a locator to appear, or the next navigation.',
		options: connectionOptions.extend({
			ms: z.coerce
				.number()
				.optional()
				.describe('Wait this many milliseconds (timeout form).'),
			locator: z
				.string()
				.optional()
				.describe('Wait until this Playwright locator appears (locator form).'),
			navigation: z
				.boolean()
				.default(false)
				.describe('Wait until the next navigation settles (navigation form).'),
		}),
		output: actionOutput.extend({
			verb: z.literal('wait'),
			kind: z.enum(['timeout', 'locator', 'navigation']),
		}),
		async run(c) {
			const condition = waitConditionFrom(c.options);
			if (condition === undefined) {
				return c.error({
					code: 'invalid-wait',
					message:
						'wait needs exactly one of --ms <n>, --locator <expr>, or --navigation.',
				});
			}
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.wait(condition);
					return c.ok(
						{ok: true as const, verb: 'wait' as const, kind: condition.kind},
						{cta: {commands: [nextSnapshot()]}},
					);
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});

	// `cookies` is a group (export/import), mirroring the verb's two directions.
	const cookies = Cli.create('cookies', {
		description:
			'Export or import the active session cookies (move/back up/seed a session).',
	});
	cookies.command('export', {
		description: 'Write the active session cookies to a file.',
		args: z.object({
			file: z.string().describe('Path to write the cookies export to.'),
		}),
		options: connectionOptions,
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('cookies export'),
			file: z.string(),
			count: z.number().describe('Number of cookies exported.'),
		}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					const all = await s.page.cookies();
					await writeFile(c.args.file, serializeCookies(all), 'utf8');
					return c.ok({
						ok: true as const,
						verb: 'cookies export' as const,
						file: c.args.file,
						count: all.length,
					});
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});
	cookies.command('import', {
		description: 'Load cookies from an export file into the active session.',
		args: z.object({
			file: z.string().describe('Path to a cookies export file to import.'),
		}),
		options: connectionOptions,
		output: z.object({
			ok: z.literal(true),
			verb: z.literal('cookies import'),
			file: z.string(),
			count: z.number().describe('Number of cookies imported.'),
		}),
		async run(c) {
			try {
				const text = await readFile(c.args.file, 'utf8');
				const parsed = deserializeCookies(text);
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.setCookies(parsed as readonly Cookie[]);
					return c.ok({
						ok: true as const,
						verb: 'cookies import' as const,
						file: c.args.file,
						count: parsed.length,
					});
				});
			} catch (cause) {
				return fail(c, cause, binary);
			}
		},
	});
	cli.command(cookies);

	return cli;
}

/**
 * The default {@link ServeSession}: bring up the ONE long-lived session through
 * `core`'s {@link startSessionServer}, wired to the v1 Playwright transports.
 * `launch` targets use the launch transport (raising the typed missing-profile /
 * missing-binary errors the CLI maps to fix commands); `attach` targets use the
 * attach transport. Kept here (not in the provider) because `serve` is the ONE
 * place a real browser is launched in the ADR-0005 model; verb commands are thin
 * clients and never launch.
 */
async function defaultServeSession(
	target: OpenTarget,
	home: {root?: string; env?: NodeJS.ProcessEnv},
	launchPolicy: LaunchPolicy = {},
): Promise<RunningSessionServer> {
	// The launch transport is the ONE place the stealth policy takes effect
	// (ADR-0005: serve is the one place a browser is launched). attach reuses the
	// user's own browser, so the policy does not apply there.
	const launch = new PlaywrightLaunchTransport(home, [], {
		stealth: launchPolicy.stealth,
		systemBrowser: launchPolicy.systemBrowser,
		...(launchPolicy.noViewport !== undefined
			? {noViewport: launchPolicy.noViewport}
			: {}),
		...(launchPolicy.proxy !== undefined ? {proxy: launchPolicy.proxy} : {}),
	});
	// attach reuses the user's browser, but the managed screenshots dir still
	// honours the home-root override so a test isolates screenshot output.
	const attach = new PlaywrightAttachTransport([], home);
	const transport: Transport = {
		open(t: OpenTarget): Promise<Session> {
			return t.mode === 'attach' ? attach.open(t) : launch.open(t);
		},
	};
	const options: SessionServerOptions = {...home, transport};
	return startSessionServer(target, options);
}

/**
 * Turn the three `wait` option forms into the seam's {@link WaitCondition}, or
 * `undefined` if zero or more than one form was given (the command reports that
 * as a clear error). Mirrors the seam's three-form `wait` verb.
 */
function waitConditionFrom(options: {
	ms?: number;
	locator?: string;
	navigation: boolean;
}): WaitCondition | undefined {
	const forms: WaitCondition[] = [];
	if (options.ms !== undefined) forms.push({kind: 'timeout', ms: options.ms});
	if (options.locator !== undefined && options.locator !== '')
		forms.push({kind: 'locator', target: locator(options.locator)});
	if (options.navigation) forms.push({kind: 'navigation'});
	return forms.length === 1 ? forms[0] : undefined;
}

/**
 * Turn the `select` option forms into the seam's {@link SelectChoice}, or
 * `undefined` if zero or both of `--value` / `--label` were given (the command
 * reports that as a clear error). Mirrors `wait`'s loud "exactly one of"
 * validation (R5): an empty string counts as absent, so `--value ''` is treated
 * as not given.
 */
function selectChoiceFrom(options: {
	value?: string;
	label?: string;
}): SelectChoice | undefined {
	const forms: SelectChoice[] = [];
	if (options.value !== undefined) forms.push({value: options.value});
	if (options.label !== undefined) forms.push({label: options.label});
	return forms.length === 1 ? forms[0] : undefined;
}

/**
 * Turn the `scroll` option forms into the seam's {@link ScrollTarget}, or
 * `undefined` if zero or both of `--to` / `--by` were given OR `--by` is not a
 * valid `dx,dy` pair (the command reports that as a clear error). Mirrors
 * `wait`'s loud "exactly one of" validation (R5). `--by` is parsed here (two
 * comma-separated finite numbers) so a malformed delta fails loud rather than
 * silently scrolling by `NaN`.
 */
function scrollTargetFrom(options: {
	to?: string;
	by?: string;
}): ScrollTarget | undefined {
	const forms: ScrollTarget[] = [];
	if (options.to !== undefined && options.to !== '') {
		forms.push({to: locator(options.to)});
	}
	if (options.by !== undefined && options.by !== '') {
		const by = parseDelta(options.by);
		if (by === undefined) return undefined;
		forms.push({by});
	}
	return forms.length === 1 ? forms[0] : undefined;
}

/**
 * Turn the `screenshot` option flags into the seam's {@link ScreenshotOptions},
 * or `undefined` when the scope/locator pairing is invalid (the command reports
 * that as a clear error, mirroring `wait`'s loud validation, R5): `--scope
 * element` REQUIRES `--locator`, and `--locator` is ONLY valid with `--scope
 * element`. An empty `--locator`/`--out` string counts as absent. The seam
 * re-validates as the load-bearing check (an untyped RPC client too), so this is
 * the friendly fail-fast at the CLI edge.
 */
function screenshotOptionsFrom(options: {
	scope: ScreenshotScope;
	locator?: string;
	out?: string;
}): ScreenshotOptions | undefined {
	const hasLocator = options.locator !== undefined && options.locator !== '';
	if (options.scope === 'element' && !hasLocator) return undefined;
	if (options.scope !== 'element' && hasLocator) return undefined;
	return {
		scope: options.scope,
		...(hasLocator ? {locator: locator(options.locator!)} : {}),
		...(options.out !== undefined && options.out !== ''
			? {out: options.out}
			: {}),
	};
}

/**
 * Parse a `dx,dy` pixel-delta string into a `{dx, dy}` pair, or `undefined` if
 * it is not exactly two comma-separated finite numbers. Used by `scroll --by`
 * so a malformed delta fails loud instead of scrolling by `NaN`.
 */
function parseDelta(raw: string): {dx: number; dy: number} | undefined {
	const parts = raw.split(',');
	if (parts.length !== 2) return undefined;
	const dx = Number(parts[0]!.trim());
	const dy = Number(parts[1]!.trim());
	if (!Number.isFinite(dx) || !Number.isFinite(dy)) return undefined;
	return {dx, dy};
}

/**
 * The shared failure path. Map a typed `core` error to its user-facing message
 * + exact fix command (PRD story 17); fall back to a generic error otherwise.
 * Always goes through incur's `c.error(...)` so the failure is in the
 * structured output envelope with a machine-readable `code`.
 */
function fail(
	c: {error: (o: {code: string; message: string}) => never},
	cause: unknown,
	binary: string,
): never {
	const mapped = mapControllerError(cause, binary);
	if (mapped !== undefined) {
		return c.error({code: mapped.code, message: mapped.message});
	}
	const message = cause instanceof Error ? cause.message : String(cause);
	return c.error({code: 'unknown', message});
}

// Re-export so the bin entry and tests can reach the builder's helpers.
export {buildPrompt, resolveProfileLocation};
