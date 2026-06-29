import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AgentUnderTest, LaunchResult} from './agent-under-test.js';
import type {EvalEntry} from './eval-contract.js';
import {evaluateOutcome, type Outcome} from './outcome.js';
import {startServe, type ServeLaunchOptions} from './serve-lifecycle.js';
import {VerbClient, type WebhandsCommand} from './verb-client.js';

/**
 * The harness SPINE: run ONE eval end to end and score it (prd user stories 1,
 * 12). It is the thin-but-complete vertical path every per-tier eval task later
 * plugs into.
 *
 * The flow, in order:
 *  1. make an ISOLATED `WEBHANDS_HOME` temp root (so the real `~/.webhands` is
 *     never touched, ADR-0005 shared-write note);
 *  2. start the harness-owned `serve` session against it (ADR-0005: the harness
 *     OWNS serve start/stop; a verb never auto-spawns);
 *  3. launch the unaided agent through the {@link AgentUnderTest} seam, handing
 *     it ONLY the goal-prompt + verb-surface reference (the no-priming guard);
 *  4. make the harness's OWN end-state assertion via the read verbs and fold it
 *     into the three-state pass/fail/INCONCLUSIVE outcome with the precheck +
 *     bounded retry;
 *  5. ALWAYS tear the serve session down and clean the temp home.
 */

/** The full result of running one eval. */
export interface EvalRunResult {
	/** The eval that ran. */
	readonly entry: EvalEntry;
	/** Which adapter launched the agent. */
	readonly adapter: string;
	/** How the agent launch ended (its self-report only TRIGGERED the verdict). */
	readonly launch: LaunchResult;
	/** The harness's INDEPENDENT three-state outcome. */
	readonly outcome: Outcome;
}

/** Config for one eval run. */
export interface RunEvalOptions {
	/** The eval to run. */
	readonly entry: EvalEntry;
	/** How to invoke webhands (the published CLI; the harness adds no verb). */
	readonly webhands: WebhandsCommand;
	/** The agent launcher (v1: the generic shell adapter). */
	readonly agent: AgentUnderTest;
	/** The `serve` launch options forwarded to ADR-0005's serve (profile/proxy/…). */
	readonly serve?: ServeLaunchOptions;
	/** Hard wall-clock cap for the AGENT run (ms). Default 10 min. */
	readonly agentTimeoutMs?: number;
	/** Max attempts when INCONCLUSIVE. Default 3. */
	readonly maxAttempts?: number;
	/**
	 * An explicit isolated home root. When omitted, a fresh temp dir is minted and
	 * removed after the run. Pass one (and `keepHome`) to inspect a failed run.
	 */
	readonly home?: string;
	/**
	 * Force-keep the isolated home after the run. By default the home is removed
	 * only on a clean PASS; a FAIL/INCONCLUSIVE KEEPS it for inspection (mirrors
	 * the prd D2 "keep evidence on a non-pass" stance at the home-dir level). Set
	 * `true` to keep it even on PASS.
	 */
	readonly keepHome?: boolean;
	/** Extra env merged into every spawned webhands/agent process. */
	readonly env?: NodeJS.ProcessEnv;
}

/**
 * Run one eval end to end. Owns the serve lifecycle and the temp-home isolation
 * around the run, so a caller just supplies the eval + the agent + how to invoke
 * webhands. The agent's launch outcome is recorded but the VERDICT is always the
 * harness's own verb-checked {@link evaluateOutcome}.
 */
export async function runEval(opts: RunEvalOptions): Promise<EvalRunResult> {
	const ownsHome = opts.home === undefined;
	const home = opts.home ?? (await mkdtemp(join(tmpdir(), 'webhands-eval-')));
	if (ownsHome) {
		// A warmed profile dir under the isolated home, so `serve --profile default`
		// has somewhere to launch (the foundation warms an EMPTY profile; per-tier
		// tasks may pre-seed a logged-in one).
		await mkdir(join(home, 'profiles', opts.serve?.profile ?? 'default'), {
			recursive: true,
		});
	}

	const serveSession = await startServe({
		webhands: opts.webhands,
		home,
		launch: opts.serve,
		...(opts.env !== undefined ? {env: opts.env} : {}),
	});

	try {
		const launch = await opts.agent.launch({
			entry: opts.entry,
			webhands: opts.webhands,
			home,
			timeoutMs: opts.agentTimeoutMs ?? 10 * 60_000,
			...(opts.env !== undefined ? {env: opts.env} : {}),
		});

		const verbs = new VerbClient({
			webhands: opts.webhands,
			home,
			...(opts.env !== undefined ? {env: opts.env} : {}),
		});

		const outcome = await evaluateOutcome({
			entry: opts.entry,
			verbs,
			...(opts.maxAttempts !== undefined
				? {maxAttempts: opts.maxAttempts}
				: {}),
		});

		return {entry: opts.entry, adapter: opts.agent.adapter, launch, outcome};
		// Assert FIRST, clean SECOND (prd D2 ordering): only a clean PASS removes the
		// isolated home; a FAIL/INCONCLUSIVE KEEPS it for inspection. Destroying
		// evidence on failure is the wrong default.
		if (ownsHome && !opts.keepHome && outcome.kind === 'PASS') {
			await rm(home, {recursive: true, force: true});
		}
		return {entry: opts.entry, adapter: opts.agent.adapter, launch, outcome};
	} finally {
		await serveSession.stop();
	}
}
