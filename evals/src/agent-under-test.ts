import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import type {EvalEntry} from './eval-contract.js';
import {buildAgentInput} from './no-priming.js';
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
	/** Hard wall-clock cap for the agent run (ms). */
	readonly timeoutMs: number;
	/** Extra env merged into the agent process. */
	readonly env?: NodeJS.ProcessEnv;
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
 * substitution, feeds the agent the goal-prompt + verb-surface reference on
 * STDIN ({@link buildAgentInput}, the no-priming enforcement point), and
 * captures stdout. It launches whatever REAL agent the command points at
 * (`claude -p`, `pi --print`, …), so it is a genuine capability subject bound by
 * the no-priming rule, not a stub.
 */
export class ShellAdapter implements AgentUnderTest {
	readonly adapter = 'shell';

	/** The configured agent command, e.g. `claude -p` or `pi --print --model {model}`. */
	private readonly agentCmd: string;
	/** The model to substitute for `{model}` in {@link agentCmd}, if any. */
	private readonly model?: string;

	constructor(opts: {agentCmd: string; model?: string}) {
		this.agentCmd = opts.agentCmd;
		this.model = opts.model;
	}

	async launch(input: LaunchInput): Promise<LaunchResult> {
		// buildAgentInput RUNS the no-priming guard: a primed eval throws here and
		// never launches a real agent.
		const stdin = buildAgentInput(input.entry);
		const command = substituteModel(this.agentCmd, this.model);
		const env: NodeJS.ProcessEnv = {
			...process.env,
			...input.env,
			// The agent drives webhands against the harness's isolated home, the
			// SAME session the harness reads for its verdict.
			WEBHANDS_HOME: input.home,
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
			const rl = createInterface({input: child.stdout});
			rl.on('line', (line) => {
				out += line + '\n';
				process.stdout.write(renderAgentLine(line));
			});
			child.stderr.on('data', (d: Buffer) => {
				err += d.toString();
				process.stderr.write(d);
			});
			child.on('error', (e) => {
				clearTimeout(timer);
				resolve({status: 'crashed', output: out.trim(), detail: e.message});
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				const output = out.trim();
				if (timedOut) {
					resolve({
						status: 'timed-out',
						output,
						detail: `agent exceeded ${input.timeoutMs}ms`,
					});
					return;
				}
				if ((code ?? -1) !== 0) {
					resolve({
						status: 'crashed',
						output,
						detail: err.trim() || `exit ${code}`,
					});
					return;
				}
				resolve({status: 'reported-done', output});
			});
			child.stdin.write(stdin);
			child.stdin.end();
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
		return `${line}\n`; // not JSON (e.g. text mode) — pass through
	}
	const type = ev.type;
	// A completed assistant or tool message: show role + a compact content summary.
	if (type === 'message_end' || type === 'tool_call' || type === 'tool_result') {
		const msg = (ev.message ?? ev) as Record<string, unknown>;
		if (type === 'tool_call') {
			const name = (ev.name ?? msg.name ?? 'tool') as string;
			const args = JSON.stringify(ev.arguments ?? ev.input ?? msg.arguments ?? {});
			return `  \u001b[36m\u2192 ${name}\u001b[0m ${truncate(args, 160)}\n`;
		}
		if (type === 'tool_result') {
			const content = stringifyContent(msg.content ?? ev.result);
			return `  \u001b[90m\u2190 ${truncate(content, 160)}\u001b[0m\n`;
		}
		const role = msg.role as string | undefined;
		if (role === 'assistant') {
			const text = stringifyContent(msg.content).trim();
			return text === '' ? '' : `\u001b[1m[agent]\u001b[0m ${text}\n`;
		}
		return '';
	}
	// Lifecycle markers worth one line each; everything else (deltas, partials) is
	// suppressed to keep the live view readable.
	if (type === 'agent_start') return '\u001b[90m[agent starting\u2026]\u001b[0m\n';
	if (type === 'agent_end') return '\u001b[90m[agent done]\u001b[0m\n';
	return '';
}

/** Flatten a message `content` (array of parts or a string) to plain text. */
function stringifyContent(content: unknown): string {
	if (typeof content === 'string') return content;
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
