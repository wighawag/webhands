import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	resolveMessyModel,
	computeExpectedTarget,
	renderMessyHtml,
	startMessyDomFixtureServer,
	type MessyDomFixtureServer,
	type MessyDomModel,
} from '../src/messy-dom-fixture.js';
import {buildMessyDomExploreEval} from '../src/catalogue/messy-dom-explore.eval.js';
import {startServe, type ServeSession} from '../src/serve-lifecycle.js';
import {VerbClient, type WebhandsCommand} from '../src/verb-client.js';
import {replayTrace, type ScriptedTrace} from '../src/scripted-trace.js';
import {evaluateOutcome} from '../src/outcome.js';
import {assertNoPriming, buildAgentInput} from '../src/no-priming.js';
import {mintNonce} from '../src/nonce.js';

/**
 * The DETERMINISTIC machinery self-test for the MESSY-DOM explore eval (task
 * `eval-tier3-local-messy-dom-explore-then-act`, the same shape as the dynamic
 * cart self-test). It exercises the new eval's PLUMBING + the MESSY LEVERS
 * against the LOCAL nonce-seeded fixture with NO real agent and NO live site:
 *
 *  - the fixture is nonce-DETERMINISTIC (same nonce -> same DOM + same correct
 *    target), proven over many nonces;
 *  - the messy levers actually HOLD: the actionable targets carry NO stable
 *    id/testid/role; the correct target is identified only by run-revealed nonce
 *    CONTENT; decoys are present; a reveal step is required (the target is not on
 *    the first view), and the option rows are injected LATE;
 *  - the GOAL is no-priming-clean (names the condition, not selectors/words/codes);
 *  - a PRIMED correct explore-then-act trace -> PASS with all milestones;
 *  - a PRIMED wrong-target trace (open the correct section but click a DECOY row)
 *    -> FAIL on the end-state check, proving the assertion is the harness's own
 *    page read and not the agent's word.
 *
 * It is PRIMED by construction (the trace IS the verb steps a real agent would
 * have to DISCOVER from the live page), so a green run is a MACHINERY proof, not
 * a capability pass. It runs under `evals/`'s OWN vitest (`self-test`), NEVER the
 * repo gate (`pnpm test`), and the fixture is purely local anyway.
 */

/** The real built webhands bin (the harness drives the PUBLISHED surface). */
function webhandsCommand(): WebhandsCommand {
	const here = dirname(fileURLToPath(import.meta.url));
	const bin = join(here, '..', '..', 'packages', 'cli', 'dist', 'bin.js');
	return {command: process.execPath, args: [bin]};
}

describe('messy-dom explore eval (machinery proof, local nonce-seeded fixture, NOT a capability subject)', () => {
	let fixture: MessyDomFixtureServer;
	const tempRoots: string[] = [];
	const sessions: ServeSession[] = [];

	beforeEach(async () => {
		// A FRESH nonce-seeded page per test, so each test sees an independent
		// randomised directory + correct target (like a real per-run mint).
		fixture = await startMessyDomFixtureServer(resolveMessyModel(mintNonce()));
	});

	afterEach(async () => {
		while (sessions.length > 0) {
			await sessions.pop()!.stop();
		}
		while (tempRoots.length > 0) {
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		}
		await fixture.close();
	});

	afterAll(async () => {
		// nothing global to tear down (each test owns its fixture)
	});

	/** Make an isolated WEBHANDS_HOME with a warmed (empty) default profile. */
	async function isolatedHome(): Promise<string> {
		const home = await mkdtemp(join(tmpdir(), 'webhands-eval-messy-'));
		tempRoots.push(home);
		await mkdir(join(home, 'profiles', 'default'), {recursive: true});
		return home;
	}

	/** Start a harness-owned serve session against the isolated home. */
	async function serveAgainst(home: string): Promise<ServeSession> {
		const session = await startServe({webhands: webhandsCommand(), home});
		sessions.push(session);
		return session;
	}

	/**
	 * Locate a section TOGGLE by its visible label word, scoped INSIDE #sections so
	 * the same word in the instruction line (outside #sections) is not matched.
	 * This is the PRIMED stand-in for the locate-by-visible-text a real agent must
	 * do, given there is no stable hook on the toggle.
	 */
	function toggleLocator(label: string): string {
		return `page.locator('#sections').getByText(${JSON.stringify(label)}, {exact: true})`;
	}

	/**
	 * Locate an option ROW by its visible code, scoped INSIDE #sections so the same
	 * code in the instruction line is not matched. The PRIMED stand-in for the
	 * locate-by-run-revealed-content a real agent must do (no stable hook on rows).
	 */
	function rowLocator(code: string): string {
		return `page.locator('#sections').getByText(${JSON.stringify(code)}, {exact: true})`;
	}

	/**
	 * A PRIMED known-GOOD explore-then-act trace: open the CORRECT section (click
	 * its toggle, located by visible label), WAIT for the late-injected rows, then
	 * click the CORRECT row (located by its run-revealed code). This is the PRIMED
	 * read->act->read->act loop a real agent must DISCOVER from the live page.
	 */
	function correctTrace(): ScriptedTrace {
		const target = computeExpectedTarget(fixture.model);
		return {
			label: 'correct-explore',
			steps: [
				{verb: 'click', args: [toggleLocator(target.sectionLabel)]},
				// The rows arrive ~350ms after the section opens (LATE content), so a
				// blind same-tick click would miss them: pace, then act.
				{verb: 'wait', args: ['--ms', '900']},
				{verb: 'click', args: [rowLocator(target.optionCode)]},
			],
		};
	}

	/**
	 * A PRIMED WRONG-target trace: open the CORRECT section but click a DECOY row
	 * (a different code in the SAME section). A decoy click never writes the result
	 * marker, so the harness must score a genuine FAIL.
	 */
	function decoyTrace(): ScriptedTrace {
		const {sections, correctSectionIndex, correctOptionIndex} = fixture.model;
		const section = sections[correctSectionIndex];
		const decoyIndex =
			correctOptionIndex === 0 ? section.options.length - 1 : 0;
		const decoyCode = section.options[decoyIndex].code;
		return {
			label: 'decoy',
			steps: [
				{verb: 'click', args: [toggleLocator(section.label)]},
				{verb: 'wait', args: ['--ms', '900']},
				{verb: 'click', args: [rowLocator(decoyCode)]},
			],
		};
	}

	it('the fixture is NONCE-DETERMINISTIC (same nonce -> same DOM + same correct target)', () => {
		// A deterministic sweep over a FIXED nonce list (no Math.random in the
		// assertion, so it can never flake): the same nonce reproduces the page AND
		// the correct target exactly.
		const nonces = Array.from({length: 300}, (_, i) =>
			mintNonce(1_700_000_000_000 + i * 7919),
		);
		for (const nonce of nonces) {
			const a = resolveMessyModel(nonce);
			const b = resolveMessyModel(nonce);
			expect(renderMessyHtml(a)).toBe(renderMessyHtml(b));
			expect(computeExpectedTarget(a)).toEqual(computeExpectedTarget(b));
		}
	});

	it('the MESSY LEVERS hold: no stable hooks on targets; target by nonce content; decoys; a reveal step', () => {
		const nonces = Array.from({length: 300}, (_, i) =>
			mintNonce(1_700_000_000_000 + i * 4093),
		);

		for (const nonce of nonces) {
			const model = resolveMessyModel(nonce);
			const html = renderMessyHtml(model);
			const target = computeExpectedTarget(model);

			// (a) NO STABLE HOOKS ON THE TARGETS: the section toggles + option rows
			// carry no id/data-testid/name/role. (The page-frame landmarks the
			// HARNESS reads - #sections, #explore-result, #explore-instruction,
			// #app-ready, #heading - are scaffolding, not the targets the agent must
			// FIND, exactly as the dynamic fixture keeps #cart-subtotal stable.) So
			// assert no hook appears INSIDE a section toggle's markup.
			for (const section of model.sections) {
				expect(section.toggleClass).not.toMatch(/(^|\s)(id|name|role)(\s|$)/);
				// The class names are meaningless nonce tokens, not semantic words.
				expect(section.toggleClass).toMatch(/^t[0-9a-z]{5}$/);
				for (const opt of section.options) {
					expect(opt.className).toMatch(/^c[0-9a-z]{5}$/);
				}
			}
			// No data-testid / role= attribute anywhere in the served HTML at all.
			expect(html).not.toMatch(/data-testid/);
			expect(html).not.toMatch(/\brole=/);
			// The actionable rows are injected by script from data-options, NOT given
			// id/name attributes; no id= on a row/toggle class.
			expect(html).not.toMatch(/id="(add|row|opt|option|section-)/);

			// (b) THE TARGET IS BY RUN-REVEALED NONCE CONTENT: the correct code is a
			// nonce token only resolvable from the page, and it is genuinely one of
			// the correct section's options.
			const correctSection = model.sections[model.correctSectionIndex];
			expect(correctSection.label).toBe(target.sectionLabel);
			expect(correctSection.options.map((o) => o.code)).toContain(
				target.optionCode,
			);

			// (c) DECOYS: the correct section holds several rows, only one correct.
			expect(correctSection.options.length).toBeGreaterThan(1);
			const distinctCodes = new Set(correctSection.options.map((o) => o.code));
			expect(distinctCodes.size).toBe(correctSection.options.length);

			// (d) A REVEAL STEP IS REQUIRED + LATE CONTENT: the option rows are NOT in
			// the initial markup (they are injected on open via setTimeout), so the
			// target is not on the first view.
			expect(html).toContain('setTimeout(');
			for (const opt of correctSection.options) {
				// The code appears only in the data-options JSON (script-injected),
				// never as a pre-rendered actionable row element in the markup.
				const preRenderedRow = new RegExp(
					`<div[^>]*>${opt.code.replace(/[-]/g, '\\-')}</div>`,
				);
				expect(html).not.toMatch(preRenderedRow);
			}
		}
	});

	it('a BLIND fixed (section, row) choice cannot win every run (the target varies)', () => {
		// A one-shot blind script must hardcode WHICH section word + WHICH code.
		// Both are nonce-seeded, so the correct pair varies per run: there is no
		// single (word, code) a blind script can hardcode that is right every run.
		const nonces = Array.from({length: 400}, (_, i) =>
			mintNonce(1_700_000_000_000 + i * 9973),
		);
		const targets = nonces.map((n) =>
			computeExpectedTarget(resolveMessyModel(n)),
		);
		const distinctSections = new Set(targets.map((t) => t.sectionLabel));
		const distinctCodes = new Set(targets.map((t) => t.optionCode));
		expect(distinctSections.size).toBeGreaterThan(1);
		// Codes are essentially unique per run (nonce tokens), so a fixed code is
		// almost never right.
		expect(distinctCodes.size).toBeGreaterThan(nonces.length / 2);
	});

	it('PRIMED correct explore-then-act trace -> PASS with all milestones reached', async () => {
		const home = await isolatedHome();
		const entry = buildMessyDomExploreEval(`${fixture.url}/`, fixture.model);
		await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});

		await verbs.goto(entry.entryUrl);
		const replay = await replayTrace(correctTrace(), {
			webhands: webhandsCommand(),
			home,
		});
		expect(replay.completed).toBe(true);

		const outcome = await evaluateOutcome({entry, verbs});
		expect(outcome.kind).toBe('PASS');
		expect(outcome.score.passed).toBe(true);
		expect(outcome.score.milestonesReached).toEqual([
			'reached-directory',
			'section-opened',
			'option-revealed',
			'correct-selected',
		]);
	});

	it('PRIMED wrong-target (decoy) trace -> FAIL on a healthy fixture (correct row NOT actioned)', async () => {
		const home = await isolatedHome();
		const entry = buildMessyDomExploreEval(`${fixture.url}/`, fixture.model);
		await serveAgainst(home);
		const verbs = new VerbClient({webhands: webhandsCommand(), home});

		await verbs.goto(entry.entryUrl);
		const replay = await replayTrace(decoyTrace(), {
			webhands: webhandsCommand(),
			home,
		});
		expect(replay.completed).toBe(true);

		const outcome = await evaluateOutcome({entry, verbs, maxAttempts: 3});
		// The fixture is healthy, so a decoy click is a genuine FAIL, not
		// INCONCLUSIVE: the harness read the result marker and the correct code was
		// NOT selected.
		expect(outcome.kind).toBe('FAIL');
		expect(outcome.score.passed).toBe(false);
		// Partial credit: it opened the section + revealed rows, but never selected
		// the CORRECT row, so the final milestone is NOT reached.
		expect(outcome.score.milestonesReached).toEqual([
			'reached-directory',
			'section-opened',
			'option-revealed',
		]);
		// A genuine FAIL is NOT retried.
		expect(outcome.attempts).toBe(1);
	});

	describe('no-priming (the goal names the CONDITION, not selectors/words/codes)', () => {
		it('passes the no-priming guard', () => {
			const entry = buildMessyDomExploreEval(`${fixture.url}/`, fixture.model);
			expect(() => assertNoPriming(entry)).not.toThrow();
		});

		it('hands the agent ONLY the goal + the verb-surface reference (no selectors, no section word, no code)', () => {
			const entry = buildMessyDomExploreEval(`${fixture.url}/`, fixture.model);
			const input = buildAgentInput(entry);
			expect(input).toContain(entry.goalPrompt.trim());
			// No selector/step foreknowledge, and crucially no leaked nonce CONTENT
			// (the section word + code are dynamic; naming one would defeat the eval).
			expect(input).not.toMatch(/page\.locator\(/);
			expect(input).not.toMatch(/#sections|#explore-result|data-section/);
			const target = computeExpectedTarget(fixture.model);
			expect(input).not.toContain(target.sectionLabel);
			expect(input).not.toContain(target.optionCode);
		});

		it('names no URL beyond the single entry point', () => {
			const entry = buildMessyDomExploreEval(`${fixture.url}/`, fixture.model);
			const urls = entry.goalPrompt.match(/https?:\/\/[^\s"'`)<>]+/gi) ?? [];
			expect(urls.length).toBeGreaterThan(0);
			for (const url of urls) {
				expect(url.replace(/\/+$/, '')).toBe(
					entry.entryUrl.replace(/\/+$/, ''),
				);
			}
		});
	});
});
