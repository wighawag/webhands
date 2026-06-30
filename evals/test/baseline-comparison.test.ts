import {describe, expect, it} from 'vitest';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	PlaywrightAdapter,
	ShellAdapter,
	type AgentUsage,
	type LaunchInput,
	type LaunchResult,
} from '../src/agent-under-test.js';
import {
	buildAgentInput,
	CDP_ENDPOINT_ENV,
	PLAYWRIGHT_PREAMBLE,
	WEBHANDS_PREAMBLE,
} from '../src/no-priming.js';
import {
	formatComparison,
	type ComparisonResult,
	type EvalRunResult,
} from '../src/run-eval.js';
import type {EvalEntry} from '../src/eval-contract.js';
import type {Outcome} from '../src/outcome.js';

/**
 * The Playwright-only BASELINE comparison plumbing self-test (task
 * `eval-playwright-only-baseline-comparison`).
 *
 * DETERMINISTIC, no live site, no real agent, no browser: it exercises the
 * comparison MACHINERY in isolation:
 *  - the per-adapter PROTOCOL preamble (webhands vs Playwright-only) wraps the
 *    SAME goal differently while the no-priming rule still binds the goal;
 *  - the Playwright-only preamble teaches RAW Playwright and never mentions
 *    webhands (routing it through webhands would defeat the baseline);
 *  - the leave-open rule is delivered as a per-adapter PROTOCOL instruction, not
 *    goal-prompt priming;
 *  - {@link PlaywrightAdapter} is the SAME launch shape as {@link ShellAdapter},
 *    only its adapter NAME + preamble differ;
 *  - {@link formatComparison} renders two runs side by side on the SAME fields
 *    (outcome, milestones, tokens) so a comparison is apples-to-apples.
 *
 * It runs under `evals/`'s OWN vitest (the `self-test` script), NEVER the repo
 * gate (`pnpm test` = `pnpm --filter './packages/*' test` cannot reach here).
 */

/** A minimal toolkit-agnostic eval entry (no selectors, only the entry URL). */
function fakeEntry(): EvalEntry {
	return {
		id: 'baseline-fake',
		tier: 'self-test',
		target: 'fake',
		entryUrl: 'http://127.0.0.1:0/',
		goalPrompt:
			'Create an account and confirm it, starting at http://127.0.0.1:0/.',
		health: [],
		milestones: [],
		endState: [],
	};
}

/** A minimal fake EvalRunResult carrying a known outcome + usage, for the summary. */
function fakeRun(
	adapter: string,
	kind: Outcome['kind'],
	milestonesReached: readonly string[],
	milestoneTotal: number,
	usage: AgentUsage | undefined,
): EvalRunResult {
	const launch: LaunchResult = {
		status: 'reported-done',
		output: 'done',
		...(usage !== undefined ? {usage} : {}),
	};
	const outcome: Outcome = {
		kind,
		score: {
			passed: kind === 'PASS',
			milestonesReached,
			milestoneTotal,
			checks: [],
		},
		attempts: 1,
	};
	return {entry: fakeEntry(), adapter, launch, outcome, cleanedUp: 'skipped'};
}

describe('Playwright-only baseline comparison plumbing (deterministic, no live site)', () => {
	describe('per-adapter protocol preamble (webhands vs Playwright-only)', () => {
		it('wraps the SAME goal differently: only the toolkit + leave-open rule differ', () => {
			const entry = fakeEntry();
			const webhandsInput = buildAgentInput(entry, WEBHANDS_PREAMBLE);
			const playwrightInput = buildAgentInput(entry, PLAYWRIGHT_PREAMBLE);

			// The toolkit-agnostic GOAL is present, identical, in both.
			expect(webhandsInput).toContain(entry.goalPrompt);
			expect(playwrightInput).toContain(entry.goalPrompt);
			// The inputs differ ONLY past the goal (the preamble layer).
			expect(webhandsInput).not.toBe(playwrightInput);
		});

		it('the Playwright-only preamble teaches RAW Playwright and never POINTS the agent at the webhands verb surface', () => {
			const playwrightInput = buildAgentInput(fakeEntry(), PLAYWRIGHT_PREAMBLE);
			expect(playwrightInput).toMatch(/Playwright/i);
			// Routing the baseline through webhands would defeat it. The preamble may
			// only mention webhands to FORBID it (a negative prohibition); it must
			// never point the agent AT the webhands verb surface as a tool.
			expect(playwrightInput).not.toMatch(/npx webhands/i);
			// The only webhands mention is the explicit prohibition.
			expect(PLAYWRIGHT_PREAMBLE.toolkitReference).toMatch(
				/do not use\s+webhands/i,
			);
		});

		it('the Playwright-only preamble tells the agent to CONNECT over CDP to the shared browser, NOT launch its own', () => {
			const playwrightInput = buildAgentInput(fakeEntry(), PLAYWRIGHT_PREAMBLE);
			// CONNECT to the harness's existing browser (the shared driving surface)...
			expect(playwrightInput).toMatch(/connectOverCDP/i);
			// ...via the CDP endpoint supplied as PROTOCOL in the env var (not priming).
			expect(playwrightInput).toContain(CDP_ENDPOINT_ENV);
			// ...and explicitly NOT launch its own browser (that was the false-FAIL bug).
			expect(PLAYWRIGHT_PREAMBLE.toolkitReference).toMatch(
				/do not launch your own browser/i,
			);
			// The endpoint VALUE is never baked into the static preamble text (it is
			// delivered at launch via the env var); the preamble only NAMES the var.
			expect(PLAYWRIGHT_PREAMBLE.toolkitReference).not.toMatch(
				/http:\/\/127\.0\.0\.1:\d+/,
			);
		});

		it('the webhands preamble teaches the webhands verb surface', () => {
			const webhandsInput = buildAgentInput(fakeEntry(), WEBHANDS_PREAMBLE);
			expect(webhandsInput).toMatch(/webhands/i);
		});

		it('delivers "leave the browser open" as a PROTOCOL preamble, not goal priming', () => {
			const entry = fakeEntry();
			// The leave-open rule is in the per-adapter preamble (toolkit-worded)...
			expect(WEBHANDS_PREAMBLE.leaveOpenRule).toMatch(
				/leave the browser open/i,
			);
			expect(WEBHANDS_PREAMBLE.leaveOpenRule).toMatch(/webhands stop/i);
			expect(PLAYWRIGHT_PREAMBLE.leaveOpenRule).toMatch(
				/leave the (shared )?browser open/i,
			);
			expect(PLAYWRIGHT_PREAMBLE.leaveOpenRule).toMatch(/browser\.close/i);
			// ...NOT in the GOAL itself (the no-priming rule still binds the goal).
			expect(entry.goalPrompt).not.toMatch(/leave the browser open/i);
		});

		it('the Playwright-only preamble DISTINGUISHES "do not CLOSE the shared browser" from "DO disconnect your client so the script exits" (the self-stall fix)', () => {
			const {toolkitReference, leaveOpenRule} = PLAYWRIGHT_PREAMBLE;
			const input = buildAgentInput(fakeEntry(), PLAYWRIGHT_PREAMBLE);
			// The leave-open rule names BOTH halves: never CLOSE, but DO disconnect.
			expect(leaveOpenRule).toMatch(/browser\.disconnect\(\)/i);
			expect(leaveOpenRule).toMatch(/browser\.close\(\)/i);
			// The reference itself tells the agent each script's `node` must EXIT via
			// disconnect (so a live connectOverCDP connection does not hang the loop).
			expect(toolkitReference).toMatch(/browser\.disconnect\(\)/i);
			expect(toolkitReference).toMatch(/exit/i);
			// Both surface in the composed agent input the harness actually sends.
			expect(input).toMatch(/disconnect/i);
		});

		it('the Playwright-only preamble prefers domcontentloaded + a locator wait over networkidle (which may never settle)', () => {
			const {toolkitReference} = PLAYWRIGHT_PREAMBLE;
			expect(toolkitReference).toMatch(/domcontentloaded/i);
			// It steers AWAY from networkidle (named only to forbid it).
			expect(toolkitReference).toMatch(/do NOT use[^.]*networkidle/i);
		});

		it('the disconnect-to-exit steer stays site-agnostic: no selector shape, no http(s) URL', () => {
			const {toolkitReference, leaveOpenRule} = PLAYWRIGHT_PREAMBLE;
			for (const text of [toolkitReference, leaveOpenRule]) {
				expect(text).not.toMatch(/https?:\/\//);
				expect(text).not.toMatch(/page\.locator\(|getByRole\(|data-testid/i);
			}
		});

		it('the goal stays identical across configs; buildAgentInput still runs the no-priming guard', () => {
			const primed: EvalEntry = {
				...fakeEntry(),
				goalPrompt: `Click page.locator('#submit') to finish.`,
			};
			// The no-priming guard binds the GOAL regardless of which preamble wraps it.
			expect(() => buildAgentInput(primed, WEBHANDS_PREAMBLE)).toThrow();
			expect(() => buildAgentInput(primed, PLAYWRIGHT_PREAMBLE)).toThrow();
		});
	});

	describe('PlaywrightAdapter (same launch shape, Playwright-only preamble)', () => {
		it('is named `playwright` (distinct from the default `shell`)', () => {
			const playwright = new PlaywrightAdapter({agentCmd: 'true'});
			const webhands = new ShellAdapter({agentCmd: 'true'});
			expect(playwright.adapter).toBe('playwright');
			expect(webhands.adapter).toBe('shell');
		});
	});

	describe('CDP endpoint plumbing (the shared driving surface reaches the agent as PROTOCOL)', () => {
		/** A toolkit-agnostic LaunchInput whose agentCmd echoes the CDP env var. */
		function echoEnvLaunch(cdpEndpoint?: string) {
			return {
				entry: fakeEntry(),
				webhands: {command: 'true', args: []},
				home: '/tmp/fake-home',
				timeoutMs: 30_000,
				...(cdpEndpoint !== undefined ? {cdpEndpoint} : {}),
			};
		}

		it('passes the CDP endpoint into the agent env as WEBHANDS_CDP_ENDPOINT', async () => {
			// The agent command just prints the protocol env var so we can assert it
			// reached the spawned process verbatim.
			// `cat >/dev/null` drains the goal the adapter writes to stdin (so the
			// pipe stays open), then we echo the protocol env var to assert it reached
			// the spawned process verbatim.
			const adapter = new PlaywrightAdapter({
				agentCmd: `cat >/dev/null; printf '%s' "$${CDP_ENDPOINT_ENV}"`,
			});
			const result = await adapter.launch(
				echoEnvLaunch('http://127.0.0.1:9777'),
			);
			expect(result.status).toBe('reported-done');
			expect(result.output).toContain('http://127.0.0.1:9777');
		});

		it('omits the env var when no shared surface was advertised (honest absence, not empty string baked in)', async () => {
			// With no cdpEndpoint, the var is simply unset; echoing it yields nothing.
			const adapter = new PlaywrightAdapter({
				agentCmd: `cat >/dev/null; printf 'value=[%s]' "$${CDP_ENDPOINT_ENV}"`,
			});
			const result = await adapter.launch(echoEnvLaunch(undefined));
			expect(result.status).toBe('reported-done');
			expect(result.output).toContain('value=[]');
		});

		it('the webhands config also forwards the var when present (toolkit-agnostic plumbing) but ignores it', async () => {
			// The plumbing is on the shared ShellAdapter, so a webhands run carries
			// the var too; the webhands agent simply never reads it (it drives verbs).
			const adapter = new ShellAdapter({
				agentCmd: `cat >/dev/null; printf '%s' "$${CDP_ENDPOINT_ENV}"`,
			});
			const result = await adapter.launch(
				echoEnvLaunch('http://127.0.0.1:9888'),
			);
			expect(result.output).toContain('http://127.0.0.1:9888');
		});
	});

	describe('formatComparison (side-by-side, identical fields)', () => {
		it('renders both configs on the SAME fields (outcome, milestones, tokens)', () => {
			const comparison: ComparisonResult = {
				evalId: 'baseline-fake',
				webhands: fakeRun('shell', 'PASS', ['a', 'b'], 3, {
					input: 12_300,
					output: 4100,
					total: 16_400,
				}),
				playwright: fakeRun('playwright', 'PASS', ['a', 'b'], 3, {
					input: 30_000,
					output: 9000,
					total: 39_000,
				}),
			};
			const out = formatComparison(comparison);
			// The header names the eval + frames it as same-goal/two-toolkits.
			expect(out).toContain('baseline-fake');
			expect(out).toMatch(/same goal/i);
			// One labelled row per config, each carrying outcome + milestones + tokens.
			expect(out).toContain('shell');
			expect(out).toContain('playwright');
			expect(out).toContain('PASS');
			expect(out).toContain('milestones 2/3');
			// Tokens print in the SAME shape for both legs (apples-to-apples).
			expect(out).toContain('tokens: in 12.3k / out 4.1k / total 16.4k');
			expect(out).toContain('tokens: in 30.0k / out 9.0k / total 39.0k');
		});

		it('prints an honest `tokens: unknown` when a config could not observe usage', () => {
			const comparison: ComparisonResult = {
				evalId: 'baseline-fake',
				webhands: fakeRun('shell', 'PASS', [], 0, {total: 1000}),
				// The Playwright-only agent's command was not a parseable usage stream.
				playwright: fakeRun('playwright', 'FAIL', [], 0, undefined),
			};
			const out = formatComparison(comparison);
			expect(out).toContain('tokens: total 1.0k');
			expect(out).toContain('tokens: unknown');
			// A FAIL leg still lines up on the same field shape as the PASS leg.
			expect(out).toContain('FAIL');
		});
	});

	describe('timeout teardown GROUP-kills a hung child tree (the self-stall reaper)', () => {
		/** A minimal LaunchInput for a teardown test (no webhands, short wall-clock). */
		function teardownInput(command: string, timeoutMs: number): LaunchInput {
			return {
				entry: fakeEntry(),
				webhands: {command: 'true', args: []},
				home: tmpdir(),
				timeoutMs,
			};
		}

		function isAlive(pid: number): boolean {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		}

		it('reaps a backgrounded GRANDCHILD `node` that outlives the wall-clock (not just the direct bash child)', async () => {
			// The exact self-stall shape: the agent (bash) backgrounds an inner `node`
			// that HANGS forever (a live CDP connection that never disconnects), then
			// bash itself waits. Without a GROUP kill, a timeout SIGTERM to the bash
			// pid leaves the grandchild `node` orphaned/alive. We record the
			// grandchild's pid and assert it is DEAD after teardown.
			const dir = mkdtempSync(join(tmpdir(), 'webhands-teardown-'));
			const pidFile = join(dir, 'grandchild.pid');
			try {
				// node writes its own pid, then hangs on an unresolved promise forever.
				const hang = `node -e "require('fs').writeFileSync(process.env.PIDFILE, String(process.pid)); setInterval(()=>{}, 1e9)"`;
				// Background the node grandchild, then bash waits on it (so bash itself
				// is also alive at timeout: a non-group kill would only catch bash).
				const command = `export PIDFILE='${pidFile}'; ${hang} & wait`;
				// The teardown is in the shared ShellAdapter.launch the PlaywrightAdapter
				// inherits, so a plain ShellAdapter exercises the exact same reaper.
				const shell = new ShellAdapter({agentCmd: command});
				const result = await shell.launch(teardownInput(command, 600));
				expect(result.status).toBe('timed-out');
				const grandchildPid = Number(readFileSync(pidFile, 'utf8').trim());
				expect(Number.isInteger(grandchildPid)).toBe(true);
				// Give the SIGTERM->SIGKILL escalation a beat to land on the group.
				await new Promise((r) => setTimeout(r, 2500));
				expect(isAlive(grandchildPid)).toBe(false);
			} finally {
				rmSync(dir, {recursive: true, force: true});
			}
		}, 15000);
	});
});
