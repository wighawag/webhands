import {describe, expect, it} from 'vitest';
import {
	ShellAdapter,
	WebhandsSkilledAdapter,
	WebhandsScriptOnlyAdapter,
	WebhandsColdCtaAdapter,
	type AgentUsage,
	type LaunchResult,
} from '../src/agent-under-test.js';
import {
	assertSkilledReferenceUnprimed,
	buildAgentInput,
	PrimingViolationError,
	VERB_SURFACE_REFERENCE,
	WEBHANDS_PREAMBLE,
	WEBHANDS_SKILL_REFERENCE,
	WEBHANDS_SCRIPT_FORWARD_REFERENCE,
	WEBHANDS_SCRIPT_ONLY_REFERENCE,
	WEBHANDS_SCRIPT_ONLY_PREAMBLE,
	WEBHANDS_SKILLED_PREAMBLE,
	type ProtocolPreamble,
} from '../src/no-priming.js';
import {
	formatComparison,
	type ComparisonResult,
	type EvalRunResult,
} from '../src/run-eval.js';
import type {EvalEntry} from '../src/eval-contract.js';
import type {Outcome} from '../src/outcome.js';

/**
 * The WEBHANDS-SKILLED in-context comparison plumbing self-test (task
 * `eval-webhands-skill-in-context-variant`).
 *
 * DETERMINISTIC, no live site, no real agent, no browser: it exercises the
 * skilled-variant MACHINERY in isolation:
 *  - the SKILLED preamble inlines the webhands skill text so the agent starts
 *    knowing the surface, while driving the SAME verb surface as the cold config
 *    (only the up-front knowledge differs);
 *  - the inlined skill text carries NO goal priming (no selector-shaped fragment,
 *    no site URL): the no-priming spirit binds the inlined PROTOCOL text too, and
 *    the no-priming guard still binds the GOAL;
 *  - {@link WebhandsSkilledAdapter} is the SAME launch shape as the cold
 *    {@link ShellAdapter}, only its adapter NAME + preamble differ;
 *  - {@link formatComparison} renders a THREE-WAY read (cold / skilled /
 *    Playwright) on the SAME fields (outcome, milestones, tokens), and still
 *    renders the original two-way read when no skilled leg is present.
 *
 * It runs under `evals/`'s OWN vitest (the `self-test` script), NEVER the repo
 * gate (`pnpm test` = `pnpm --filter './packages/*' test` cannot reach here).
 */

/** A minimal toolkit-agnostic eval entry (no selectors, only the entry URL). */
function fakeEntry(): EvalEntry {
	return {
		id: 'skilled-fake',
		tier: 'self-test',
		target: 'fake',
		entryUrl: 'http://127.0.0.1:0/',
		goalPrompt:
			'Log in and complete a purchase, starting at http://127.0.0.1:0/.',
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

describe('webhands-skilled in-context comparison plumbing (deterministic, no live site)', () => {
	describe('the SKILLED preamble inlines the skill but drives the SAME verb surface', () => {
		it('embeds the webhands skill text so the agent starts knowing the surface', () => {
			const input = buildAgentInput(fakeEntry(), WEBHANDS_SKILLED_PREAMBLE);
			// The skilled toolkit reference is the inlined skill, present verbatim.
			expect(input).toContain(WEBHANDS_SKILL_REFERENCE);
			// It actually teaches the surface up front: the serve lifecycle + the
			// core verbs (not merely a pointer at a discovery command).
			expect(WEBHANDS_SKILL_REFERENCE).toMatch(/serve/);
			expect(WEBHANDS_SKILL_REFERENCE).toMatch(/snapshot/);
			expect(WEBHANDS_SKILL_REFERENCE).toMatch(/goto/);
		});

		it('drives the SAME webhands verb surface as the cold config (only up-front knowledge differs)', () => {
			// Both configs are the webhands verb surface; the skilled preamble is a
			// distinct toolkit name but still webhands.
			expect(WEBHANDS_SKILLED_PREAMBLE.toolkit).toBe('webhands-skilled');
			expect(WEBHANDS_PREAMBLE.toolkit).toBe('webhands');
			// The skilled reference points at the SAME verb surface (it still tells
			// the agent to drive via the webhands CLI verbs), so it is comparable.
			expect(WEBHANDS_SKILL_REFERENCE).toMatch(/webhands/i);
			// The leave-open rule is the webhands one, UNCHANGED from cold.
			expect(WEBHANDS_SKILLED_PREAMBLE.leaveOpenRule).toBe(
				WEBHANDS_PREAMBLE.leaveOpenRule,
			);
			// The skilled input differs from the cold input ONLY in the toolkit
			// reference (the up-front knowledge), with the SAME goal + leave-open rule.
			const cold = buildAgentInput(fakeEntry(), WEBHANDS_PREAMBLE);
			const skilled = buildAgentInput(fakeEntry(), WEBHANDS_SKILLED_PREAMBLE);
			expect(skilled).not.toBe(cold);
			// The cold config's bare discovery pointer is NOT what the skilled config
			// hands the agent (skilled inlines the surface instead of pointing at it).
			expect(skilled).not.toContain(VERB_SURFACE_REFERENCE);
		});
	});

	describe('the inlined skill text carries NO goal priming (it is PROTOCOL, site-agnostic)', () => {
		it('passes the no-priming spirit: no selector-shaped fragment, no site URL', () => {
			// The dedicated guard holds the inlined reference to the no-priming spirit.
			expect(() =>
				assertSkilledReferenceUnprimed(WEBHANDS_SKILL_REFERENCE),
			).not.toThrow();
			// Concretely: no selector-shaped fragments the no-priming guard forbids...
			expect(WEBHANDS_SKILL_REFERENCE).not.toMatch(/page\.locator\(/i);
			expect(WEBHANDS_SKILL_REFERENCE).not.toMatch(/getByRole\(/i);
			expect(WEBHANDS_SKILL_REFERENCE).not.toMatch(/frameLocator\(/i);
			expect(WEBHANDS_SKILL_REFERENCE).not.toMatch(/querySelector/i);
			expect(WEBHANDS_SKILL_REFERENCE).not.toMatch(/data-testid/i);
			// ...and NO http(s) URL at all (the skill is site-agnostic; it names no
			// site, so it can never leak the goal's site).
			expect(WEBHANDS_SKILL_REFERENCE).not.toMatch(/https?:\/\//i);
		});

		it('the guard REJECTS a skilled reference that smuggles a selector or a URL (so it cannot rot)', () => {
			expect(() =>
				assertSkilledReferenceUnprimed(
					'Drive the page with `page.locator("#login")`.',
				),
			).toThrow(PrimingViolationError);
			expect(() =>
				assertSkilledReferenceUnprimed(
					'For example go to https://www.saucedemo.com/ and log in.',
				),
			).toThrow(PrimingViolationError);
		});

		it('buildAgentInput runs the skilled-reference guard, so a primed inlined skill never reaches a real agent', () => {
			const primedPreamble: ProtocolPreamble = {
				...WEBHANDS_SKILLED_PREAMBLE,
				toolkitReference:
					'Use webhands. For example, https://example.com/ then ' +
					'`page.locator("#go")`.',
			};
			// The guard fires inside buildAgentInput for a skilled-toolkit preamble.
			expect(() => buildAgentInput(fakeEntry(), primedPreamble)).toThrow(
				PrimingViolationError,
			);
		});

		it('the no-priming guard still binds the GOAL under the skilled preamble', () => {
			const primed: EvalEntry = {
				...fakeEntry(),
				goalPrompt: `Click page.locator('#submit') to finish.`,
			};
			// A primed GOAL throws regardless of which preamble wraps it.
			expect(() =>
				buildAgentInput(primed, WEBHANDS_SKILLED_PREAMBLE),
			).toThrow();
		});
	});

	describe('WebhandsSkilledAdapter (same launch shape, skilled preamble)', () => {
		it('is named `webhands-skilled` (distinct from the cold `shell`)', () => {
			const skilled = new WebhandsSkilledAdapter({agentCmd: 'true'});
			const cold = new ShellAdapter({agentCmd: 'true'});
			expect(skilled.adapter).toBe('webhands-skilled');
			expect(cold.adapter).toBe('shell');
		});

		it('feeds the agent the inlined skill on stdin (same launch mechanism as the cold adapter)', async () => {
			// The adapter writes the wrapped goal (goal + skilled reference +
			// leave-open) to the agent's stdin; `cat` echoes it so we can assert the
			// skill text reached the spawned process verbatim.
			const adapter = new WebhandsSkilledAdapter({agentCmd: 'cat'});
			const result = await adapter.launch({
				entry: fakeEntry(),
				webhands: {command: 'true', args: []},
				home: '/tmp/fake-home',
				timeoutMs: 30_000,
			});
			expect(result.status).toBe('reported-done');
			// A distinctive phrase from the inlined skill made it to the agent.
			expect(result.output).toContain('token-cheap accessibility-tree');
		});
	});

	describe('WebhandsColdCtaAdapter (the pre-flip CTA-on cold baseline)', () => {
		it('is named `webhands-cold-cta` (distinct from the cold `shell`)', () => {
			const coldCta = new WebhandsColdCtaAdapter({agentCmd: 'true'});
			const cold = new ShellAdapter({agentCmd: 'true'});
			expect(coldCta.adapter).toBe('webhands-cold-cta');
			expect(cold.adapter).toBe('shell');
		});

		it('drives the SAME cold preamble as the default adapter (only the env differs)', async () => {
			// `cat` echoes the wrapped goal: cold-cta must hand the agent the SAME
			// cold reference as the default ShellAdapter (the bare --llms-full
			// pointer), NOT the inlined skill. A distinctive cold-only phrase proves
			// it (the skilled reference does not carry it).
			const coldCta = new WebhandsColdCtaAdapter({agentCmd: 'cat'});
			const result = await coldCta.launch({
				entry: fakeEntry(),
				webhands: {command: 'true', args: []},
				home: '/tmp/fake-home',
				timeoutMs: 30_000,
			});
			expect(result.status).toBe('reported-done');
			expect(result.output).toContain('Discover its full verb surface');
			// It is NOT the inlined skill (that is the skilled adapter's job).
			expect(result.output).not.toContain('token-cheap accessibility-tree');
		});

		it('pins WEBHANDS_CTA=1 in the spawned agent env (re-enables the default-off CTA)', async () => {
			// The agent process inherits WEBHANDS_CTA=1, so its own `npx webhands
			// <verb>` calls re-enable the (now default-off) CTA hints WITHOUT a
			// per-call flag. `printenv` prints the value to stdout, which the adapter
			// captures as the agent's output.
			const coldCta = new WebhandsColdCtaAdapter({
				agentCmd: 'printenv WEBHANDS_CTA',
			});
			const result = await coldCta.launch({
				entry: fakeEntry(),
				webhands: {command: 'true', args: []},
				home: '/tmp/fake-home',
				timeoutMs: 30_000,
			});
			expect(result.output.trim()).toBe('1');
		});

		it('the default cold adapter does NOT set WEBHANDS_CTA (lean by default)', async () => {
			// printenv exits non-zero when the var is unset, so the adapter reports a
			// crash with empty output: the cold leg leaves the CTA at its default-off.
			const cold = new ShellAdapter({agentCmd: 'printenv WEBHANDS_CTA'});
			const result = await cold.launch({
				entry: fakeEntry(),
				webhands: {command: 'true', args: []},
				home: '/tmp/fake-home',
				timeoutMs: 30_000,
			});
			expect(result.output.trim()).toBe('');
		});
	});

	describe('WebhandsScriptOnlyAdapter (script-EXCLUSIVE: the truest Playwright head-to-head)', () => {
		it('is named `webhands-script-only` (distinct from the cold `shell`)', () => {
			const scriptOnly = new WebhandsScriptOnlyAdapter({agentCmd: 'true'});
			const cold = new ShellAdapter({agentCmd: 'true'});
			expect(scriptOnly.adapter).toBe('webhands-script-only');
			expect(cold.adapter).toBe('shell');
		});

		it('the preamble is the SCRIPT-ONLY one (its toolkit + reference)', () => {
			expect(WEBHANDS_SCRIPT_ONLY_PREAMBLE.toolkit).toBe(
				'webhands-script-only',
			);
			expect(WEBHANDS_SCRIPT_ONLY_PREAMBLE.toolkitReference).toBe(
				WEBHANDS_SCRIPT_ONLY_REFERENCE,
			);
			// Same webhands leave-open rule as the cold config (only knowledge differs).
			expect(WEBHANDS_SCRIPT_ONLY_PREAMBLE.leaveOpenRule).toBe(
				WEBHANDS_PREAMBLE.leaveOpenRule,
			);
		});

		it('feeds the agent the script-only reference on stdin (same launch mechanism)', async () => {
			// `cat` echoes the wrapped goal so we can assert the script-only reference
			// reached the spawned process verbatim, the SAME launch shape as the others.
			const adapter = new WebhandsScriptOnlyAdapter({agentCmd: 'cat'});
			const result = await adapter.launch({
				entry: fakeEntry(),
				webhands: {command: 'true', args: []},
				home: '/tmp/fake-home',
				timeoutMs: 30_000,
			});
			expect(result.status).toBe('reported-done');
			// A distinctive phrase from the script-only reference made it to the agent.
			expect(result.output).toContain('EXCLUSIVELY');
			expect(result.output).toContain('npx webhands script ./flow.js');
		});

		it('drives the WHOLE flow via file-only `script` (no discrete click/type working path)', () => {
			// The reference must make `script` the ONE driving verb (the read-decide-loop
			// is a SEQUENCE of file-only script runs), not list discrete verbs as a path.
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).toMatch(/EXCLUSIVELY/);
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).toMatch(/`script`/);
			// File-only form (the simplify-script-verb-to-file-path-only landing).
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).toContain(
				'npx webhands script ./flow.js',
			);
			// The read-decide-loop is framed as a sequence of script files.
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).toMatch(/READ-DECIDE-LOOP/);
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).toMatch(/NEXT `?\.\/flow\.js/);
			// It tells the agent NOT to use the discrete verbs (no fallback path).
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).toMatch(/Do NOT use the discrete/);
		});

		it('buildAgent("webhands-script-only", ...) is wired and is NOT the cold adapter', () => {
			// Routed through the same buildAgent the CLI uses (the test imports the
			// adapter directly to avoid pulling the bin's arg parsing, but asserts the
			// adapter the case returns is the script-only one).
			const built = new WebhandsScriptOnlyAdapter({agentCmd: 'true'});
			expect(built).toBeInstanceOf(WebhandsScriptOnlyAdapter);
			expect(built).toBeInstanceOf(ShellAdapter);
			expect(built.adapter).toBe('webhands-script-only');
		});
	});

	describe('the inlined references stay no-priming-clean AND obviate runtime --help/--llms-full', () => {
		it('both skilled references pass the no-priming guard (no selector, no URL)', () => {
			expect(() =>
				assertSkilledReferenceUnprimed(WEBHANDS_SKILL_REFERENCE),
			).not.toThrow();
			expect(() =>
				assertSkilledReferenceUnprimed(WEBHANDS_SCRIPT_FORWARD_REFERENCE),
			).not.toThrow();
			// The script-only reference is held to the SAME no-priming spirit: it must
			// carry no selector-shaped fragment and no site URL (generic page example).
			expect(() =>
				assertSkilledReferenceUnprimed(WEBHANDS_SCRIPT_ONLY_REFERENCE),
			).not.toThrow();
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).not.toMatch(/page\.locator\(/i);
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).not.toMatch(/getByRole\(/i);
			expect(WEBHANDS_SCRIPT_ONLY_REFERENCE).not.toMatch(/https?:\/\//i);
		});

		it('state plainly the agent need NOT run --help/--llms-full at runtime', () => {
			for (const ref of [
				WEBHANDS_SKILL_REFERENCE,
				WEBHANDS_SCRIPT_FORWARD_REFERENCE,
				WEBHANDS_SCRIPT_ONLY_REFERENCE,
			]) {
				expect(ref).toMatch(/you do NOT need/i);
				expect(ref).toMatch(/--llms-full/);
			}
		});

		it('are a COMPLETE per-verb reference incl. the page.-prefixed locator form', () => {
			for (const ref of [
				WEBHANDS_SKILL_REFERENCE,
				WEBHANDS_SCRIPT_FORWARD_REFERENCE,
			]) {
				// The locator-grammar footgun is called out (must prefix with page.).
				expect(ref).toMatch(/prefixed with `page\.`/);
				// Every verb is named, so a skilled agent never has to discover one.
				for (const verb of [
					'serve',
					'setup-profile',
					'attach',
					'goto',
					'wait',
					'snapshot',
					'eval',
					'script',
					'click',
					'type',
					'press',
					'hover',
					'select',
					'scroll',
					'drag',
					'mouse',
					'query',
					'count',
					'exists',
					'is-visible',
					'get-attribute',
					'screenshot',
					'cookies',
					'stop',
				]) {
					expect(ref).toContain(`\`${verb}`);
				}
			}
		});
	});

	describe('formatComparison three-way (cold / skilled / Playwright, identical fields)', () => {
		it('renders all THREE legs on the SAME fields (outcome, milestones, tokens)', () => {
			const comparison: ComparisonResult = {
				evalId: 'skilled-fake',
				webhands: fakeRun('shell', 'PASS', ['a'], 4, {
					output: 15_200,
					total: 6_582_300,
				}),
				skilled: fakeRun('webhands-skilled', 'PASS', ['a'], 4, {
					output: 9100,
					total: 2_100_000,
				}),
				playwright: fakeRun('playwright', 'PASS', ['a'], 4, {
					output: 6400,
					total: 839_500,
				}),
			};
			const out = formatComparison(comparison);
			// The header frames it as same-goal and counts THREE toolkits.
			expect(out).toContain('skilled-fake');
			expect(out).toMatch(/same goal/i);
			expect(out).toContain('3 toolkits');
			// One labelled row per leg, in cold -> skilled -> Playwright order.
			const coldIdx = out.indexOf('shell');
			const skilledIdx = out.indexOf('webhands-skilled');
			const pwIdx = out.indexOf('playwright');
			expect(coldIdx).toBeGreaterThanOrEqual(0);
			expect(skilledIdx).toBeGreaterThan(coldIdx);
			expect(pwIdx).toBeGreaterThan(skilledIdx);
			// Tokens print in the SAME shape for every leg (apples-to-apples).
			expect(out).toContain('out 15.2k');
			expect(out).toContain('out 9.1k');
			expect(out).toContain('out 6.4k');
		});

		it('still renders the original TWO-WAY read when no skilled leg is present', () => {
			const comparison: ComparisonResult = {
				evalId: 'skilled-fake',
				webhands: fakeRun('shell', 'PASS', [], 0, {total: 1000}),
				playwright: fakeRun('playwright', 'PASS', [], 0, {total: 500}),
			};
			const out = formatComparison(comparison);
			expect(out).toContain('2 toolkits');
			expect(out).toContain('shell');
			expect(out).toContain('playwright');
			expect(out).not.toContain('webhands-skilled');
		});
	});
});
