import {describe, expect, it} from 'vitest';
import {
	StubTransport,
	MissingBrowserBinaryError,
	MissingStealthDependencyError,
	InvalidProxyError,
	MissingProfileError,
	AttachNotChromiumError,
	AttachNoContextError,
	NoLiveServerError,
	SessionAlreadyActiveError,
	CrossOriginFrameError,
	ScreenshotPathError,
	StaleRefError,
	type OpenTarget,
	type RunningSessionServer,
	type Session,
} from '@webhands/core';
import {
	createCli,
	CLI_NAME,
	type LaunchPolicy,
	type ServeSession,
	type SessionProvider,
} from '../src/index.js';

/**
 * CLI-LEVEL WIRING tests (PRD "Testing Decisions": CLI tests assert incur
 * wiring; story 12 envelope, 13 cta, 14 MCP/`--llms`, 17 actionable errors).
 *
 * They assert ONLY the wiring — the verb commands are present with declared
 * zod schemas, every run returns the incur structured envelope with a `cta`
 * hint, the binary is an MCP server and emits a `--llms` manifest, and the
 * typed `core` missing-binary / missing-profile conditions surface as the
 * user-facing message + EXACT fix command. They do NOT re-assert verb behaviour
 * (navigate/snapshot/click/...): that is covered at the `core` Driver seam. We
 * inject a {@link SessionProvider} (a `StubTransport`, or one that THROWS a
 * typed `core` error) so no real browser is launched here.
 */

/** A provider backed by a fresh `StubTransport`, recording the verb round-trip. */
function stubProvider(): {provider: SessionProvider; transport: StubTransport} {
	const transport = new StubTransport();
	const provider: SessionProvider = (target: OpenTarget) =>
		transport.open(target);
	return {provider, transport};
}

/** A provider that always throws `error` on open (to drive the error paths). */
function throwingProvider(error: unknown): SessionProvider {
	return async () => {
		throw error;
	};
}

/**
 * A provider whose session opens fine but whose `eval` REJECTS with `error`, so
 * the verb-level error path (not the open path) is exercised — the shape the
 * cross-origin frame error takes (raised by the `eval` verb itself, not at
 * session open).
 */
function evalRejectingProvider(error: unknown): SessionProvider {
	return async () => {
		const session: Session = {
			page: {
				async eval() {
					throw error;
				},
			} as unknown as Session['page'],
			async close() {},
			async waitForClose() {},
		};
		return session;
	};
}

/**
 * A provider whose session opens fine but whose `click` REJECTS with `error`,
 * so the verb-level error path is exercised — the shape the stale-ref error
 * takes (raised by the `click` verb when a `--by-ref` resolve is zero/many).
 */
function clickRejectingProvider(error: unknown): SessionProvider {
	return async () => {
		const session: Session = {
			page: {
				async click() {
					throw error;
				},
			} as unknown as Session['page'],
			async close() {},
			async waitForClose() {},
		};
		return session;
	};
}

/**
 * A provider whose session opens fine but whose `screenshot` REJECTS with
 * `error`, so the verb-level error path is exercised — the shape the screenshot
 * managed-dir error takes (raised by the `screenshot` verb, not at open).
 */
function screenshotRejectingProvider(error: unknown): SessionProvider {
	return async () => {
		const session: Session = {
			page: {
				async screenshot() {
					throw error;
				},
			} as unknown as Session['page'],
			async close() {},
			async waitForClose() {},
		};
		return session;
	};
}

/**
 * A fake {@link ServeSession} that records the target it was asked to bring up
 * and returns a canned running server, so `serve` wiring is exercised with no
 * real browser and no real HTTP listener.
 */
function fakeServe(): {
	serve: ServeSession;
	targets: OpenTarget[];
	policies: (LaunchPolicy | undefined)[];
	stopped: boolean[];
} {
	const targets: OpenTarget[] = [];
	const policies: (LaunchPolicy | undefined)[] = [];
	const stopped: boolean[] = [];
	const serve: ServeSession = async (target, _options, launchPolicy) => {
		targets.push(target);
		policies.push(launchPolicy);
		const index = stopped.push(false) - 1;
		const server: RunningSessionServer = {
			// A launch serve advertises a shared-driving-surface CDP endpoint; the
			// wiring surfaces it in the serve output (the harness reads it to hand a
			// Playwright-only agent the SAME live page).
			endpoint: {
				url: 'http://127.0.0.1:51999',
				pid: 4242,
				cdpEndpoint: 'http://127.0.0.1:9555',
			},
			async stop() {
				stopped[index] = true;
			},
		};
		return server;
	};
	return {serve, targets, policies, stopped};
}

/** Run a command through `serve`, capturing stdout and exit code (no real process exit). */
async function run(
	provider: SessionProvider,
	argv: string[],
	extra: {serveSession?: ServeSession} = {},
): Promise<{stdout: string; code: number}> {
	const cli = createCli({sessionProvider: provider, ...extra});
	let stdout = '';
	let code = 0;
	await cli.serve(argv, {
		stdout: (s) => {
			stdout += s;
		},
		exit: (c) => {
			code = c;
		},
		env: {},
	});
	return {stdout, code};
}

/** Parse the full JSON envelope (`--full-output --format json`) from a run. */
async function runEnvelope(
	provider: SessionProvider,
	argv: string[],
	extra: {serveSession?: ServeSession} = {},
): Promise<{
	ok: boolean;
	data?: unknown;
	error?: {code: string; message: string};
	meta: {cta?: {commands: {command: string}[]}};
}> {
	const {stdout} = await run(
		provider,
		[...argv, '--full-output', '--format', 'json'],
		extra,
	);
	return JSON.parse(stdout);
}

/** Read a command's JSON Schema via `--schema --format json`. */
async function schemaOf(
	argv: string[],
): Promise<{args?: unknown; options?: unknown; output?: unknown}> {
	const {provider} = stubProvider();
	const {stdout} = await run(provider, [
		...argv,
		'--schema',
		'--format',
		'json',
	]);
	return JSON.parse(stdout);
}

describe('incur CLI wiring', () => {
	describe('commands + schemas (one per verb plus the mode commands)', () => {
		// Page verbs + mode commands the prd mandates (story 12: each with a zod
		// args/options/output schema).
		const cases: {argv: string[]; wantArgs: boolean; outputKeys: string[]}[] = [
			{argv: ['goto'], wantArgs: true, outputKeys: ['ok', 'verb', 'url']},
			{
				argv: ['snapshot'],
				wantArgs: false,
				outputKeys: ['url', 'view', 'content'],
			},
			{argv: ['click'], wantArgs: true, outputKeys: ['ok', 'verb']},
			{argv: ['type'], wantArgs: true, outputKeys: ['ok', 'verb']},
			{argv: ['eval'], wantArgs: true, outputKeys: ['ok', 'verb', 'result']},
			{argv: ['query'], wantArgs: true, outputKeys: ['ok', 'verb', 'rows']},
			{argv: ['count'], wantArgs: true, outputKeys: ['ok', 'verb', 'count']},
			{argv: ['exists'], wantArgs: true, outputKeys: ['ok', 'verb', 'exists']},
			{
				argv: ['is-visible'],
				wantArgs: true,
				outputKeys: ['ok', 'verb', 'visible'],
			},
			{
				argv: ['get-attribute'],
				wantArgs: true,
				outputKeys: ['ok', 'verb', 'name', 'value'],
			},
			{argv: ['press'], wantArgs: true, outputKeys: ['ok', 'verb']},
			{argv: ['hover'], wantArgs: true, outputKeys: ['ok', 'verb']},
			{argv: ['select'], wantArgs: true, outputKeys: ['ok', 'verb', 'by']},
			{argv: ['scroll'], wantArgs: false, outputKeys: ['ok', 'verb', 'form']},
			{argv: ['drag'], wantArgs: true, outputKeys: ['ok', 'verb']},
			{
				argv: ['mouse'],
				wantArgs: false,
				outputKeys: ['ok', 'verb', 'action', 'x', 'y'],
			},
			{
				argv: ['screenshot'],
				wantArgs: false,
				outputKeys: ['ok', 'verb', 'path', 'width', 'height'],
			},
			{argv: ['wait'], wantArgs: false, outputKeys: ['ok', 'verb', 'kind']},
			{
				argv: ['setup-profile'],
				wantArgs: false,
				outputKeys: ['profile', 'profileDir'],
			},
			{
				argv: ['launch'],
				wantArgs: false,
				outputKeys: ['mode', 'profile', 'headed'],
			},
			{argv: ['attach'], wantArgs: false, outputKeys: ['mode', 'endpoint']},
			{
				argv: ['cookies', 'export'],
				wantArgs: true,
				outputKeys: ['ok', 'verb', 'file', 'count'],
			},
			{
				argv: ['cookies', 'import'],
				wantArgs: true,
				outputKeys: ['ok', 'verb', 'file', 'count'],
			},
		];

		for (const {argv, wantArgs, outputKeys} of cases) {
			it(`declares an output (and ${wantArgs ? 'args+' : ''}options) schema for \`${argv.join(' ')}\``, async () => {
				const schema = (await schemaOf(argv)) as {
					args?: {properties?: Record<string, unknown>};
					options?: {properties?: Record<string, unknown>};
					output?: {properties?: Record<string, unknown>};
				};
				// Every command declares an output schema (the envelope's data shape).
				expect(schema.output).toBeDefined();
				expect(Object.keys(schema.output?.properties ?? {})).toEqual(
					expect.arrayContaining(outputKeys),
				);
				// Every command declares options (page verbs share the connection options).
				expect(schema.options).toBeDefined();
				if (wantArgs) {
					expect(schema.args).toBeDefined();
					expect(
						Object.keys(schema.args?.properties ?? {}).length,
					).toBeGreaterThan(0);
				}
			});
		}
	});

	describe('Tier-1 query + state verb wiring (prd broaden-agent-verb-surface, R5)', () => {
		it('forwards REPEATABLE --attr/--prop/--pw flags (not comma-joined) into the seam query call', async () => {
			const {provider, transport} = stubProvider();
			const env = await runEnvelope(provider, [
				'query',
				`page.locator('.result')`,
				'--attr',
				'href',
				'--attr',
				'data-sitekey',
				'--prop',
				'innerText',
				'--pw',
				'visible',
				'--limit',
				'5',
			]);
			expect(env.ok).toBe(true);
			expect(env.data).toMatchObject({verb: 'query'});
			const call = transport.calls.find((c) => c.verb === 'query');
			expect(call).toBeDefined();
			expect(call?.args[0]).toBe(`page.locator('.result')`);
			// Each repeated flag is a SEPARATE array element (comma is never a delimiter).
			expect(call?.args[1]).toEqual({
				attrs: ['href', 'data-sitekey'],
				props: ['innerText'],
				pw: ['visible'],
				limit: 5,
			});
		});

		it('renders the query rows in the structured output envelope', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['query', `page.locator('.x')`]);
			expect(env.ok).toBe(true);
			// The stub returns no rows, but the declared shape is present.
			expect(env.data).toMatchObject({verb: 'query', rows: []});
		});

		it('--with-refs forwards refs:true; default query forwards NO refs (opt-in)', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, [
				'query',
				`page.locator('.result')`,
				'--with-refs',
			]);
			const withRefs = transport.calls.find((c) => c.verb === 'query');
			expect(withRefs?.args[1]).toMatchObject({refs: true});

			const {provider: p2, transport: t2} = stubProvider();
			await runEnvelope(p2, ['query', `page.locator('.result')`]);
			const plain = t2.calls.find((c) => c.verb === 'query');
			// Opt-in: the default carries no `refs` key (a pure read).
			expect((plain?.args[1] as {refs?: unknown}).refs).toBeUndefined();
		});

		it('click/type --by-ref forward {byRef:true}; without it the ActionOptions is omitted', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, [
				'click',
				`p.locator("#buy-charlie")`,
				'--by-ref',
			]);
			await runEnvelope(provider, ['click', `getByRole('button')`]);
			await runEnvelope(provider, [
				'type',
				`p.locator("#in")`,
				'hello',
				'--by-ref',
			]);
			const clicks = transport.calls.filter((c) => c.verb === 'click');
			expect(clicks[0]?.args).toEqual([
				`p.locator("#buy-charlie")`,
				{byRef: true},
			]);
			// Plain click: the ActionOptions is omitted (the unchanged path).
			expect(clicks[1]?.args).toEqual([`getByRole('button')`]);
			const typed = transport.calls.find((c) => c.verb === 'type');
			expect(typed?.args).toEqual([`p.locator("#in")`, 'hello', {byRef: true}]);
		});

		it('count/exists/is-visible/get-attribute each return their tiny structured result', async () => {
			const {provider} = stubProvider();
			expect(
				(await runEnvelope(provider, ['count', `page.locator('.x')`])).data,
			).toMatchObject({verb: 'count', count: 0});
			expect(
				(await runEnvelope(provider, ['exists', `page.locator('.x')`])).data,
			).toMatchObject({verb: 'exists', exists: false});
			expect(
				(await runEnvelope(provider, ['is-visible', `page.locator('.x')`]))
					.data,
			).toMatchObject({verb: 'isVisible', visible: false});
			const attr = await runEnvelope(provider, [
				'get-attribute',
				`page.locator('.x')`,
				'--name',
				'data-sitekey',
			]);
			expect(attr.data).toMatchObject({
				verb: 'getAttribute',
				name: 'data-sitekey',
				value: null,
			});
		});

		it('get-attribute forwards the --name into the seam getAttribute call', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, [
				'get-attribute',
				`page.locator('.x')`,
				'--name',
				'href',
			]);
			const call = transport.calls.find((c) => c.verb === 'getAttribute');
			expect(call?.args).toEqual([`page.locator('.x')`, 'href']);
		});
	});

	describe('Tier-3 frame-scoped eval wiring (prd broaden-agent-verb-surface, R1/R5)', () => {
		it('eval WITHOUT --frame passes no options (backward compatible)', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, ['eval', '1 + 1']);
			const call = transport.calls.find((c) => c.verb === 'eval');
			// The top-document form carries no frame: the options arg is `undefined`.
			expect(call?.args).toEqual(['1 + 1', undefined]);
		});

		it('eval --frame forwards the SAME-ORIGIN frame selector into the eval call', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, [
				'eval',
				'window.__childValue',
				'--frame',
				'#main-iframe',
			]);
			const call = transport.calls.find((c) => c.verb === 'eval');
			expect(call?.args).toEqual([
				'window.__childValue',
				{frame: '#main-iframe'},
			]);
		});
	});

	describe('Tier-2 input verb wiring (prd broaden-agent-verb-surface, R5)', () => {
		it('press forwards the key + optional --locator into the seam press call', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, [
				'press',
				'Control+a',
				'--locator',
				`page.locator('#x')`,
			]);
			const call = transport.calls.find((c) => c.verb === 'press');
			expect(call?.args).toEqual(['Control+a', `page.locator('#x')`]);
		});

		it('press WITHOUT --locator targets the focused element (undefined locator)', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, ['press', 'Enter']);
			const call = transport.calls.find((c) => c.verb === 'press');
			expect(call?.args).toEqual(['Enter', undefined]);
		});

		it('hover forwards its locator into the seam hover call', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, ['hover', `page.locator('#menu')`]);
			const call = transport.calls.find((c) => c.verb === 'hover');
			expect(call?.args).toEqual([`page.locator('#menu')`]);
		});

		it('select --value forwards a value choice; --label forwards a label choice', async () => {
			const {provider, transport} = stubProvider();
			const byValue = await runEnvelope(provider, [
				'select',
				`page.locator('#color')`,
				'--value',
				'g',
			]);
			expect(byValue.data).toMatchObject({verb: 'select', by: 'value'});
			expect(transport.calls.find((c) => c.verb === 'select')?.args).toEqual([
				`page.locator('#color')`,
				{value: 'g'},
			]);

			const {provider: p2, transport: t2} = stubProvider();
			const byLabel = await runEnvelope(p2, [
				'select',
				`page.locator('#color')`,
				'--label',
				'Blue',
			]);
			expect(byLabel.data).toMatchObject({verb: 'select', by: 'label'});
			expect(t2.calls.find((c) => c.verb === 'select')?.args).toEqual([
				`page.locator('#color')`,
				{label: 'Blue'},
			]);
		});

		it('select with NEITHER --value nor --label is a loud error (exactly one of)', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'select',
				`page.locator('#color')`,
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('invalid-select');
			expect(env.error?.message).toContain('exactly one of');
		});

		it('select with BOTH --value and --label is a loud error (exactly one of)', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'select',
				`page.locator('#color')`,
				'--value',
				'g',
				'--label',
				'Green',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('invalid-select');
		});

		it('scroll --to forwards a to target; --by parses a dx,dy delta', async () => {
			const {provider, transport} = stubProvider();
			const to = await runEnvelope(provider, [
				'scroll',
				'--to',
				`page.locator('#far')`,
			]);
			expect(to.data).toMatchObject({verb: 'scroll', form: 'to'});
			expect(transport.calls.find((c) => c.verb === 'scroll')?.args).toEqual([
				{to: `page.locator('#far')`},
			]);

			const {provider: p2, transport: t2} = stubProvider();
			const by = await runEnvelope(p2, ['scroll', '--by', '0,400']);
			expect(by.data).toMatchObject({verb: 'scroll', form: 'by'});
			expect(t2.calls.find((c) => c.verb === 'scroll')?.args).toEqual([
				{by: {dx: 0, dy: 400}},
			]);
		});

		it('scroll with NEITHER --to nor --by is a loud error (exactly one of)', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['scroll']);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('invalid-scroll');
			expect(env.error?.message).toContain('exactly one of');
		});

		it('scroll with BOTH --to and --by is a loud error (exactly one of)', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'scroll',
				'--to',
				`page.locator('#far')`,
				'--by',
				'0,400',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('invalid-scroll');
		});

		it('scroll --by with a malformed delta is a loud error (not NaN scroll)', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['scroll', '--by', 'oops']);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('invalid-scroll');
		});

		it('drag forwards the source + target locators into the seam drag call', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, [
				'drag',
				`page.locator('#src')`,
				`page.locator('#dst')`,
			]);
			const call = transport.calls.find((c) => c.verb === 'drag');
			expect(call?.args).toEqual([
				`page.locator('#src')`,
				`page.locator('#dst')`,
			]);
		});
	});

	describe('Tier-4 coordinate + screenshot verb wiring (prd broaden-agent-verb-surface, R3/R5)', () => {
		it('mouse forwards --action/--x/--y/--button into the seam mouse call', async () => {
			const {provider, transport} = stubProvider();
			const env = await runEnvelope(provider, [
				'mouse',
				'--action',
				'click',
				'--x',
				'120',
				'--y',
				'80',
				'--button',
				'right',
			]);
			expect(env.data).toMatchObject({
				verb: 'mouse',
				action: 'click',
				x: 120,
				y: 80,
			});
			const call = transport.calls.find((c) => c.verb === 'mouse');
			// Plain numbers + an enum cross the seam (ADR-0003 as amended): no
			// Playwright type, no OS coordinate.
			expect(call?.args).toEqual([
				{action: 'click', x: 120, y: 80, button: 'right'},
			]);
		});

		it('mouse defaults action to click and button to left', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, ['mouse', '--x', '1', '--y', '2']);
			expect(transport.calls.find((c) => c.verb === 'mouse')?.args).toEqual([
				{action: 'click', x: 1, y: 2, button: 'left'},
			]);
		});

		it('screenshot defaults to viewport scope and surfaces the path field', async () => {
			const {provider, transport} = stubProvider();
			const env = await runEnvelope(provider, ['screenshot']);
			expect(env.ok).toBe(true);
			// The attachment-capable `path` field (R5): the stub returns a stand-in
			// path and the verb surfaces it (never image bytes).
			expect(env.data).toMatchObject({
				verb: 'screenshot',
				path: 'stub://screenshot.png',
			});
			expect(
				transport.calls.find((c) => c.verb === 'screenshot')?.args,
			).toEqual([{scope: 'viewport'}]);
		});

		it('screenshot --scope element forwards the --locator + --out into the seam call', async () => {
			const {provider, transport} = stubProvider();
			await runEnvelope(provider, [
				'screenshot',
				'--scope',
				'element',
				'--locator',
				`page.locator('#widget')`,
				'--out',
				'sub/x.png',
			]);
			expect(
				transport.calls.find((c) => c.verb === 'screenshot')?.args,
			).toEqual([
				{
					scope: 'element',
					locator: `page.locator('#widget')`,
					out: 'sub/x.png',
				},
			]);
		});

		it('screenshot --scope element WITHOUT --locator is a loud error (like wait)', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'screenshot',
				'--scope',
				'element',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('invalid-screenshot');
		});

		it('screenshot --locator on a NON-element scope is a loud error', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'screenshot',
				'--scope',
				'viewport',
				'--locator',
				`page.locator('#widget')`,
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('invalid-screenshot');
		});
	});

	describe('structured output envelope (story 12)', () => {
		it('returns the incur {ok, data, meta} envelope with the declared output shape', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'goto',
				'https://example.test/',
			]);
			expect(env.ok).toBe(true);
			expect(env.data).toMatchObject({
				verb: 'goto',
				url: 'https://example.test/',
			});
			expect(env.meta).toBeDefined();
		});

		it('exposes the same envelope over `cli.fetch` (serve-as-API)', async () => {
			const {provider} = stubProvider();
			const cli = createCli({sessionProvider: provider});
			const res = await cli.fetch(new Request('http://local/launch'));
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				ok: boolean;
				data: unknown;
				meta: unknown;
			};
			expect(body.ok).toBe(true);
			expect(body.data).toMatchObject({mode: 'launch'});
			expect(body.meta).toBeDefined();
		});
	});

	describe('cta next-verb hints (story 13)', () => {
		it('suggests `snapshot` after `goto`', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'goto',
				'https://example.test/',
			]);
			const commands = (env.meta.cta?.commands ?? []).map((c) => c.command);
			expect(commands).toContain(`${CLI_NAME} snapshot`);
		});

		it('suggests the act verbs (click/type/eval) after `snapshot`', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['snapshot']);
			const commands = (env.meta.cta?.commands ?? []).map((c) => c.command);
			expect(commands).toEqual(
				expect.arrayContaining([
					`${CLI_NAME} click`,
					`${CLI_NAME} type`,
					`${CLI_NAME} eval`,
				]),
			);
		});

		it('suggests `goto`+`snapshot` after `launch`', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['launch']);
			const commands = (env.meta.cta?.commands ?? []).map((c) => c.command);
			expect(commands).toEqual(
				expect.arrayContaining([`${CLI_NAME} goto`, `${CLI_NAME} snapshot`]),
			);
		});

		it('`launch` defaults stealth off and omits systemBrowser', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['launch']);
			expect(env.data).toMatchObject({mode: 'launch', stealth: false});
			expect(env.data?.systemBrowser).toBeUndefined();
		});

		it('`launch --stealth --use-system-browser chrome` echoes the policy in output', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'launch',
				'--stealth',
				'--use-system-browser',
				'chrome',
			]);
			expect(env.data).toMatchObject({
				mode: 'launch',
				stealth: true,
				systemBrowser: 'chrome',
			});
		});

		it('`launch --no-viewport` echoes noViewport:true in output', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['launch', '--no-viewport']);
			expect(env.data).toMatchObject({mode: 'launch', noViewport: true});
		});

		it('`launch --proxy socks5h://host:1080` echoes the proxy in output', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, [
				'launch',
				'--proxy',
				'socks5h://host:1080',
			]);
			expect(env.data).toMatchObject({
				mode: 'launch',
				proxy: 'socks5h://host:1080',
			});
		});

		it('`launch` without --proxy omits proxy from output', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['launch']);
			expect(env.data?.proxy).toBeUndefined();
		});

		it('`launch` without --no-viewport omits noViewport (core decides the default)', async () => {
			const {provider} = stubProvider();
			const env = await runEnvelope(provider, ['launch']);
			expect(env.data?.noViewport).toBeUndefined();
		});
	});

	describe('agent discovery: --llms manifest + MCP server (story 14, no bespoke MCP code)', () => {
		it('emits a `--llms` manifest listing every verb and mode command', async () => {
			const {provider} = stubProvider();
			const {stdout} = await run(provider, ['--llms']);
			for (const command of [
				'goto',
				'snapshot',
				'click',
				'type',
				'eval',
				'query',
				'count',
				'exists',
				'is-visible',
				'get-attribute',
				'press',
				'hover',
				'select',
				'scroll',
				'drag',
				'wait',
				'cookies export',
				'cookies import',
				'setup-profile',
				'launch',
				'attach',
			]) {
				expect(stdout).toContain(`${CLI_NAME} ${command}`);
			}
		});

		it('serves an MCP endpoint that lists the verbs as tools with schemas', async () => {
			const {provider} = stubProvider();
			const cli = createCli({sessionProvider: provider});
			const call = (body: unknown) =>
				cli.fetch(
					new Request('http://local/mcp', {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							accept: 'application/json, text/event-stream',
						},
						body: JSON.stringify(body),
					}),
				);

			const init = await call({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-06-18',
					capabilities: {},
					clientInfo: {name: 't', version: '1'},
				},
			});
			expect(init.status).toBe(200);

			const listed = await call({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/list',
				params: {},
			});
			const body = (await listed.json()) as {
				result: {
					tools: {
						name: string;
						inputSchema?: unknown;
						outputSchema?: unknown;
					}[];
				};
			};
			const names = body.result.tools.map((t) => t.name);
			expect(names).toEqual(
				expect.arrayContaining([
					'goto',
					'snapshot',
					'click',
					'type',
					'eval',
					'query',
					'count',
					'exists',
					'is-visible',
					'get-attribute',
					'press',
					'hover',
					'select',
					'scroll',
					'drag',
					'wait',
					'launch',
					'attach',
				]),
			);
			// The tools carry the declared schemas (no bespoke MCP code: incur derives
			// them from the same zod definitions).
			const goto = body.result.tools.find((t) => t.name === 'goto');
			expect(goto?.inputSchema).toBeDefined();
			expect(goto?.outputSchema).toBeDefined();
		});
	});

	describe('cross-invocation lifecycle: serve / stop (ADR-0005)', () => {
		it('`serve` brings up the single session and reports its discoverable endpoint', async () => {
			const {provider} = stubProvider();
			const {serve, targets} = fakeServe();
			const env = await runEnvelope(provider, ['serve', '--profile', 'work'], {
				serveSession: serve,
			});
			expect(env.ok).toBe(true);
			expect(env.data).toMatchObject({
				verb: 'serve',
				url: 'http://127.0.0.1:51999',
				pid: 4242,
				// The shared-driving-surface CDP endpoint is surfaced for the harness.
				cdpEndpoint: 'http://127.0.0.1:9555',
			});
			// `serve` consumed the connection options to choose the launch target.
			expect(targets).toEqual([
				{mode: 'launch', profile: 'work', headed: false},
			]);
		});

		it('`serve --endpoint` brings the single session up in attach mode', async () => {
			const {provider} = stubProvider();
			const {serve, targets} = fakeServe();
			await runEnvelope(
				provider,
				['serve', '--endpoint', 'http://127.0.0.1:9222'],
				{serveSession: serve},
			);
			expect(targets).toEqual([
				{mode: 'attach', endpoint: 'http://127.0.0.1:9222'},
			]);
		});

		it('`serve` defaults to NO stealth and bundled Chromium (opt-in is off)', async () => {
			const {provider} = stubProvider();
			const {serve, policies} = fakeServe();
			await runEnvelope(provider, ['serve', '--profile', 'work'], {
				serveSession: serve,
			});
			expect(policies).toEqual([{stealth: false, systemBrowser: undefined}]);
		});

		it('`serve --stealth --use-system-browser chrome` forwards the launch policy', async () => {
			const {provider} = stubProvider();
			const {serve, policies, targets} = fakeServe();
			await runEnvelope(
				provider,
				[
					'serve',
					'--profile',
					'work',
					'--stealth',
					'--use-system-browser',
					'chrome',
				],
				{serveSession: serve},
			);
			// The policy rides ALONGSIDE the target (ADR-0003: target stays
			// stealth/Playwright-free); both reach the serve seam.
			expect(targets).toEqual([
				{mode: 'launch', profile: 'work', headed: false},
			]);
			expect(policies).toEqual([{stealth: true, systemBrowser: 'chrome'}]);
		});

		it('`serve --proxy socks5h://host:1080` forwards the proxy in the launch policy', async () => {
			const {provider} = stubProvider();
			const {serve, policies} = fakeServe();
			await runEnvelope(
				provider,
				['serve', '--profile', 'work', '--proxy', 'socks5h://host:1080'],
				{serveSession: serve},
			);
			expect(policies).toEqual([
				{
					stealth: false,
					systemBrowser: undefined,
					proxy: 'socks5h://host:1080',
				},
			]);
		});

		it('`serve --no-viewport` forwards noViewport:true in the launch policy', async () => {
			const {provider} = stubProvider();
			const {serve, policies} = fakeServe();
			await runEnvelope(
				provider,
				['serve', '--profile', 'work', '--no-viewport'],
				{serveSession: serve},
			);
			expect(policies).toEqual([
				{stealth: false, systemBrowser: undefined, noViewport: true},
			]);
		});

		it('`serve` without --no-viewport omits noViewport from the policy', async () => {
			const {provider} = stubProvider();
			const {serve, policies} = fakeServe();
			await runEnvelope(provider, ['serve', '--profile', 'work'], {
				serveSession: serve,
			});
			expect(policies).toEqual([{stealth: false, systemBrowser: undefined}]);
		});

		it('`stop` with no live server is a friendly no-op (stopped:false), not an error', async () => {
			const {provider} = stubProvider();
			// home is unset, so discovery finds no endpoint file under a fresh root.
			const env = await runEnvelope(provider, ['stop']);
			expect(env.ok).toBe(true);
			expect(env.data).toMatchObject({verb: 'stop', stopped: false});
		});

		it('declares serve/stop output schemas (one command each, story 12)', async () => {
			const serveSchema = (await schemaOf(['serve'])) as {
				output?: {properties?: Record<string, unknown>};
			};
			expect(Object.keys(serveSchema.output?.properties ?? {})).toEqual(
				expect.arrayContaining(['ok', 'verb', 'url', 'pid', 'cdpEndpoint']),
			);
			const stopSchema = (await schemaOf(['stop'])) as {
				output?: {properties?: Record<string, unknown>};
			};
			expect(Object.keys(stopSchema.output?.properties ?? {})).toEqual(
				expect.arrayContaining(['ok', 'verb', 'stopped']),
			);
		});
	});

	describe('actionable errors name the EXACT fix command (story 17)', () => {
		it('maps the typed missing-browser-binary condition to `playwright install`', async () => {
			const provider = throwingProvider(
				new MissingBrowserBinaryError('chromium'),
			);
			const {code} = await run(provider, ['goto', 'https://example.test/']);
			expect(code).toBe(1);
			const env = await runEnvelope(provider, [
				'goto',
				'https://example.test/',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('missing-browser-binary');
			expect(env.error?.message).toContain('npx playwright install chromium');
		});

		it('maps the typed missing-stealth-dependency condition to `pnpm add patchright`', async () => {
			const provider = throwingProvider(new MissingStealthDependencyError());
			const env = await runEnvelope(provider, [
				'goto',
				'https://example.test/',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('missing-stealth-dependency');
			expect(env.error?.message).toContain('pnpm add patchright');
		});

		it('maps the typed invalid-proxy condition to a SOCKS URL fix hint', async () => {
			const provider = throwingProvider(
				new InvalidProxyError('http://not-socks:1080'),
			);
			const env = await runEnvelope(provider, ['launch']);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('invalid-proxy');
			expect(env.error?.message).toContain('socks5h://host:1080');
		});

		it('maps the typed missing-profile condition to `setup-profile --profile <name>`', async () => {
			const provider = throwingProvider(
				new MissingProfileError('work', '/tmp/iso/profiles/work'),
			);
			const env = await runEnvelope(provider, ['launch', '--profile', 'work']);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('missing-profile');
			expect(env.error?.message).toContain(
				`${CLI_NAME} setup-profile --profile work`,
			);
		});

		it('maps the typed attach-not-chromium condition to a Chromium-only fix', async () => {
			const provider = throwingProvider(new AttachNotChromiumError('firefox'));
			const env = await runEnvelope(provider, [
				'attach',
				'--endpoint',
				'http://127.0.0.1:9222',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('attach-not-chromium');
			expect(env.error?.message).toContain('--remote-debugging-port');
		});

		it('maps the typed attach-no-context condition to an open-a-window fix', async () => {
			const provider = throwingProvider(
				new AttachNoContextError('http://127.0.0.1:9222'),
			);
			const env = await runEnvelope(provider, [
				'attach',
				'--endpoint',
				'http://127.0.0.1:9222',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('attach-no-context');
			expect(env.error?.message).toContain('open a window/tab');
		});

		it('maps the typed no-live-server condition to `serve` (run serve first)', async () => {
			// A verb invocation with NO live server: the default thin-client provider
			// raises NoLiveServerError; the CLI must tell the user to run `serve`
			// first and exit non-zero, never auto-spawn (ADR-0005).
			const provider = throwingProvider(new NoLiveServerError());
			const {code} = await run(provider, ['goto', 'https://example.test/']);
			expect(code).toBe(1);
			const env = await runEnvelope(provider, [
				'goto',
				'https://example.test/',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('no-live-server');
			expect(env.error?.message).toContain(`${CLI_NAME} serve`);
		});

		it('maps the typed session-already-active condition to `stop`', async () => {
			const provider = throwingProvider(new SessionAlreadyActiveError());
			const env = await runEnvelope(provider, ['launch']);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('session-already-active');
			expect(env.error?.message).toContain(`${CLI_NAME} stop`);
		});

		it('maps the typed cross-origin-frame condition (raised by eval --frame) to a same-origin fix', async () => {
			// The cross-origin frame error is raised by the `eval` VERB, not at
			// session open, so it drives the verb-level fail() path. The CLI surfaces
			// its machine-readable code + the loud message with a fix hint.
			const provider = evalRejectingProvider(
				new CrossOriginFrameError('#cross-iframe', {
					frameOrigin: 'https://hcaptcha.com',
					pageOrigin: 'http://127.0.0.1:5000',
				}),
			);
			const env = await runEnvelope(provider, [
				'eval',
				'1 + 1',
				'--frame',
				'#cross-iframe',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('cross-origin-frame');
			expect(env.error?.message).toMatch(/cross-origin/i);
			expect(env.error?.message).toContain('SAME-ORIGIN');
		});

		it('maps the typed screenshot-path-outside-managed-dir condition to a fix', async () => {
			// The managed-dir error is raised by the `screenshot` VERB (a caller --out
			// escaping the managed dir), not at open, so it drives the verb-level
			// fail() path. The CLI surfaces its code + a fix hint.
			const provider = screenshotRejectingProvider(
				new ScreenshotPathError(
					'/etc/evil.png',
					'/home/u/.webhands/screenshots',
				),
			);
			const env = await runEnvelope(provider, [
				'screenshot',
				'--out',
				'/etc/evil.png',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('screenshot-path-outside-managed-dir');
			expect(env.error?.message).toContain('managed');
		});

		it('maps the typed stale-ref condition (raised by click --by-ref) to a re-query fix', async () => {
			// A stale durable ref is raised by the `click` VERB (a --by-ref resolve to
			// zero/many), not at open, so it drives the verb-level fail() path. The CLI
			// surfaces its code + the loud message + a re-query fix hint.
			const provider = clickRejectingProvider(
				new StaleRefError(`p.locator("#buy-charlie")`, 0, 'click'),
			);
			const env = await runEnvelope(provider, [
				'click',
				`p.locator("#buy-charlie")`,
				'--by-ref',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('stale-ref');
			expect(env.error?.message).toMatch(/STALE/);
			expect(env.error?.message).toContain('--with-refs');
		});

		it('does NOT mistake a generic error for a typed condition (falls back to `unknown`)', async () => {
			const provider = throwingProvider(new Error('boom'));
			const env = await runEnvelope(provider, [
				'goto',
				'https://example.test/',
			]);
			expect(env.ok).toBe(false);
			expect(env.error?.code).toBe('unknown');
			expect(env.error?.message).toContain('boom');
		});
	});

	describe('setup-profile HOLDS the headed window open until the user closes it', () => {
		/** A fake session whose close is driven by the test (models the headed window). */
		function heldSession(): {
			session: Session;
			closeIt: () => void;
			closedByCommand: () => boolean;
		} {
			let resolveClosed!: () => void;
			const closedSignal = new Promise<void>((r) => {
				resolveClosed = r;
			});
			let closedByCommand = false;
			const page = {
				async navigate() {},
				async snapshot() {
					return {url: 'stub://x', view: 'accessibility' as const, content: ''};
				},
				async click() {},
				async type() {},
				async eval() {
					return undefined;
				},
				async wait() {},
				async cookies() {
					return [];
				},
				async setCookies() {},
				async query() {
					return [];
				},
				async count() {
					return 0;
				},
				async exists() {
					return false;
				},
				async isVisible() {
					return false;
				},
				async getAttribute() {
					return null;
				},
			};
			const session: Session = {
				page,
				async close() {
					closedByCommand = true;
					resolveClosed();
				},
				waitForClose() {
					return closedSignal;
				},
			};
			return {
				session,
				closeIt: resolveClosed,
				closedByCommand: () => closedByCommand,
			};
		}

		it('does not resolve until the user closes the window, then reports success + the launch cta', async () => {
			const {session, closeIt} = heldSession();
			const location = {
				homeRoot: '/tmp/iso',
				profilesRoot: '/tmp/iso/profiles',
				profileDir: '/tmp/iso/profiles/default',
				profile: 'default',
			};
			const cli = createCli({
				setupProfile: async () => ({session, location}),
			});

			let stdout = '';
			let done = false;
			const serving = cli
				.serve(['setup-profile', '--full-output', '--format', 'json'], {
					stdout: (s) => {
						stdout += s;
					},
					exit: () => {},
					env: {},
				})
				.then(() => {
					done = true;
				});

			// The command must still be BLOCKED on the open window (nothing emitted).
			await new Promise((r) => setTimeout(r, 20));
			expect(done).toBe(false);
			expect(stdout).toBe('');

			// The user closes the window -> the command finishes and reports success.
			closeIt();
			await serving;
			expect(done).toBe(true);

			const env = JSON.parse(stdout) as {
				ok: boolean;
				data?: {profile: string; profileDir: string};
				meta: {cta?: {commands: {command: string}[]}};
			};
			expect(env.ok).toBe(true);
			expect(env.data?.profile).toBe('default');
			expect(env.data?.profileDir).toBe('/tmp/iso/profiles/default');
			// The cta suggests `launch` now that the profile is set up (the command
			// field is the resolved string, e.g. `webhands launch --profile default`).
			expect(
				env.meta.cta?.commands.some((c) => c.command.includes('launch')),
			).toBe(true);
		});
	});

	describe('the verb commands wire to the core seam (wiring, not behaviour)', () => {
		it('dispatches `goto` to the core Page.navigate verb via the provider', async () => {
			const {provider, transport} = stubProvider();
			await run(provider, ['goto', 'https://example.test/']);
			// We assert the WIRING reached the seam (one navigate call), NOT what
			// navigate does — that is the core seam's test.
			expect(transport.calls).toEqual([
				{verb: 'navigate', args: ['https://example.test/']},
			]);
		});

		it('routes `--endpoint` to an attach open and the page verb', async () => {
			const opened: OpenTarget[] = [];
			const provider: SessionProvider = (target) => {
				opened.push(target);
				return new StubTransport().open(target);
			};
			await run(provider, [
				'click',
				"getByRole('button')",
				'--endpoint',
				'http://127.0.0.1:9222',
			]);
			expect(opened).toEqual([
				{mode: 'attach', endpoint: 'http://127.0.0.1:9222'},
			]);
		});

		it('closes the session it opened (no leaked session)', async () => {
			let closed = false;
			const provider: SessionProvider = async (): Promise<Session> => ({
				page: {
					async navigate() {},
					async snapshot() {
						return {url: 'stub://x', view: 'accessibility', content: ''};
					},
					async click() {},
					async type() {},
					async eval() {
						return undefined;
					},
					async wait() {},
					async cookies() {
						return [];
					},
					async setCookies() {},
					async query() {
						return [];
					},
					async count() {
						return 0;
					},
					async exists() {
						return false;
					},
					async isVisible() {
						return false;
					},
					async getAttribute() {
						return null;
					},
				},
				async close() {
					closed = true;
				},
				async waitForClose() {},
			});
			await run(provider, ['goto', 'https://example.test/']);
			expect(closed).toBe(true);
		});
	});
});
