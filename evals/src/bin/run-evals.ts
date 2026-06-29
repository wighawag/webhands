import {ShellAdapter} from '../agent-under-test.js';
import {runEval} from '../run-eval.js';
import type {WebhandsCommand} from '../verb-client.js';
import type {EvalEntry} from '../eval-contract.js';

/**
 * The harness's OWN runner command (task: "The harness has its OWN runner
 * command ... an `evals/` script invoked directly, NOT wired into any
 * `packages/*` `test` script and NOT added to the gate"). Invoked via this
 * package's `run-eval` script.
 *
 * It runs ONE real-site eval against a REAL agent (the generic shell adapter,
 * D1). It is OPT-IN and live-by-nature: it shells to a third-party site and a
 * real agent command, so it can never be in the gate. The foundation ships no
 * real-site catalogue entry (those are the per-tier tasks), so this runner is
 * the spine they plug a `--eval <id>` into; run with `--help` for usage.
 *
 * The DETERMINISTIC machinery proof is the SEPARATE D3 self-test
 * (`pnpm --filter @webhands/evals self-test`), against the LOCAL fixture, never
 * a real site and never a capability pass.
 */

const HELP = `webhands eval runner (opt-in, live-by-nature, NON-GATING)

Runs ONE capability eval against a REAL site with a REAL unaided agent (the
generic shell adapter, prd D1). NEVER part of \`pnpm test\` / the verify gate.

Usage:
  pnpm --filter @webhands/evals run-eval --eval <id> --agent-cmd "<command>" [options]

Options:
  --eval <id>          The catalogue eval id to run (a *.eval.ts entry).
  --agent-cmd "<cmd>"  The shell command that launches the unaided agent. The
                       goal-prompt is fed on its stdin. Use {model} for the
                       model-pinning substitution (dorfl's pattern).
  --model <model>      The model to substitute for {model} in --agent-cmd.
  --webhands "<cmd>"   How to invoke webhands (default: \`npx webhands\`).
  --max-attempts <n>   Bounded retries on INCONCLUSIVE (default 3).
  --help               Show this help.

The foundation ships no real-site catalogue entry; the per-tier eval tasks
(SauceDemo / stateful / Magento) add the \`*.eval.ts\` entries this runner loads.
The deterministic machinery proof is the SEPARATE self-test (\`self-test\`).`;

interface Args {
	readonly eval?: string;
	readonly agentCmd?: string;
	readonly model?: string;
	readonly webhands?: string;
	readonly maxAttempts?: number;
	readonly help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
	let evalId: string | undefined;
	let agentCmd: string | undefined;
	let model: string | undefined;
	let webhands: string | undefined;
	let maxAttempts: number | undefined;
	let help = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case '--eval':
				evalId = argv[++i];
				break;
			case '--agent-cmd':
				agentCmd = argv[++i];
				break;
			case '--model':
				model = argv[++i];
				break;
			case '--webhands':
				webhands = argv[++i];
				break;
			case '--max-attempts':
				maxAttempts = Number.parseInt(argv[++i] ?? '', 10);
				break;
			case '--help':
			case '-h':
				help = true;
				break;
			default:
				throw new Error(`unknown argument: ${a}`);
		}
	}
	return {
		...(evalId !== undefined ? {eval: evalId} : {}),
		...(agentCmd !== undefined ? {agentCmd} : {}),
		...(model !== undefined ? {model} : {}),
		...(webhands !== undefined ? {webhands} : {}),
		...(maxAttempts !== undefined ? {maxAttempts} : {}),
		help,
	};
}

/** Split a `--webhands`/`--agent-cmd` string into command + leading args. */
function asWebhandsCommand(raw: string | undefined): WebhandsCommand {
	if (raw === undefined || raw.trim() === '') {
		// Default to the published path the README leads with.
		return {command: 'npx', args: ['--yes', 'webhands']};
	}
	const parts = raw.trim().split(/\s+/);
	return {command: parts[0], args: parts.slice(1)};
}

/**
 * Load a catalogue eval entry by id. The foundation ships only the self-test
 * BUILDER (which needs a live fixture URL, so it is not runnable as a real-site
 * eval here); real-site STATIC entries are added by the per-tier tasks. Until
 * one exists, this throws a clear, actionable error.
 */
async function loadEval(_id: string): Promise<EvalEntry> {
	throw new Error(
		'no real-site catalogue eval is registered yet: the foundation ships only ' +
			'the local-fixture self-test (run `self-test`). Add a `*.eval.ts` ' +
			'real-site entry (a per-tier task) and register it here to run it.',
	);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || args.eval === undefined) {
		process.stdout.write(`${HELP}\n`);
		process.exit(args.help ? 0 : 1);
	}
	if (args.agentCmd === undefined || args.agentCmd.trim() === '') {
		process.stderr.write(
			'error: --agent-cmd is required (the shell command that launches the ' +
				'unaided agent).\n',
		);
		process.exit(1);
	}

	const entry = await loadEval(args.eval);
	const agent = new ShellAdapter({
		agentCmd: args.agentCmd,
		...(args.model !== undefined ? {model: args.model} : {}),
	});
	const result = await runEval({
		entry,
		webhands: asWebhandsCommand(args.webhands),
		agent,
		...(args.maxAttempts !== undefined ? {maxAttempts: args.maxAttempts} : {}),
	});

	const {outcome} = result;
	process.stdout.write(
		`${entry.id} [${entry.tier}] -> ${outcome.kind} ` +
			`(milestones ${outcome.score.milestonesReached.length}/${outcome.score.milestoneTotal}` +
			`${outcome.score.milestonesReached.length > 0 ? ': ' + outcome.score.milestonesReached.join(', ') : ''})` +
			`${outcome.inconclusiveReason !== undefined ? ` [${outcome.inconclusiveReason}]` : ''}\n`,
	);
	// A capability FAIL is a real signal but not a CRASH: exit 0 on PASS, 1 on
	// FAIL, 2 on INCONCLUSIVE, so a scheduler can route on the three states.
	process.exit(outcome.kind === 'PASS' ? 0 : outcome.kind === 'FAIL' ? 1 : 2);
}

void main().catch((cause: unknown) => {
	process.stderr.write(
		`eval runner failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
	);
	process.exit(3);
});
