import {
	PlaywrightAdapter,
	ShellAdapter,
	WebhandsSkilledAdapter,
	WebhandsScriptForwardAdapter,
	WebhandsColdCtaAdapter,
	type AgentUnderTest,
} from '../agent-under-test.js';
import {
	formatComparison,
	formatUsage,
	runEval,
	type ComparisonResult,
	type EvalRunResult,
} from '../run-eval.js';
import type {WebhandsCommand} from '../verb-client.js';
import type {EvalEntry} from '../eval-contract.js';
import {saucedemoCoreFlowEval} from '../catalogue/saucedemo-core-flow.eval.js';
import {saucedemoDiscoveryEval} from '../catalogue/saucedemo-discovery.eval.js';
import {buildParabankTransferEval} from '../catalogue/parabank-transfer.eval.js';
import {magentoCheckoutEval} from '../catalogue/magento-checkout.eval.js';

/**
 * The real-site catalogue: `*.eval.ts` entries this runner can launch by id (one
 * file per eval, work/ contract rule 2: no shared manifest, so this is just an
 * id->builder lookup over the imported modules, not a config file). Each value
 * is a BUILDER `() => EvalEntry` invoked fresh per run: a STATIC entry (Tier-1
 * SauceDemo) is wrapped as a constant builder; a per-run NONCE-tagged entry
 * (Tier-2 ParaBank, prd D2) mints a fresh nonce on every invocation, so re-runs
 * are independent. The local-fixture self-test builder is deliberately NOT here:
 * it needs a live fixture URL and is driven only by the D3 self-test, never as a
 * real-site eval.
 */
const CATALOGUE: Readonly<Record<string, () => EvalEntry>> = {
	[saucedemoCoreFlowEval.id]: () => saucedemoCoreFlowEval,
	[saucedemoDiscoveryEval.id]: () => saucedemoDiscoveryEval,
	// Tier-2 ParaBank: a per-run builder, fresh nonce-tagged identity each launch.
	'parabank-transfer': () => buildParabankTransferEval(),
	// Tier-3 Magento (Luma): a STATIC, no-account guest flow on a messy real DOM.
	[magentoCheckoutEval.id]: () => magentoCheckoutEval,
};

/**
 * The harness's OWN runner command (task: "The harness has its OWN runner
 * command ... an `evals/` script invoked directly, NOT wired into any
 * `packages/*` `test` script and NOT added to the gate"). Invoked via this
 * package's `run-eval` script.
 *
 * It runs ONE real-site eval against a REAL agent (the generic shell adapter,
 * D1). It is OPT-IN and live-by-nature: it shells to a third-party site and a
 * real agent command, so it can never be in the gate. The per-tier eval tasks
 * register their `*.eval.ts` entries in {@link CATALOGUE} (the Tier-1 SauceDemo
 * core-flow + discovery evals are the first); run with `--help` for usage.
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
  pnpm --filter @webhands/evals run-eval --eval <id> --compare \\
      --agent-cmd "<webhands-agent-cmd>" --playwright-cmd "<playwright-agent-cmd>"
  pnpm --filter @webhands/evals run-eval --eval <id> --compare3 \\
      --agent-cmd "<webhands-agent-cmd>" --playwright-cmd "<playwright-agent-cmd>"

Options:
  --eval <id>          The catalogue eval id to run (a *.eval.ts entry).
  --agent-cmd "<cmd>"  The shell command that launches the unaided agent. The
                       goal-prompt (wrapped in the per-adapter protocol
                       preamble) is fed on its stdin. Use {model} for the
                       model-pinning substitution (dorfl's pattern). In
                       --compare mode this is the WEBHANDS agent command.
  --agent-kind <kind>  Which agent config to launch: \`webhands\` (default, the
                       COLD config: the agent drives the published webhands verb
                       surface and discovers it at runtime via \`--llms-full\`),
                       \`webhands-cold-cta\` (the SAME cold config but with
                       \`WEBHANDS_CTA=1\` pinned in the agent env so the
                       now-default-OFF per-result CTA hints are forced back ON,
                       reproducing the pre-flip surface the original four-way
                       scoreboard measured; \`cold-cta - cold\` isolates the CTA
                       cost), \`webhands-skilled\` (the SAME verb surface, but the
                       preamble INLINES the use-webhands skill so the agent
                       starts knowing the surface), or \`playwright\` (the
                       BASELINE: the agent drives its OWN raw Playwright, never
                       webhands). Only the agent's toolkit + protocol preamble
                       (and, for cold-cta, the pinned CTA env) differ; the eval
                       goal and the harness's end-state assertion are identical
                       across all of them.
  --compare            Run the SAME eval under the cold webhands + Playwright-only
                       configs and print a side-by-side comparison of outcome +
                       milestones + tokens (the "does webhands deliver?"
                       scoreboard). Requires --agent-cmd (webhands) and
                       --playwright-cmd (Playwright-only).
  --compare3           Run the SAME eval under ALL THREE configs (webhands-cold +
                       webhands-skilled + Playwright-only) and print a three-way
                       side-by-side comparison on identical fields. cold->skilled
                       is the SKILL's value; skilled-vs-Playwright is the
                       fair-shake number. Requires --agent-cmd (the cold/skilled
                       webhands agent, reused for the skilled leg unless
                       --skilled-cmd is given) and --playwright-cmd.
  --skilled-cmd "<cmd>"
                       The shell command that launches the webhands-SKILLED agent
                       (used in --compare3, or as the agent command when
                       --agent-kind webhands-skilled is set without --agent-cmd).
                       Defaults to --agent-cmd: the skilled leg drives the SAME
                       webhands surface as the cold leg; only the preamble
                       differs.
  --playwright-cmd "<cmd>"
                       The shell command that launches the Playwright-only
                       baseline agent (used in --compare/--compare3 mode, or as
                       the agent command when --agent-kind playwright is set
                       without --agent-cmd).
  --model <model>      The model to substitute for {model} in the agent
                       command(s).
  --parse-usage        OPT-IN, BEST-EFFORT: sum token usage from the agent's
                       stdout when it is a pi \`--mode json\` stream (whose
                       events carry a \`usage\` object). Off by default: the
                       generic shell adapter cannot know an arbitrary command's
                       usage, so it honestly reports \`tokens: unknown\`. A
                       non-pi command simply yields no parseable events.
  --webhands "<cmd>"   How to invoke webhands (default: \`npx webhands\`).
  --max-attempts <n>   Bounded retries on INCONCLUSIVE (default 3).
  --headed             Show the browser window (default headless) so a human
                       can WATCH the agent drive the site live.
  --help               Show this help.

Registered real-site evals:
  saucedemo-core-flow   Tier-1 SauceDemo: log in, sort by price, add the
                        cheapest item, complete checkout (end state: the
                        order-complete confirmation).
  saucedemo-discovery   Tier-1 SauceDemo: complete a purchase starting from the
                        broken \`problem_user\` account, which requires noticing
                        the breakage and switching to a working demo account.
  parabank-transfer     Tier-2 ParaBank: register a NEW account, open a second
                        account, transfer a per-run nonce-tagged amount between
                        them, and confirm it (end state: the nonce-tagged
                        transaction is present in an account's activity). A fresh
                        nonce-tagged identity is minted each run (prd D2).
  magento-checkout      Tier-3 Magento demo (Luma): as a GUEST (no account),
                        search for a jacket, open a product, add it to the cart,
                        and reach the checkout (end state: the checkout page is
                        reached with the item in the cart). The messy-real DOM
                        regression catcher; a down/Cloudflare-blocked Magento
                        reports INCONCLUSIVE, never a capability fail.

The deterministic machinery proof is the SEPARATE self-test (\`self-test\`).`;

type AgentKind =
	| 'webhands'
	| 'webhands-cold-cta'
	| 'webhands-skilled'
	| 'webhands-script-forward'
	| 'playwright';

const AGENT_KINDS: readonly AgentKind[] = [
	'webhands',
	'webhands-cold-cta',
	'webhands-skilled',
	'webhands-script-forward',
	'playwright',
];

interface Args {
	readonly eval?: string;
	readonly agentCmd?: string;
	readonly skilledCmd?: string;
	readonly playwrightCmd?: string;
	readonly agentKind: AgentKind;
	readonly compare: boolean;
	readonly compare3: boolean;
	readonly model?: string;
	readonly webhands?: string;
	readonly maxAttempts?: number;
	readonly headed: boolean;
	readonly parseUsage: boolean;
	readonly help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
	let evalId: string | undefined;
	let agentCmd: string | undefined;
	let skilledCmd: string | undefined;
	let playwrightCmd: string | undefined;
	let agentKind: AgentKind = 'webhands';
	let compare = false;
	let compare3 = false;
	let model: string | undefined;
	let webhands: string | undefined;
	let maxAttempts: number | undefined;
	let headed = false;
	let parseUsage = false;
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
			case '--skilled-cmd':
				skilledCmd = argv[++i];
				break;
			case '--playwright-cmd':
				playwrightCmd = argv[++i];
				break;
			case '--agent-kind': {
				const kind = argv[++i];
				if (!AGENT_KINDS.includes(kind as AgentKind)) {
					throw new Error(
						`--agent-kind must be one of ${AGENT_KINDS.map(
							(k) => `'${k}'`,
						).join(', ')} (got '${kind}')`,
					);
				}
				agentKind = kind as AgentKind;
				break;
			}
			case '--compare':
				compare = true;
				break;
			case '--compare3':
				compare3 = true;
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
			case '--headed':
				headed = true;
				break;
			case '--parse-usage':
				parseUsage = true;
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
		...(skilledCmd !== undefined ? {skilledCmd} : {}),
		...(playwrightCmd !== undefined ? {playwrightCmd} : {}),
		agentKind,
		compare,
		compare3,
		...(model !== undefined ? {model} : {}),
		...(webhands !== undefined ? {webhands} : {}),
		...(maxAttempts !== undefined ? {maxAttempts} : {}),
		headed,
		parseUsage,
		help,
	};
}

/**
 * Build the agent adapter for one config. The webhands-COLD config drives the
 * published verb surface and discovers it at runtime (the {@link ShellAdapter}
 * default preamble); webhands-SKILLED drives the SAME verb surface but its
 * preamble INLINES the skill ({@link WebhandsSkilledAdapter}), so it starts
 * knowing the surface; the Playwright-only baseline drives raw Playwright via the
 * {@link PlaywrightAdapter} (its preamble teaches Playwright, never webhands).
 * All three are the SAME shell launch shape; only the toolkit + preamble differ.
 */
function buildAgent(
	kind: AgentKind,
	cmd: string,
	model: string | undefined,
	parseUsage: boolean,
): AgentUnderTest {
	const opts = {
		agentCmd: cmd,
		...(model !== undefined ? {model} : {}),
		...(parseUsage ? {parseUsage: true} : {}),
	};
	switch (kind) {
		case 'playwright':
			return new PlaywrightAdapter(opts);
		case 'webhands-skilled':
			return new WebhandsSkilledAdapter(opts);
		case 'webhands-script-forward':
			return new WebhandsScriptForwardAdapter(opts);
		case 'webhands-cold-cta':
			return new WebhandsColdCtaAdapter(opts);
		case 'webhands':
			return new ShellAdapter(opts);
	}
}

/** Format ONE run's result line (shared by single-run and the comparison legs). */
function formatRunLine(result: EvalRunResult): string {
	const {entry, outcome} = result;
	return (
		`${entry.id} [${entry.tier}] (${result.adapter}) -> ${outcome.kind} ` +
		`(milestones ${outcome.score.milestonesReached.length}/${outcome.score.milestoneTotal}` +
		`${outcome.score.milestonesReached.length > 0 ? ': ' + outcome.score.milestonesReached.join(', ') : ''})` +
		`${outcome.inconclusiveReason !== undefined ? ` [${outcome.inconclusiveReason}]` : ''}` +
		` [${formatUsage(result.launch.usage)}]`
	);
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
 * Load a real-site catalogue eval entry by id from {@link CATALOGUE}. Throws a
 * clear, actionable error (listing the known ids) when the id is unknown, so a
 * typo or an unregistered entry fails fast before any serve/agent is launched.
 */
async function loadEval(id: string): Promise<EvalEntry> {
	const builder = CATALOGUE[id];
	if (builder === undefined) {
		const known = Object.keys(CATALOGUE).join(', ') || '(none)';
		throw new Error(
			`unknown eval id '${id}'. Known real-site evals: ${known}. ` +
				'(The local-fixture self-test is run separately via `self-test`.)',
		);
	}
	// Built FRESH per run: a per-run NONCE-tagged eval (ParaBank, prd D2) mints a
	// new identity on each invocation here; a static eval just returns its constant.
	return builder();
}

/**
 * Run ONE config (a freshly-built eval entry + an agent adapter) end to end.
 * Built fresh per leg so a per-run NONCE-tagged eval (ParaBank, prd D2) mints an
 * independent identity for each run, including each leg of a --compare.
 */
async function runOne(
	evalId: string,
	agent: AgentUnderTest,
	args: Args,
): Promise<EvalRunResult> {
	const entry = await loadEval(evalId);
	return await runEval({
		entry,
		webhands: asWebhandsCommand(args.webhands),
		agent,
		...(args.maxAttempts !== undefined ? {maxAttempts: args.maxAttempts} : {}),
		...(args.headed ? {serve: {headed: true}} : {}),
	});
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || args.eval === undefined) {
		process.stdout.write(`${HELP}\n`);
		process.exit(args.help ? 0 : 1);
	}

	if (args.compare3) {
		await runComparison3(args);
		return;
	}

	if (args.compare) {
		await runComparison(args);
		return;
	}

	// Single-config run. --agent-kind picks the toolkit. The Playwright-only config
	// may take its command from --playwright-cmd as well as --agent-cmd; the
	// webhands-skilled config from --skilled-cmd as well as --agent-cmd (so the
	// same eval can be run skilled without a separate flag dance).
	const cmd =
		args.agentKind === 'playwright'
			? (args.playwrightCmd ?? args.agentCmd)
			: args.agentKind === 'webhands-skilled'
				? (args.skilledCmd ?? args.agentCmd)
				: args.agentCmd;
	if (cmd === undefined || cmd.trim() === '') {
		process.stderr.write(
			`error: ${
				args.agentKind === 'playwright'
					? '--playwright-cmd (or --agent-cmd)'
					: args.agentKind === 'webhands-skilled'
						? '--skilled-cmd (or --agent-cmd)'
						: '--agent-cmd'
			} is required (the shell command that launches the unaided agent).\n`,
		);
		process.exit(1);
	}

	const agent = buildAgent(args.agentKind, cmd, args.model, args.parseUsage);
	const result = await runOne(args.eval, agent, args);
	process.stdout.write(`${formatRunLine(result)}\n`);
	// A capability FAIL is a real signal but not a CRASH: exit 0 on PASS, 1 on
	// FAIL, 2 on INCONCLUSIVE, so a scheduler can route on the three states.
	process.exit(
		result.outcome.kind === 'PASS' ? 0 : result.outcome.kind === 'FAIL' ? 1 : 2,
	);
}

/**
 * Run the SAME eval under BOTH configs (webhands + Playwright-only) and print a
 * side-by-side comparison: the "does webhands deliver?" scoreboard. Both legs
 * use the SAME goal + the SAME harness end-state assertion; only the toolkit +
 * preamble differ. The webhands leg runs first, then the Playwright-only leg
 * (sequential so the two never contend for the same isolated serve/home).
 *
 * The comparison is INFORMATIONAL, so it exits 0 whenever both legs ran; the
 * per-leg verdicts are in the printed block. (Use a single --agent-kind run when
 * you want the three-state exit code for scheduler routing.)
 */
async function runComparison(args: Args): Promise<void> {
	if (
		args.agentCmd === undefined ||
		args.agentCmd.trim() === '' ||
		args.playwrightCmd === undefined ||
		args.playwrightCmd.trim() === ''
	) {
		process.stderr.write(
			'error: --compare requires BOTH --agent-cmd (the webhands agent) and ' +
				'--playwright-cmd (the Playwright-only baseline agent).\n',
		);
		process.exit(1);
	}
	const evalId = args.eval!;
	const webhands = await runOne(
		evalId,
		buildAgent('webhands', args.agentCmd, args.model, args.parseUsage),
		args,
	);
	process.stdout.write(`${formatRunLine(webhands)}\n`);
	const playwright = await runOne(
		evalId,
		buildAgent('playwright', args.playwrightCmd, args.model, args.parseUsage),
		args,
	);
	process.stdout.write(`${formatRunLine(playwright)}\n`);

	const comparison: ComparisonResult = {evalId, webhands, playwright};
	process.stdout.write(`\n${formatComparison(comparison)}\n`);
	process.exit(0);
}

/**
 * Run the SAME eval under ALL THREE configs (webhands-cold + webhands-skilled +
 * Playwright-only) and print a three-way side-by-side comparison: the
 * cold->skilled delta is the SKILL's value (it removes the runtime discovery
 * tax), and skilled-vs-Playwright is the FAIR-SHAKE number a real deployment
 * (skill in context) would see. Every leg uses the SAME goal + the SAME harness
 * end-state assertion; only the toolkit + preamble differ. The legs run
 * sequentially (cold, skilled, Playwright) so they never contend for the same
 * isolated serve/home.
 *
 * Like {@link runComparison} it is INFORMATIONAL and exits 0 whenever every leg
 * ran; per-leg verdicts are in the printed block. (Use a single --agent-kind run
 * for the three-state exit code.)
 */
async function runComparison3(args: Args): Promise<void> {
	const webhandsCmd = args.agentCmd;
	// The skilled leg drives the SAME webhands surface as the cold leg, so its
	// command defaults to --agent-cmd when --skilled-cmd is not given (the only
	// difference between the two legs is the preamble, not the launch command).
	const skilledCmd = args.skilledCmd ?? args.agentCmd;
	if (
		webhandsCmd === undefined ||
		webhandsCmd.trim() === '' ||
		skilledCmd === undefined ||
		skilledCmd.trim() === '' ||
		args.playwrightCmd === undefined ||
		args.playwrightCmd.trim() === ''
	) {
		process.stderr.write(
			'error: --compare3 requires --agent-cmd (the webhands COLD agent; reused ' +
				'for the SKILLED leg unless --skilled-cmd is given) and --playwright-cmd ' +
				'(the Playwright-only baseline agent).\n',
		);
		process.exit(1);
	}
	const evalId = args.eval!;
	const webhands = await runOne(
		evalId,
		buildAgent('webhands', webhandsCmd, args.model, args.parseUsage),
		args,
	);
	process.stdout.write(`${formatRunLine(webhands)}\n`);
	const skilled = await runOne(
		evalId,
		buildAgent('webhands-skilled', skilledCmd, args.model, args.parseUsage),
		args,
	);
	process.stdout.write(`${formatRunLine(skilled)}\n`);
	const playwright = await runOne(
		evalId,
		buildAgent('playwright', args.playwrightCmd, args.model, args.parseUsage),
		args,
	);
	process.stdout.write(`${formatRunLine(playwright)}\n`);

	const comparison: ComparisonResult = {evalId, webhands, skilled, playwright};
	process.stdout.write(`\n${formatComparison(comparison)}\n`);
	process.exit(0);
}

void main().catch((cause: unknown) => {
	process.stderr.write(
		`eval runner failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
	);
	process.exit(3);
});
