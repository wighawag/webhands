import {spawnSync} from 'node:child_process';
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
		const result = spawnSync('bash', ['-c', command], {
			input: stdin,
			env,
			encoding: 'utf8',
			timeout: input.timeoutMs,
			maxBuffer: 64 * 1024 * 1024,
		});
		const output = (result.stdout ?? '').trim();
		if (result.error !== undefined) {
			const timedOut =
				(result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ||
				result.signal === 'SIGTERM';
			return {
				status: timedOut ? 'timed-out' : 'crashed',
				output,
				detail: result.error.message,
			};
		}
		if ((result.status ?? -1) !== 0) {
			return {
				status: 'crashed',
				output,
				detail: (result.stderr ?? '').trim() || `exit ${result.status}`,
			};
		}
		return {status: 'reported-done', output};
	}
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
