import {describe, expect, it} from 'vitest';
import {
	StubTransport,
	MissingBrowserBinaryError,
	MissingProfileError,
	AttachNotChromiumError,
	AttachNoContextError,
	type OpenTarget,
	type Session,
} from '@my-browser-controller/core';
import {createCli, CLI_NAME, type SessionProvider} from '../src/index.js';

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

/** Run a command through `serve`, capturing stdout and exit code (no real process exit). */
async function run(
	provider: SessionProvider,
	argv: string[],
): Promise<{stdout: string; code: number}> {
	const cli = createCli({sessionProvider: provider});
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
): Promise<{
	ok: boolean;
	data?: unknown;
	error?: {code: string; message: string};
	meta: {cta?: {commands: {command: string}[]}};
}> {
	const {stdout} = await run(provider, [
		...argv,
		'--full-output',
		'--format',
		'json',
	]);
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
				},
				async close() {
					closed = true;
				},
			});
			await run(provider, ['goto', 'https://example.test/']);
			expect(closed).toBe(true);
		});
	});
});
