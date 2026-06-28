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
	type OpenTarget,
	type RunningSessionServer,
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
});

/** Resolve the {@link LaunchPolicy} from the shared stealth option fields. */
function launchPolicyFrom(options: {
	stealth?: boolean;
	'use-system-browser'?: string;
}): LaunchPolicy {
	return {
		stealth: options.stealth === true,
		systemBrowser:
			options['use-system-browser'] !== undefined &&
			options['use-system-browser'] !== ''
				? options['use-system-browser']
				: undefined,
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
					"A raw Playwright locator expression, e.g. getByRole('button', { name: 'Search' }).",
				),
		}),
		options: connectionOptions,
		output: actionOutput.extend({verb: z.literal('click')}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.click(locator(c.args.locator));
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
				.describe('A raw Playwright locator expression for the target input.'),
			text: z.string().describe('The text to type into the element.'),
		}),
		options: connectionOptions,
		output: actionOutput.extend({verb: z.literal('type')}),
		async run(c) {
			try {
				return await withSession(provider, targetFrom(c.options), async (s) => {
					await s.page.type(locator(c.args.locator), c.args.text);
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
		options: connectionOptions,
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
					const result = await s.page.eval(c.args.expression);
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
	});
	const attach = new PlaywrightAttachTransport();
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
