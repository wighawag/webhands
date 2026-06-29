import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {WebhandsCommand} from './verb-client.js';

const run = promisify(execFile);

/**
 * The DETERMINISTIC SCRIPTED-RUN self-test pseudo-agent (prd D3).
 *
 * This is NOT an {@link ./agent-under-test.js#AgentUnderTest} adapter and NOT a
 * capability subject: it replays a FIXED, PRIMED sequence of `webhands <verb>`
 * calls as if it were an agent's trace, so the harness's OWN logic (contract
 * parsing, the end-state assertion, milestone scoring, the pass/fail/
 * INCONCLUSIVE decision, the precheck) can be exercised deterministically and
 * for free against a LOCAL FIXTURE.
 *
 * It is PRIMED by construction (it is GIVEN the exact verb steps + selectors the
 * no-priming rule forbids a real agent), so a green scripted run is NEVER a
 * capability pass. Keeping it SEPARATE from the shell adapter is the whole point
 * (prd D3): the shell adapter launches a real agent; this replays a script.
 */

/** One step in a scripted trace: a webhands verb + its args (selectors allowed). */
export interface TraceStep {
	/** The verb to run (e.g. `goto`, `click`, `type`). */
	readonly verb: string;
	/** The verb's positional + flag args (PRIMED: selectors are expected here). */
	readonly args: readonly string[];
}

/** A named, fixed scripted trace (known-good or known-bad). */
export interface ScriptedTrace {
	/** A label for the report (e.g. `known-good`, `known-bad`). */
	readonly label: string;
	/** The ordered, PRIMED verb steps to replay. */
	readonly steps: readonly TraceStep[];
}

/** Config for replaying a trace against the live served session. */
export interface ReplayOptions {
	/** How to invoke webhands (the same command the harness uses). */
	readonly webhands: WebhandsCommand;
	/** The isolated `WEBHANDS_HOME` the trace drives against. */
	readonly home: string;
	/** Per-step timeout (ms). Default 30s. */
	readonly timeoutMs?: number;
	/** Extra env merged into each verb process. */
	readonly env?: NodeJS.ProcessEnv;
}

/** What replaying a trace produced (the pseudo-agent's "self-report"). */
export interface ReplayResult {
	/** The trace label that was replayed. */
	readonly label: string;
	/** Whether every step exited cleanly (a transport-level signal, NOT a verdict). */
	readonly completed: boolean;
	/** The concatenated stdout of the steps (the pseudo-agent's output channel). */
	readonly output: string;
	/** Detail of the first failing step, if any. */
	readonly detail?: string;
}

/**
 * Replay a fixed PRIMED trace step by step against the live served page. Each
 * step shells out to `webhands <verb> ...args`, pinning `WEBHANDS_HOME` to the
 * isolated root. Acting verbs are used freely here (this is the pseudo-AGENT, it
 * is what DRIVES the page); the harness still makes its verdict independently
 * afterwards via the read-verb end-state assertion. Stops at the first failing
 * step and reports it.
 */
export async function replayTrace(
	trace: ScriptedTrace,
	opts: ReplayOptions,
): Promise<ReplayResult> {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		...opts.env,
		WEBHANDS_HOME: opts.home,
	};
	const outputs: string[] = [];
	for (const step of trace.steps) {
		const argv = [...opts.webhands.args, step.verb, ...step.args];
		try {
			const result = await run(opts.webhands.command, argv, {
				env,
				timeout: opts.timeoutMs ?? 30_000,
				maxBuffer: 32 * 1024 * 1024,
			});
			outputs.push(result.stdout);
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			return {
				label: trace.label,
				completed: false,
				output: outputs.join('\n'),
				detail: `step '${step.verb}' failed: ${detail}`,
			};
		}
	}
	return {label: trace.label, completed: true, output: outputs.join('\n')};
}
