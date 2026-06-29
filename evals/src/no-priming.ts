import type {EvalEntry} from './eval-contract.js';

/**
 * The NO-PRIMING property (prd property 3; user story 4), ENFORCED as code, not
 * a comment.
 *
 * What makes this a CAPABILITY eval and not a scripted test is that the agent
 * receives EXACTLY the goal-prompt text + the verb-surface reference, and
 * NOTHING ELSE: no selectors, no step list, no site URLs beyond the one entry
 * point named in the goal. {@link buildAgentInput} is the ONE place an
 * agent-under-test's input is assembled, and it refuses to leak anything past
 * that boundary, so a future eval author cannot accidentally hand the agent a
 * selector by editing prose elsewhere.
 *
 * The guard binds ONLY the D1 capability-subject adapters (the shell adapter).
 * The D3 scripted self-test is PRIMED by construction and never passes through
 * here: that separation is what stops a primed script masquerading as a
 * capability pass (prd D3).
 */

/** The verb-surface reference the agent is pointed at (and nothing more). */
export const VERB_SURFACE_REFERENCE =
	'Your only tool is the `webhands` CLI. Discover its full verb surface with ' +
	'`npx webhands --llms-full` (or `npx webhands <verb> --help` for one verb). ' +
	'Use only those verbs to drive the browser; do not assume any site-specific ' +
	'selectors, steps, or URLs beyond the one named in the goal.';

/** A locator/selector-shaped fragment a goal-prompt must NOT carry. */
const SELECTOR_SHAPES: readonly RegExp[] = [
	/page\.locator\(/i,
	/getByRole\(/i,
	/getByTestId\(/i,
	/getByText\(/i,
	/frameLocator\(/i,
	/querySelector/i,
	/\bcss=|\bxpath=/i,
	/data-testid/i,
	/#[A-Za-z][\w-]*\s*(?:\{|>|\.|$)/, // a bare CSS id selector
];

/** Thrown when an eval entry's goal-prompt would prime the agent. */
export class PrimingViolationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PrimingViolationError';
	}
}

/**
 * Assert an eval entry's goal-prompt does NOT prime the agent: it must carry no
 * selector-shaped fragment, and the only URL it may name is the entry URL. A
 * violation throws {@link PrimingViolationError} (load-bearing: the harness runs
 * this BEFORE launching the agent, so a primed eval never reaches a real run).
 */
export function assertNoPriming(entry: EvalEntry): void {
	for (const shape of SELECTOR_SHAPES) {
		if (shape.test(entry.goalPrompt)) {
			throw new PrimingViolationError(
				`eval '${entry.id}' goal-prompt carries a selector-shaped fragment ` +
					`(matched ${shape}); the agent must receive NO selectors. Describe ` +
					`the goal in plain language and let the agent discover the page.`,
			);
		}
	}
	for (const url of extractUrls(entry.goalPrompt)) {
		if (!sameEntry(url, entry.entryUrl)) {
			throw new PrimingViolationError(
				`eval '${entry.id}' goal-prompt names a URL (${url}) other than its ` +
					`entry URL (${entry.entryUrl}); the agent may be told ONLY the one ` +
					`entry point. Remove the extra URL.`,
			);
		}
	}
}

/**
 * Assemble the EXACT text handed to the agent-under-test on stdin: the
 * goal-prompt + the verb-surface reference, and nothing else. Runs
 * {@link assertNoPriming} first, so building the input is the enforcement point.
 * This is the ONLY sanctioned way to produce agent input; the shell adapter
 * consumes its return verbatim.
 */
export function buildAgentInput(entry: EvalEntry): string {
	assertNoPriming(entry);
	return `${entry.goalPrompt.trim()}\n\n${VERB_SURFACE_REFERENCE}\n`;
}

/** Extract http(s) URLs mentioned in text. */
function extractUrls(text: string): string[] {
	const matches = text.match(/https?:\/\/[^\s"'`)<>]+/gi);
	return matches ?? [];
}

/**
 * Are two URLs the same entry point? Compares origin + path, ignoring a
 * trailing slash and any query/hash, so naming the entry URL with or without a
 * trailing `/` is not flagged as priming.
 */
function sameEntry(a: string, b: string): boolean {
	try {
		const ua = new URL(a);
		const ub = new URL(b);
		const norm = (u: URL) =>
			`${u.origin}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
		return norm(ua) === norm(ub);
	} catch {
		return a === b;
	}
}
