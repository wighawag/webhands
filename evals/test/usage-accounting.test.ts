import {describe, expect, it} from 'vitest';
import {
	UsageAccumulator,
	extractUsage,
	type AgentUnderTest,
	type AgentUsage,
	type LaunchInput,
	type LaunchResult,
} from '../src/agent-under-test.js';
import {formatUsage} from '../src/run-eval.js';

/**
 * Token-usage accounting plumbing self-test (task
 * `eval-token-accounting-for-webhands-vs-baseline`).
 *
 * DETERMINISTIC, no live site, no real agent: it exercises the usage PLUMBING in
 * isolation: a fake adapter returning a known {@link AgentUsage} is surfaced on
 * the launch result and printed as a compact comparable line; an `undefined`
 * adapter prints `tokens: unknown`; and the opt-in pi-json stream summing folds
 * NDJSON `usage` events into a record (and reports `undefined` when no event was
 * seen). It is TOOLKIT-AGNOSTIC: nothing here assumes webhands.
 *
 * It runs under `evals/`'s OWN vitest (the `self-test` script), NEVER the repo
 * gate (`pnpm test` = `pnpm --filter './packages/*' test` cannot reach here).
 */

/**
 * A FAKE adapter (NOT a capability subject, NOT the D3 scripted trace): it never
 * launches anything, it just returns a fixed {@link LaunchResult}. Used to prove
 * the usage field flows seam -> result -> printed line, with a KNOWN value.
 */
class FakeAdapter implements AgentUnderTest {
	readonly adapter = 'fake';
	constructor(private readonly result: LaunchResult) {}
	async launch(_input: LaunchInput): Promise<LaunchResult> {
		void _input;
		return this.result;
	}
}

describe('token-usage accounting plumbing (deterministic, no live site)', () => {
	it('a fake adapter with KNOWN usage surfaces it on the launch result + prints a compact line', async () => {
		const usage: AgentUsage = {input: 12_300, output: 4100, total: 16_400};
		const adapter = new FakeAdapter({
			status: 'reported-done',
			output: 'done',
			usage,
		});
		const result = await adapter.launch({} as LaunchInput);

		// Surfaced on the launch result (which EvalRunResult carries verbatim).
		expect(result.usage).toEqual(usage);
		// Printed as a compact, comparable summary on the runner line.
		expect(formatUsage(result.usage)).toBe(
			'tokens: in 12.3k / out 4.1k / total 16.4k',
		);
	});

	it('an adapter that could NOT observe usage (undefined) prints `tokens: unknown` (never a fake zero)', async () => {
		const adapter = new FakeAdapter({status: 'reported-done', output: 'done'});
		const result = await adapter.launch({} as LaunchInput);

		expect(result.usage).toBeUndefined();
		expect(formatUsage(result.usage)).toBe('tokens: unknown');
	});

	it('formatUsage shows only the components actually observed (honest partial)', () => {
		expect(formatUsage({input: 500, output: 250})).toBe(
			'tokens: in 500 / out 250',
		);
		expect(formatUsage({total: 2500, cost: 0.42})).toBe(
			'tokens: total 2.5k / cost 0.42',
		);
		// A record with NO observed component is still an honest unknown.
		expect(formatUsage({})).toBe('tokens: unknown');
	});

	describe('opt-in pi `--mode json` usage summing (UsageAccumulator)', () => {
		it('sums `usage` objects across NDJSON events into a record', () => {
			const acc = new UsageAccumulator();
			// Top-level usage on a message event.
			acc.consumeLine(
				JSON.stringify({
					type: 'message_end',
					usage: {input: 100, output: 40, totalTokens: 140},
				}),
			);
			// Nested under `message`, with cache + cost components.
			acc.consumeLine(
				JSON.stringify({
					type: 'message_end',
					message: {
						usage: {
							input: 50,
							output: 10,
							cacheRead: 30,
							cost: 0.01,
							totalTokens: 60,
						},
					},
				}),
			);
			// Non-JSON and usage-less lines are ignored.
			acc.consumeLine('plain text line, not JSON');
			acc.consumeLine(JSON.stringify({type: 'agent_start'}));

			expect(acc.result()).toEqual({
				input: 150,
				output: 50,
				cacheRead: 30,
				total: 200,
				cost: 0.01,
			});
		});

		it('reports `undefined` when NO usage event was ever seen (honest unknown)', () => {
			const acc = new UsageAccumulator();
			acc.consumeLine('not json');
			acc.consumeLine(
				JSON.stringify({type: 'tool_execution_start', toolName: 'bash'}),
			);
			expect(acc.result()).toBeUndefined();
			expect(formatUsage(acc.result())).toBe('tokens: unknown');
		});

		it('derives an honest total from input+output when no totalTokens was reported', () => {
			const acc = new UsageAccumulator();
			acc.consumeLine(JSON.stringify({usage: {input: 80, output: 20}}));
			expect(acc.result()).toEqual({input: 80, output: 20, total: 100});
		});

		it('extractUsage tolerates non-JSON, usage-less, and non-object usage values', () => {
			expect(extractUsage('')).toBeUndefined();
			expect(extractUsage('{not json')).toBeUndefined();
			expect(extractUsage(JSON.stringify({type: 'x'}))).toBeUndefined();
			expect(extractUsage(JSON.stringify({usage: 'nope'}))).toBeUndefined();
			expect(extractUsage(JSON.stringify({usage: {input: 5}}))).toEqual({
				input: 5,
			});
		});
	});
});
