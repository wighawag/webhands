import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import type {EvalEntry} from './eval-contract.js';
import {
	buildAgentInput,
	CDP_ENDPOINT_ENV,
	PLAYWRIGHT_PREAMBLE,
	WEBHANDS_PREAMBLE,
	WEBHANDS_SKILLED_PREAMBLE,
	type ProtocolPreamble,
} from './no-priming.js';
import type {WebhandsCommand} from './verb-client.js';

/**
 * The `AgentUnderTest` LAUNCH SEAM (prd D1; user stories 4, 16), modelled on
 * dorfl's `Harness` seam (`packages/dorfl/src/harness.ts`). It is the DURABLE
 * deliverable: hand it the goal-prompt + the verb-surface reference, it launches
 * a real unaided agent and returns when the agent reports done (or times out).
 *
 * v1 ships ONE implementation, the GENERIC {@link ShellAdapter} (the dorfl
 * `null`-adapter analogue): a REAL agent launcher, not a stub. A pi-native
 * adapter is explicitly OUT OF SCOPE here (a deferred improvement addable behind
 * this same seam without breakage).
 *
 * The D3 scripted self-test is NOT an adapter and does NOT implement this seam:
 * it lives in {@link ./scripted-trace.js} as a pseudo-agent that REPLAYS a fixed
 * primed verb sequence to prove the harness machinery. Keeping it off this seam
 * is what stops a primed script being mistaken for a capability subject.
 */

/** What an adapter needs to launch one agent against one eval. */
export interface LaunchInput {
	/** The eval being run (the goal-prompt + entry URL the no-priming guard reads). */
	readonly entry: EvalEntry;
	/**
	 * How the agent reaches webhands: the SAME command the harness's verb client
	 * uses, so the agent drives the EXISTING surface against the live serve
	 * session (user story 12). Passed through into the agent's env so its
	 * `npx webhands <verb>` calls hit the harness's isolated home.
	 */
	readonly webhands: WebhandsCommand;
	/** The isolated `WEBHANDS_HOME` the agent's verb calls must target. */
	readonly home: string;
	/**
	 * The SHARED driving surface's CDP endpoint, when the harness's serve session
	 * exposed one (a LAUNCH session). Passed to the agent as PROTOCOL via the
	 * {@link CDP_ENDPOINT_ENV} env var (the same env channel `WEBHANDS_HOME`
	 * rides), so the Playwright-only agent `connectOverCDP`-s to the harness's
	 * EXISTING page instead of launching its own (finding
	 * `baseline-comparison-needs-a-shared-driving-surface-not-two-browsers`).
	 * `undefined` when no shared surface was advertised; the webhands config
	 * ignores it (it drives via verbs).
	 */
	readonly cdpEndpoint?: string;
	/** Hard wall-clock cap for the agent run (ms). */
	readonly timeoutMs: number;
	/** Extra env merged into the agent process. */
	readonly env?: NodeJS.ProcessEnv;
}

/**
 * BEST-EFFORT, ADAPTER-SPECIFIC token-usage record for one agent run (the
 * "does webhands deliver?" measure: tokens + pass-rate compared between a
 * webhands agent and a Playwright-only agent against the SAME goal).
 *
 * It is TOOLKIT-AGNOSTIC by construction: nothing here assumes webhands, so a
 * webhands run and a Playwright-only run are comparable on the SAME field. Each
 * count is OPTIONAL because capture is best-effort: an adapter records only the
 * components it can actually observe. A `LaunchResult.usage` of `undefined`
 * means the adapter COULD NOT observe usage at all (an honest "unknown"), and is
 * NEVER a fake zero. A present record with `undefined` components likewise means
 * "that component was not observable", not zero.
 *
 * The shape mirrors the components pi's `--mode json` `usage` events already
 * carry (input / output / cacheRead / cacheWrite / totalTokens / cost) but is a
 * GENERIC accounting record, not pi's wire shape: any adapter that can observe
 * its agent's spend fills the fields it knows.
 */
export interface AgentUsage {
	/** Input (prompt) tokens, if observable. */
	readonly input?: number;
	/** Output (completion) tokens, if observable. */
	readonly output?: number;
	/** Cached tokens read from cache, if the agent reports it (pi `cacheRead`). */
	readonly cacheRead?: number;
	/** Tokens written to cache, if the agent reports it (pi `cacheWrite`). */
	readonly cacheWrite?: number;
	/** Total tokens, if observable (pi `totalTokens`). */
	readonly total?: number;
	/** Monetary cost (currency-agnostic number), if the agent reports it. */
	readonly cost?: number;
}

/** The result of launching an agent: how it ended + its captured output. */
export interface LaunchResult {
	/**
	 * How the run ENDED, from the launcher's view only. This is NOT the verdict:
	 * `reported-done` merely TRIGGERS the harness's own end-state assertion
	 * (prd property 2). `timed-out` / `crashed` are signals the precheck + scorer
	 * fold into pass/fail/INCONCLUSIVE.
	 */
	readonly status: 'reported-done' | 'timed-out' | 'crashed';
	/** The agent's captured stdout (its self-report; the harness never TRUSTS it). */
	readonly output: string;
	/** Failure detail when the run did not end cleanly. */
	readonly detail?: string;
	/**
	 * BEST-EFFORT, ADAPTER-SPECIFIC token usage for this run, or `undefined` when
	 * the adapter could not observe it (an honest unknown, never a fake zero).
	 * Token capture is inherently adapter-specific (an adapter knows its agent's
	 * output shape), so the seam carries the field and each adapter fills it as
	 * far as it honestly can. See {@link AgentUsage}.
	 */
	readonly usage?: AgentUsage;
}

/** The launch seam: an adapter launches a real unaided agent for one eval. */
export interface AgentUnderTest {
	/** A stable adapter name (`shell`, later `pi`), stamped into the report. */
	readonly adapter: string;
	/** Launch the agent for `input.entry` and return when it ends or times out. */
	launch(input: LaunchInput): Promise<LaunchResult>;
}

/**
 * The GENERIC SHELL/COMMAND adapter (prd D1 v1; dorfl `null`-adapter analogue).
 * It shells out to a configured agent command with dorfl's `{model}`
 * substitution, feeds the agent the goal-prompt + the per-adapter PROTOCOL
 * preamble on STDIN ({@link buildAgentInput}, the no-priming enforcement point),
 * and captures stdout. It launches whatever REAL agent the command points at
 * (`claude -p`, `pi --print`, …), so it is a genuine capability subject bound by
 * the no-priming rule, not a stub.
 *
 * The LAUNCH SHAPE is the SAME for the webhands config and the Playwright-only
 * baseline: shell out, feed the wrapped goal on stdin, capture stdout. ONLY the
 * {@link ProtocolPreamble} differs (which toolkit the agent is taught + the
 * toolkit-worded leave-open rule). That is why the seam reuse survives the
 * Playwright-only baseline: the heavier "drive your own Playwright" contract is
 * carried by the PREAMBLE the agent reads, not by a different launch mechanism
 * (recorded decision: the Playwright-only agent drives its OWN Playwright; the
 * harness hands it no page and never routes it through webhands). The webhands
 * config is the default; {@link PlaywrightAdapter} is the same adapter pinned to
 * the Playwright-only preamble + a `playwright` name.
 */
export class ShellAdapter implements AgentUnderTest {
	readonly adapter: string;

	/** The configured agent command, e.g. `claude -p` or `pi --print --model {model}`. */
	private readonly agentCmd: string;
	/** The model to substitute for `{model}` in {@link agentCmd}, if any. */
	private readonly model?: string;
	/**
	 * The per-adapter PROTOCOL preamble composed around the goal on stdin
	 * (toolkit reference + leave-open rule). Defaults to {@link WEBHANDS_PREAMBLE};
	 * the Playwright-only baseline passes {@link PLAYWRIGHT_PREAMBLE}.
	 */
	private readonly preamble: ProtocolPreamble;

	/**
	 * OPT-IN, BEST-EFFORT pi-json usage parsing. When `true`, the adapter sums
	 * the `usage` objects pi's `--mode json` NDJSON events carry into a
	 * {@link AgentUsage} record. It is OFF by default: the generic shell adapter
	 * cannot know an arbitrary command's token usage, so it honestly reports
	 * `usage: undefined` unless told the driven agent emits a parseable stream.
	 * This is a best-effort convenience, NOT a hard dependency on any agent's
	 * output shape: a non-pi command simply yields no parseable events and the
	 * usage stays `undefined`.
	 */
	private readonly parseUsage: boolean;

	constructor(opts: {
		agentCmd: string;
		model?: string;
		parseUsage?: boolean;
		/** Override the adapter NAME stamped into the report (default `shell`). */
		adapter?: string;
		/** The protocol preamble (default {@link WEBHANDS_PREAMBLE}). */
		preamble?: ProtocolPreamble;
	}) {
		this.agentCmd = opts.agentCmd;
		this.model = opts.model;
		this.parseUsage = opts.parseUsage ?? false;
		this.preamble = opts.preamble ?? WEBHANDS_PREAMBLE;
		this.adapter = opts.adapter ?? 'shell';
	}

	async launch(input: LaunchInput): Promise<LaunchResult> {
		// buildAgentInput RUNS the no-priming guard: a primed eval throws here and
		// never launches a real agent. The per-adapter preamble (webhands or
		// Playwright-only) is composed around the toolkit-agnostic goal here.
		const stdin = buildAgentInput(input.entry, this.preamble);
		const command = substituteModel(this.agentCmd, this.model);
		const env: NodeJS.ProcessEnv = {
			...process.env,
			...input.env,
			// The agent drives webhands against the harness's isolated home, the
			// SAME session the harness reads for its verdict.
			WEBHANDS_HOME: input.home,
			// PROTOCOL (not priming): the SHARED driving surface's CDP endpoint, so a
			// Playwright-only agent connectOverCDP-s to the harness's EXISTING page
			// instead of launching its own. Present only when serve advertised one;
			// the webhands config ignores it.
			...(input.cdpEndpoint !== undefined
				? {[CDP_ENDPOINT_ENV]: input.cdpEndpoint}
				: {}),
		};
		return await new Promise<LaunchResult>((resolve) => {
			const child = spawn('bash', ['-c', command], {
				env,
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			let out = '';
			let err = '';
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGTERM');
			}, input.timeoutMs);
			// TEE + LIVE PRETTY-PRINT: capture the agent's stdout for the (untrusted)
			// self-report AND stream a human-readable view to the terminal as it
			// happens, so a human can WATCH the agent work. pi `--mode json` emits one
			// JSON event per line (NDJSON); we render each event compactly. (This is
			// demo-grade tee; a proper pi-native adapter would parse this stream as a
			// first-class capability behind the same seam.)
			// Accumulate a best-effort usage record ONLY when opted in (parseUsage).
			// Off by default => the shell adapter honestly reports usage: undefined.
			const usageAccumulator = this.parseUsage
				? new UsageAccumulator()
				: undefined;
			const rl = createInterface({input: child.stdout});
			rl.on('line', (line) => {
				out += line + '\n';
				if (usageAccumulator !== undefined) {
					usageAccumulator.consumeLine(line);
				}
				process.stdout.write(renderAgentLine(line));
			});
			child.stderr.on('data', (d: Buffer) => {
				err += d.toString();
				process.stderr.write(d);
			});
			// The observed usage (if opted-in AND any usage events were seen);
			// otherwise undefined (honest unknown). Spread so it is only present when
			// actually captured, never a fake zero.
			const usageOf = (): {usage?: AgentUsage} => {
				const u = usageAccumulator?.result();
				return u !== undefined ? {usage: u} : {};
			};
			child.on('error', (e) => {
				clearTimeout(timer);
				resolve({
					status: 'crashed',
					output: out.trim(),
					detail: e.message,
					...usageOf(),
				});
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				const output = out.trim();
				if (timedOut) {
					resolve({
						status: 'timed-out',
						output,
						detail: `agent exceeded ${input.timeoutMs}ms`,
						...usageOf(),
					});
					return;
				}
				if ((code ?? -1) !== 0) {
					resolve({
						status: 'crashed',
						output,
						detail: err.trim() || `exit ${code}`,
						...usageOf(),
					});
					return;
				}
				resolve({status: 'reported-done', output, ...usageOf()});
			});
			child.stdin.write(stdin);
			child.stdin.end();
		});
	}
}

/**
 * The PLAYWRIGHT-ONLY baseline adapter (task
 * `eval-playwright-only-baseline-comparison`). It is the SAME {@link ShellAdapter}
 * launch mechanism pinned to the {@link PLAYWRIGHT_PREAMBLE} and the `playwright`
 * adapter name, so a Playwright-only run is comparable to a webhands run on the
 * SAME goal + the SAME harness end-state assertion: ONLY the agent's toolkit +
 * preamble differ.
 *
 * RECORDED design fork (the load-bearing decision for this task): the
 * Playwright-only agent drives its OWN Playwright. Its process must have
 * Playwright + a browser available and it writes its own automation; the harness
 * does NOT hand it a page. This is a HEAVIER agent contract than the webhands
 * case (where the agent just runs `npx webhands <verb>`), and it is carried
 * entirely by the preamble the agent reads, NOT by a different launch shape, so
 * the generic shell seam still fits. The agent is NEVER routed through the
 * webhands verb surface (that would defeat the baseline). The harness's OWN
 * verdict is unaffected: a webhands serve session stays alive for the harness to
 * read the end state via its read verbs, even though the AGENT never touches
 * webhands ('Playwright-only' constrains the AGENT, not the harness).
 */
export class PlaywrightAdapter extends ShellAdapter {
	constructor(opts: {agentCmd: string; model?: string; parseUsage?: boolean}) {
		super({
			...opts,
			adapter: 'playwright',
			preamble: PLAYWRIGHT_PREAMBLE,
		});
	}
}

/**
 * The WEBHANDS-SKILLED adapter (task `eval-webhands-skill-in-context-variant`):
 * the SAME {@link ShellAdapter} launch mechanism pinned to the
 * {@link WEBHANDS_SKILLED_PREAMBLE} and a `webhands-skilled` adapter name. It
 * drives the EXACT SAME webhands verb surface as the cold {@link ShellAdapter}
 * default; the ONLY difference is that its preamble INLINES the webhands skill
 * text so the agent starts already knowing the surface, instead of discovering
 * it cold via `--llms-full` at runtime (paying the ~37% discovery tax the
 * transcript analysis found). That single-variable difference is what makes a
 * cold-vs-skilled run a clean A/B of the skill's value, and a
 * skilled-vs-Playwright run the FAIR-SHAKE number a real deployment (which has
 * the skill in context) would see. Same launch shape, same goal, same harness
 * end-state assertion: only the up-front knowledge differs.
 */
export class WebhandsSkilledAdapter extends ShellAdapter {
	constructor(opts: {agentCmd: string; model?: string; parseUsage?: boolean}) {
		super({
			...opts,
			adapter: 'webhands-skilled',
			preamble: WEBHANDS_SKILLED_PREAMBLE,
		});
	}
}

/**
 * DEMO-GRADE live renderer for pi's `--mode json` NDJSON event stream: turn one
 * event line into a short human-readable terminal line so a human can WATCH the
 * agent work. Unknown / non-JSON lines pass through verbatim. This is scaffolding
 * for live viewing; a proper pi-native adapter would parse this stream as a
 * first-class capability behind the {@link AgentUnderTest} seam.
 */
export function renderAgentLine(line: string): string {
	const trimmed = line.trim();
	if (trimmed === '') return '';
	let ev: Record<string, unknown>;
	try {
		ev = JSON.parse(trimmed) as Record<string, unknown>;
	} catch {
		return `${line}\n`; // not JSON (e.g. text mode): pass through
	}
	const type = ev.type;
	// TOOL CALL: pi emits `tool_execution_start` once when a tool actually runs
	// (the noisy `message_update` toolcall_start/delta partials are suppressed).
	// Show the tool NAME + a bit of its args, e.g. `\u2192 bash {"command":"..."}`.
	if (type === 'tool_execution_start') {
		const name = (ev.toolName ?? 'tool') as string;
		const args = JSON.stringify(ev.args ?? {});
		return `  \u001b[36m\u2192 ${name}\u001b[0m ${truncate(args, 160)}\n`;
	}
	// TOOL RESULT: `tool_execution_end` carries the result + an isError flag.
	if (type === 'tool_execution_end') {
		const content = stringifyContent(ev.result);
		const mark = ev.isError === true ? '\u001b[31m\u2190!' : '\u001b[90m\u2190';
		return `  ${mark} ${truncate(content, 160)}\u001b[0m\n`;
	}
	// A completed assistant message: show its text (deltas/partials suppressed).
	if (type === 'message_end') {
		const msg = (ev.message ?? {}) as Record<string, unknown>;
		if (msg.role === 'assistant') {
			const text = stringifyContent(msg.content).trim();
			return text === '' ? '' : `\u001b[1m[agent]\u001b[0m ${text}\n`;
		}
		return '';
	}
	// Lifecycle markers worth one line each; everything else (deltas, partials,
	// tool_execution_update) is suppressed to keep the live view readable.
	if (type === 'agent_start')
		return '\u001b[90m[agent starting\u2026]\u001b[0m\n';
	if (type === 'agent_end') return '\u001b[90m[agent done]\u001b[0m\n';
	return '';
}

/** Flatten a message `content` (array of parts or a string) to plain text. */
function stringifyContent(content: unknown): string {
	if (typeof content === 'string') return content;
	// A tool result is `{content: [...]}`; unwrap to the parts array.
	if (
		content !== null &&
		typeof content === 'object' &&
		!Array.isArray(content) &&
		Array.isArray((content as Record<string, unknown>).content)
	) {
		return stringifyContent((content as Record<string, unknown>).content);
	}
	if (Array.isArray(content)) {
		return content
			.map((p) => {
				const part = p as Record<string, unknown>;
				if (part.type === 'text') return part.text as string;
				if (part.type === 'tool_use' || part.type === 'tool_call') {
					return `\u2192 ${part.name as string} ${JSON.stringify(part.input ?? {})}`;
				}
				return '';
			})
			.filter((s) => s !== '')
			.join(' ');
	}
	return '';
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n)}\u2026`;
}

/**
 * BEST-EFFORT accumulator for pi's `--mode json` `usage` events. pi emits one
 * JSON event per line (NDJSON); message events carry a `usage` object with
 * `input` / `output` / `cacheRead` / `cacheWrite` / `totalTokens` / `cost`
 * (confirmed live 2026-06-29). We SUM each numeric component we recognise across
 * all events that carry one. The parsing is DELIBERATELY tolerant: non-JSON
 * lines, JSON without a `usage` object, and unknown components are simply
 * ignored, so this never hard-depends on pi's exact event taxonomy. If NO usage
 * event was ever seen, {@link result} returns `undefined` (honest unknown,
 * never a fabricated zero).
 */
export class UsageAccumulator {
	private sawAny = false;
	private input = 0;
	private output = 0;
	private cacheRead = 0;
	private cacheWrite = 0;
	private total = 0;
	private cost = 0;
	private sawInput = false;
	private sawOutput = false;
	private sawCacheRead = false;
	private sawCacheWrite = false;
	private sawTotal = false;
	private sawCost = false;

	/** Fold one NDJSON line into the running totals (tolerant of anything else). */
	consumeLine(line: string): void {
		const usage = extractUsage(line);
		if (usage === undefined) return;
		this.sawAny = true;
		if (typeof usage.input === 'number') {
			this.input += usage.input;
			this.sawInput = true;
		}
		if (typeof usage.output === 'number') {
			this.output += usage.output;
			this.sawOutput = true;
		}
		if (typeof usage.cacheRead === 'number') {
			this.cacheRead += usage.cacheRead;
			this.sawCacheRead = true;
		}
		if (typeof usage.cacheWrite === 'number') {
			this.cacheWrite += usage.cacheWrite;
			this.sawCacheWrite = true;
		}
		if (typeof usage.totalTokens === 'number') {
			this.total += usage.totalTokens;
			this.sawTotal = true;
		}
		if (typeof usage.cost === 'number') {
			this.cost += usage.cost;
			this.sawCost = true;
		}
	}

	/**
	 * The accumulated usage, or `undefined` if no usage event was ever seen.
	 * Only components actually observed are present; an unseen `total` is
	 * back-filled from input+output when both were observed (a derived, honest
	 * total), never invented from nothing.
	 */
	result(): AgentUsage | undefined {
		if (!this.sawAny) return undefined;
		const usage: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			total?: number;
			cost?: number;
		} = {};
		if (this.sawInput) usage.input = this.input;
		if (this.sawOutput) usage.output = this.output;
		if (this.sawCacheRead) usage.cacheRead = this.cacheRead;
		if (this.sawCacheWrite) usage.cacheWrite = this.cacheWrite;
		if (this.sawTotal) usage.total = this.total;
		else if (this.sawInput && this.sawOutput)
			usage.total = this.input + this.output;
		if (this.sawCost) usage.cost = this.cost;
		return usage;
	}
}

/** The raw `usage` shape pi's `--mode json` events carry (all fields optional). */
interface RawUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: number;
}

/**
 * Pull a `usage` object out of one NDJSON line, anywhere it appears (top-level
 * `usage`, or nested under a `message`). Returns `undefined` for a non-JSON
 * line, JSON without a usage object, or a usage value that is not an object, so
 * the accumulator can stay tolerant.
 */
export function extractUsage(line: string): RawUsage | undefined {
	const trimmed = line.trim();
	if (trimmed === '') return undefined;
	let ev: unknown;
	try {
		ev = JSON.parse(trimmed);
	} catch {
		return undefined;
	}
	if (ev === null || typeof ev !== 'object') return undefined;
	const record = ev as Record<string, unknown>;
	const direct = asUsage(record.usage);
	if (direct !== undefined) return direct;
	const message = record.message;
	if (message !== null && typeof message === 'object') {
		return asUsage((message as Record<string, unknown>).usage);
	}
	return undefined;
}

/** Narrow an unknown value to a {@link RawUsage}, keeping only numeric fields. */
function asUsage(value: unknown): RawUsage | undefined {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const v = value as Record<string, unknown>;
	const usage: RawUsage = {};
	let any = false;
	for (const key of [
		'input',
		'output',
		'cacheRead',
		'cacheWrite',
		'totalTokens',
		'cost',
	] as const) {
		const n = v[key];
		if (typeof n === 'number' && Number.isFinite(n)) {
			usage[key] = n;
			any = true;
		}
	}
	return any ? usage : undefined;
}

/** The `{model}` placeholder the shell adapter substitutes (dorfl's pattern). */
export const MODEL_PLACEHOLDER = '{model}';

/**
 * Inject the model routing intent into the agent command (dorfl's
 * `substituteModel`): `{model}` present + model set ⇒ substitute; `{model}`
 * present + model unset ⇒ a clear config error (never emit a literal `{model}`
 * to the shell); `{model}` absent ⇒ return as-is. Model routing is OFFERED via
 * the command string, not a tool-specific flag, so any agent invocable as a
 * shell command can be pinned for comparability.
 */
export function substituteModel(
	command: string,
	model: string | undefined,
): string {
	if (!command.includes(MODEL_PLACEHOLDER)) {
		return command;
	}
	if (model === undefined || model === '') {
		throw new Error(
			`agentCmd contains a ${MODEL_PLACEHOLDER} placeholder but no model is ` +
				`configured. Set a model or remove ${MODEL_PLACEHOLDER} from agentCmd.`,
		);
	}
	return command.split(MODEL_PLACEHOLDER).join(model);
}
