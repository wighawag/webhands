import {Cli, z} from 'incur';
import {
	buildPrompt,
	resolveProfileLocation,
	serializeCookies,
	deserializeCookies,
	locator,
	type Cookie,
	type OpenTarget,
	type Session,
	type WaitCondition,
} from '@my-browser-controller/core';
import {readFile, writeFile} from 'node:fs/promises';
import {mapControllerError} from './errors.js';
import {
	createDefaultSessionProvider,
	type SessionProvider,
} from './session-provider.js';
import {setupProfile} from '@my-browser-controller/core';

/**
 * The CLI binary name. Used both as the `incur` CLI name and (echoed back from
 * `c.name`) inside every fix-command message, so a suggested command always
 * matches how the user invoked the tool.
 */
export const CLI_NAME = 'my-browser-controller';

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
}

// --- shared schema fragments ----------------------------------------------

/**
 * Connection options every page verb shares: HOW to obtain the session it acts
 * on. In v1 these open a session per invocation through the default provider;
 * once cross-invocation persistence lands (ADR-0005, the next task) the verbs
 * become thin clients of the running `serve` process and the provider, not
 * these options, carries the open mechanism. They live here as ONE shared
 * fragment so every verb opens identically.
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

	const cli = Cli.create(binary, {
		description: DESCRIPTION,
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
				// `setup-profile` holds the headed window open for the human's login;
				// the long-lived hold is the persistence task's concern. For the v1
				// wiring we report where the profile lives and close the session.
				await session.close();
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
		}),
		output: z.object({
			mode: z.literal('launch'),
			profile: z.string(),
			headed: z.boolean(),
		}),
		async run(c) {
			try {
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
