import type {VerbTraceEntry} from './verb-trace.js';
import {hasEnvPlaceholder} from './env-substitution.js';

/**
 * The `distill` authoring core (prd `distill-session-into-hand`; task
 * `distill-verb-emits-hand-scaffold`, covers stories 1, 2, 3, 4, 6, 10, 11,
 * 12).
 *
 * `distill` reduces a just-driven session into a reusable HAND SCAFFOLD (a
 * `Hand` in the FROZEN ADR-0007 shape, closing over `ctx.pwPage`) plus a
 * human-readable NOTES markdown, so a flow an agent explored once becomes a
 * one-call verb after a HUMAN adopts it. This module is the pure authoring core:
 * given the session's ordered {@link VerbTraceEntry} trace (the portable,
 * ground-truth BACKBONE from `serve-session-verb-trace`) and optional
 * enrichments, it EMITS two strings. It does NO I/O and, above all, it EMITS and
 * does NOT LOAD.
 *
 * HARD INVARIANT (load-bearing safety, prd + task): `distill` NEVER writes
 * `hands.json` and NEVER `import()`s the emitted module. This module cannot: it
 * only builds strings. ADOPTING a hand (naming it in `hands.json`) stays the
 * human's explicit, operator-scoped trust act (ADR-0007: loading a hand ==
 * trusting an in-process npm dependency). The trust invariant is a TEST at the
 * seam that writes the files (the CLI `distill` verb): it asserts no config
 * write and no `import()`.
 *
 * FAITHFUL REPLAY + ANNOTATED TODOs (prd implementation decision). The emitted
 * hand replays the discovered steps FAITHFULLY, in order, against
 * `ctx.pwPage` — the SAME steps the trace recorded. Turning that faithful
 * replay into a PARAMETERIZED hand (e.g. `checkout(itemId)`) is left as
 * annotated TODOs informed by `--summary`/`--session-file`, NOT auto-invented:
 * `distill` records what drove the page, it does not guess intent.
 *
 * NO LITERAL SECRETS (inherited, prd resolved decision #1). A typed credential
 * is already the `{ENV:NAME}` token by the time it reaches the trace (the
 * `type` verb substitutes downstream, in-process), so the scaffold and notes
 * carry only the token, never the resolved secret. The emitted hand types the
 * SAME token, and the ADR-0012 `page.fill` semantics resolve it at run-time
 * exactly as a hand-authored module would — which is also what keeps the
 * scaffold reusable without embedding a secret.
 */

/**
 * The optional enrichments + slice selector `distill` accepts. All are OPTIONAL:
 * with none, a useful scaffold still comes from the trace alone (the BACKBONE).
 */
export interface DistillOptions {
	/**
	 * The hand's verb NAME in the emitted scaffold (the single verb the replay is
	 * exposed as). Defaults to {@link DEFAULT_HAND_VERB}. A human renames it on
	 * adoption; it is only the scaffold's starting identifier.
	 */
	readonly handName?: string;
	/**
	 * The agent's own intent/recollection (`--summary <text>`): WHY the steps
	 * happened, which the bare trace lacks. A reconstruction, so it ENRICHES the
	 * notes + the scaffold's TODO annotations rather than replacing the trace.
	 * Omitted ⇒ a scaffold from the trace alone.
	 */
	readonly summary?: string;
	/**
	 * The CONTENTS of a `--session-file <path>` the agent HANDED webhands (a
	 * transcript it can already reach). A PLAIN input: the caller reads the file
	 * and passes its text here; this core never discovers a transcript location
	 * (out of scope by contract — that is the `harness-seam-session-awareness`
	 * idea). Used only to enrich the notes; omitted ⇒ no transcript section.
	 */
	readonly sessionFile?: string;
	/**
	 * A caller-named SLICE of the trace to crystallize (a 0-based, INCLUSIVE index
	 * range over the ordered steps), so the hand encodes the sub-flow that matters
	 * (the checkout), not the earlier failed probes. `from` defaults to the first
	 * step, `to` to the last; omitting BOTH crystallizes the WHOLE session (the
	 * default). See {@link sliceTrace}.
	 */
	readonly from?: number;
	readonly to?: number;
}

/** What `distill` EMITS: the two artifacts, as strings (this core does no I/O). */
export interface DistillResult {
	/**
	 * The hand MODULE scaffold: a `Hand` in the FROZEN ADR-0007 shape (a factory
	 * closing over `ctx.pwPage`) that replays the sliced steps. Ready to write to
	 * a `--out` path; ready to `import()` ONLY once a human adopts it (never by
	 * `distill`).
	 */
	readonly scaffold: string;
	/**
	 * The human-readable NOTES markdown: what the flow does, its steps, the
	 * selectors used, notable decisions/dead-ends, so a human can judge it fast.
	 */
	readonly notes: string;
}

/** The default verb name the emitted hand exposes (a human renames on adoption). */
export const DEFAULT_HAND_VERB = 'replay';

/**
 * Crystallize a caller-named SLICE of the ordered trace: a 0-based, INCLUSIVE
 * index range `[from, to]` over the steps, so the hand encodes only the sub-flow
 * that matters. `from` defaults to the first step (`0`), `to` to the last; a
 * range with BOTH omitted is the WHOLE trace (the default). Out-of-range bounds
 * are CLAMPED to the trace (a friendly, faithful subset) rather than throwing,
 * and an inverted range (`from > to`) yields an EMPTY slice. Pure; returns a new
 * array (a shallow copy of the selected entries).
 */
export function sliceTrace(
	entries: readonly VerbTraceEntry[],
	options: {from?: number; to?: number} = {},
): readonly VerbTraceEntry[] {
	if (entries.length === 0) {
		return [];
	}
	const last = entries.length - 1;
	const from = clamp(options.from ?? 0, 0, last);
	const to = clamp(options.to ?? last, 0, last);
	if (from > to) {
		return [];
	}
	return entries.slice(from, to + 1);
}

/** Clamp `n` into the inclusive `[lo, hi]` range (integer indices). */
function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

/**
 * Reduce a session's verb trace into a `Hand` scaffold + notes markdown (the
 * authoring core). Applies the {@link DistillOptions.from}/`to` slice, emits a
 * faithful replay of the sliced steps as an ADR-0007 `Hand`, and a notes
 * markdown listing the flow's steps/selectors/decisions. Pure: no I/O, no
 * config write, no `import()`.
 */
export function distillTrace(
	entries: readonly VerbTraceEntry[],
	options: DistillOptions = {},
): DistillResult {
	const sliced = sliceTrace(entries, options);
	const handName = normalizeVerbName(options.handName ?? DEFAULT_HAND_VERB);
	const steps = sliced.map(describeStep);
	return {
		scaffold: renderScaffold(handName, steps, sliced, options),
		notes: renderNotes(handName, steps, options),
	};
}

// ---------------------------------------------------------------------------
// Step description: turn one recorded verb into (a) a Playwright replay line for
// the scaffold and (b) a human-readable summary for the notes. One place so the
// two artifacts describe the SAME step and cannot drift.
// ---------------------------------------------------------------------------

/** A recorded step reduced to what both artifacts need to describe it. */
interface DescribedStep {
	/** The recorded verb name (the trace's `verb`). */
	readonly verb: string;
	/** The Playwright replay statement(s) for the scaffold (already indented). */
	readonly replay: readonly string[];
	/** A one-line human summary for the notes' step list. */
	readonly summary: string;
	/** Any selector/locator the step used, surfaced in the notes. */
	readonly selector?: string;
	/**
	 * True when the step could not be replayed faithfully as a plain Playwright
	 * call (e.g. a `script`/`eval`/hand verb) and is left as an annotated TODO in
	 * the scaffold. Surfaced as a dead-end/decision note.
	 */
	readonly todo: boolean;
}

/**
 * Reduce one {@link VerbTraceEntry} to a {@link DescribedStep}. Every built-in
 * ACT/READ verb maps to the faithful `page.*` call an agent would hand-write;
 * verbs whose faithful replay cannot be a plain Playwright call (`script`,
 * `eval`, a dynamically-loaded hand verb) are left as an annotated TODO the
 * human completes, rather than auto-invented.
 */
function describeStep(entry: VerbTraceEntry): DescribedStep {
	const req = entry.request as Record<string, unknown>;
	switch (entry.verb) {
		case 'navigate': {
			const url = String(req.url ?? '');
			return {
				verb: 'navigate',
				replay: [`await page.goto(${lit(url)});`],
				summary: `navigate to ${url}`,
				todo: false,
			};
		}
		case 'click': {
			const loc = String(req.locator ?? '');
			return {
				verb: 'click',
				replay: [`await ${resolve(loc)}.click();`],
				summary: `click ${loc}`,
				selector: loc,
				todo: false,
			};
		}
		case 'type': {
			const loc = String(req.locator ?? '');
			const text = String(req.text ?? '');
			return {
				verb: 'type',
				// The value is replayed AS THE TRACE RECORDED IT — an `{ENV:NAME}`
				// token stays the token, so the scaffold embeds no secret and the
				// value resolves at run-time exactly as the live verb did.
				replay: [`await ${resolve(loc)}.fill(${lit(text)});`],
				summary: `type into ${loc}${
					hasEnvPlaceholder(text) ? ` the ${text} placeholder` : ''
				}`,
				selector: loc,
				todo: false,
			};
		}
		case 'press': {
			const key = String(req.key ?? '');
			const loc = req.locator === undefined ? undefined : String(req.locator);
			return {
				verb: 'press',
				replay: [
					loc === undefined
						? `await page.keyboard.press(${lit(key)});`
						: `await ${resolve(loc)}.press(${lit(key)});`,
				],
				summary:
					loc === undefined
						? `press ${key} (focused element)`
						: `press ${key} at ${loc}`,
				selector: loc,
				todo: false,
			};
		}
		case 'hover': {
			const loc = String(req.locator ?? '');
			return {
				verb: 'hover',
				replay: [`await ${resolve(loc)}.hover();`],
				summary: `hover ${loc}`,
				selector: loc,
				todo: false,
			};
		}
		case 'select': {
			const loc = String(req.locator ?? '');
			const choice = req.choice as {value?: string; label?: string} | undefined;
			const arg =
				choice !== undefined && 'value' in choice
					? `{value: ${lit(String(choice.value))}}`
					: `{label: ${lit(String(choice?.label ?? ''))}}`;
			return {
				verb: 'select',
				replay: [`await ${resolve(loc)}.selectOption(${arg});`],
				summary: `select ${arg} in ${loc}`,
				selector: loc,
				todo: false,
			};
		}
		case 'drag': {
			const source = String(req.source ?? '');
			const target = String(req.target ?? '');
			return {
				verb: 'drag',
				replay: [`await ${resolve(source)}.dragTo(${resolve(target)});`],
				summary: `drag ${source} onto ${target}`,
				selector: source,
				todo: false,
			};
		}
		case 'wait': {
			const cond = req.condition as
				| {kind: string; ms?: number; target?: string}
				| undefined;
			return describeWait(cond);
		}
		case 'scroll': {
			const target = req.target as
				| {to?: string; by?: {dx: number; dy: number}}
				| undefined;
			if (target !== undefined && 'to' in target && target.to !== undefined) {
				return {
					verb: 'scroll',
					replay: [`await ${resolve(target.to)}.scrollIntoViewIfNeeded();`],
					summary: `scroll ${target.to} into view`,
					selector: target.to,
					todo: false,
				};
			}
			const by = target?.by ?? {dx: 0, dy: 0};
			return {
				verb: 'scroll',
				replay: [`await page.mouse.wheel(${by.dx}, ${by.dy});`],
				summary: `scroll by (${by.dx}, ${by.dy})`,
				todo: false,
			};
		}
		case 'mouse': {
			const input = req.input as
				| {action: string; x: number; y: number; button?: string}
				| undefined;
			const action = input?.action ?? 'click';
			const x = input?.x ?? 0;
			const y = input?.y ?? 0;
			return {
				verb: 'mouse',
				replay: [mouseReplay(action, x, y, input?.button)],
				summary: `mouse ${action} at (${x}, ${y})`,
				todo: false,
			};
		}
		case 'setCookies':
			return {
				verb: 'setCookies',
				replay: [
					`// TODO: seed cookies this flow relied on (recorded in the trace).`,
					`// await ctx.context.addCookies([...]);`,
				],
				summary: 'set cookies (left as a TODO: seed from your own source)',
				todo: true,
			};
		default:
			// A READ verb (snapshot/query/count/exists/isVisible/getAttribute/
			// cookies), an `eval`/`script` escape hatch, or a dynamically-loaded
			// hand verb: its faithful replay is not a single plain Playwright act,
			// so leave it as an annotated TODO the human completes rather than
			// auto-invent it (prd: faithful replay + annotated TODOs, not guessed
			// intent).
			return describeUnreplayable(entry);
	}
}

/** Describe a `wait` step (its three forms) for replay + notes. */
function describeWait(
	cond: {kind: string; ms?: number; target?: string} | undefined,
): DescribedStep {
	if (cond?.kind === 'timeout') {
		return {
			verb: 'wait',
			replay: [`await page.waitForTimeout(${cond.ms ?? 0});`],
			summary: `wait ${cond.ms ?? 0}ms`,
			todo: false,
		};
	}
	if (cond?.kind === 'locator' && cond.target !== undefined) {
		return {
			verb: 'wait',
			replay: [`await ${resolve(cond.target)}.waitFor();`],
			summary: `wait for ${cond.target}`,
			selector: cond.target,
			todo: false,
		};
	}
	// navigation form.
	return {
		verb: 'wait',
		replay: [`await page.waitForNavigation();`],
		summary: 'wait for the next navigation',
		todo: false,
	};
}

/** The Playwright replay line for a recorded `mouse` step. */
function mouseReplay(
	action: string,
	x: number,
	y: number,
	button?: string,
): string {
	const btn = button !== undefined ? `, {button: ${lit(button)}}` : '';
	const downArg = btn !== '' ? btn.slice(2) : '';
	switch (action) {
		case 'move':
			return `await page.mouse.move(${x}, ${y});`;
		case 'down':
			// Position the pointer, then press: a `mouse.down` has no coordinates.
			return `await page.mouse.move(${x}, ${y});\nawait page.mouse.down(${downArg});`;
		case 'up':
			return `await page.mouse.up(${downArg});`;
		default:
			return `await page.mouse.click(${x}, ${y}${btn});`;
	}
}

/**
 * Describe a step whose faithful replay is not a single plain Playwright act
 * (a READ verb, `eval`/`script`, or a hand verb): leave an annotated TODO in the
 * scaffold naming what ran, so the human can decide whether the sub-flow needs
 * it, rather than auto-inventing a replay.
 */
function describeUnreplayable(entry: VerbTraceEntry): DescribedStep {
	const req = entry.request as Record<string, unknown>;
	const loc = typeof req.locator === 'string' ? req.locator : undefined;
	return {
		verb: entry.verb,
		replay: [
			`// TODO: the session ran \`${entry.verb}\`${
				loc !== undefined ? ` on ${loc}` : ''
			} here.`,
			`// It was a read/probe or an escape hatch; decide if the flow needs it,`,
			`// then replace this with the driver-context calls it implies.`,
		],
		summary: `${entry.verb}${loc !== undefined ? ` ${loc}` : ''} (left as a TODO: read/probe or escape hatch)`,
		selector: loc,
		todo: true,
	};
}

// ---------------------------------------------------------------------------
// Scaffold rendering: the emitted ADR-0007 `Hand` module.
// ---------------------------------------------------------------------------

/**
 * Render the emitted hand MODULE: a `Hand` in the FROZEN ADR-0007 shape (a
 * factory `(ctx) => ({verbs: {...}})` closing over `ctx.pwPage`) whose single
 * verb replays the sliced steps in order. It is a DEFAULT export (the shape the
 * ADR-0007 loader accepts) so it drops into the existing loading path once a
 * human adopts it — but `distill` NEVER loads it.
 */
function renderScaffold(
	handName: string,
	steps: readonly DescribedStep[],
	sliced: readonly VerbTraceEntry[],
	options: DistillOptions,
): string {
	const header = scaffoldHeader(sliced.length, options);
	// Body lines sit inside `async <verb>() {` (four tabs deep). Each step's
	// replay lines may themselves be multi-line, so indent every physical line.
	const body =
		steps.length === 0
			? [
					'// The distilled slice was empty (no steps to replay).',
					'// TODO: drive the flow, then re-run `distill`.',
				]
					.map((line) => `\t\t\t\t${line}`)
					.join('\n')
			: steps
					.flatMap((step) => step.replay)
					.flatMap((line) => line.split('\n'))
					.map((line) => `\t\t\t\t${line}`)
					.join('\n');

	return `${header}/**
 * @typedef {import('@webhands/core').Hand} Hand
 * @typedef {import('@webhands/core').HandContext} HandContext
 */

/**
 * A hand SCAFFOLD distilled from a webhands session's verb trace.
 *
 * FROZEN ADR-0007 shape: a factory that, given the live {@link HandContext}
 * (closing over \`ctx.pwPage\`), contributes the \`${handName}\` verb replaying the
 * discovered steps. Adopt it by NAMING it in \`<home>/hands.json\` (the operator's
 * explicit trust act); \`distill\` emitted it but never loaded it.
 *
 * TODO: turn this faithful replay into a PARAMETERIZED verb (e.g. take an id /
 * search term as an argument) where the flow varies per run. The annotated TODOs
 * below and the notes markdown beside this file capture what each step did.
 *
 * @type {Hand}
 */
export default function distilledHand(ctx) {
\tconst {pwPage: page} = ctx;
\treturn {
\t\tverbs: {
\t\t\tasync ${handName}() {
${body}
\t\t\t},
\t\t},
\t};
}
`;
}

/** The scaffold's provenance header comment (summary + slice info as context). */
function scaffoldHeader(stepCount: number, options: DistillOptions): string {
	const lines = [
		'// Distilled by `webhands distill` from the session verb trace.',
		'// EMITTED, NOT LOADED: review this file, then adopt it by naming it in',
		'// <home>/hands.json (ADR-0007). `distill` never wrote hands.json.',
		`// Steps replayed: ${stepCount}.`,
	];
	if (options.summary !== undefined && options.summary.trim() !== '') {
		lines.push(`// Intent (--summary): ${oneLine(options.summary)}`);
	}
	return lines.join('\n') + '\n\n';
}

// ---------------------------------------------------------------------------
// Notes rendering: the human-readable judge-it-fast markdown.
// ---------------------------------------------------------------------------

/**
 * Render the human-readable NOTES markdown: what the flow does, its ordered
 * steps, the selectors it used, and notable decisions/dead-ends, so a human can
 * judge the scaffold fast before adopting it. The enrichments (`--summary`,
 * `--session-file`) appear as their own sections when given.
 */
function renderNotes(
	handName: string,
	steps: readonly DescribedStep[],
	options: DistillOptions,
): string {
	const parts: string[] = [];
	parts.push(`# Distilled hand: \`${handName}\``);
	parts.push(
		'Emitted by `webhands distill` from the session verb trace. This is a ' +
			'SCAFFOLD (a faithful replay of the discovered steps), not a ' +
			'guaranteed-correct hand. Review it, then adopt it by naming it in ' +
			'`hands.json` (ADR-0007); `distill` never loaded it.',
	);

	parts.push('## What the flow does');
	if (options.summary !== undefined && options.summary.trim() !== '') {
		parts.push(options.summary.trim());
	} else {
		parts.push(
			'_No `--summary` was given. The steps below are what actually drove the ' +
				'page; add intent when you adopt this hand._',
		);
	}

	parts.push('## Steps');
	if (steps.length === 0) {
		parts.push('_The distilled slice was empty (no steps)._');
	} else {
		parts.push(steps.map((step, i) => `${i + 1}. ${step.summary}`).join('\n'));
	}

	const selectors = uniqueSelectors(steps);
	if (selectors.length > 0) {
		parts.push('## Selectors used');
		parts.push(selectors.map((sel) => `- \`${sel}\``).join('\n'));
	}

	const decisions = steps.filter((s) => s.todo);
	if (decisions.length > 0) {
		parts.push('## Decisions / dead-ends (left as TODOs)');
		parts.push(
			'These steps were reads/probes or escape hatches (`eval`/`script`/hand ' +
				'verbs) that `distill` did not auto-replay; decide whether the flow ' +
				'needs them:',
		);
		parts.push(decisions.map((s) => `- ${s.summary}`).join('\n'));
	}

	if (options.sessionFile !== undefined && options.sessionFile.trim() !== '') {
		parts.push('## Session transcript (from `--session-file`)');
		parts.push(
			'The agent HANDED webhands this transcript (a plain path it could ' +
				'reach); mine it for the reasoning behind the steps:',
		);
		parts.push('```\n' + options.sessionFile.trim() + '\n```');
	}

	return parts.join('\n\n') + '\n';
}

/** The distinct selectors the steps used, in first-seen order (for the notes). */
function uniqueSelectors(steps: readonly DescribedStep[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const step of steps) {
		if (step.selector !== undefined && !seen.has(step.selector)) {
			seen.add(step.selector);
			out.push(step.selector);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Small rendering helpers.
// ---------------------------------------------------------------------------

/**
 * Wrap a raw locator EXPRESSION the trace recorded (ADR-0004 grammar, e.g.
 * `getByRole('button', {name: 'Buy'})` or `#id`) into a `page.locator(...)`
 * call for the scaffold. The verbs recorded the locator as the agent passed it;
 * a bare CSS/text selector is wrapped in `page.locator(...)`, while an
 * expression that already reads as a `page.`/`p.` locator builder is used
 * as-is (rebased onto `page`) so the replay mirrors what drove the live page.
 */
function resolve(expression: string): string {
	const trimmed = expression.trim();
	if (/^p\./.test(trimmed)) {
		return trimmed.replace(/^p\./, 'page.');
	}
	if (/^page\./.test(trimmed)) {
		return trimmed;
	}
	return `page.locator(${lit(expression)})`;
}

/** A JS string literal for the scaffold (JSON-encoded: safe for any content). */
function lit(value: string): string {
	return JSON.stringify(value);
}

/** Collapse a possibly-multiline string to one line for a header comment. */
function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a caller-proposed hand verb name to a safe JS identifier for the
 * scaffold. A human renames it on adoption, so this only guarantees the emitted
 * module is syntactically valid: strip to `[A-Za-z0-9_$]`, ensure it does not
 * start with a digit, and fall back to {@link DEFAULT_HAND_VERB} when empty.
 */
function normalizeVerbName(name: string): string {
	let cleaned = name.replace(/[^A-Za-z0-9_$]/g, '');
	if (cleaned === '') {
		return DEFAULT_HAND_VERB;
	}
	if (/^[0-9]/.test(cleaned)) {
		cleaned = `_${cleaned}`;
	}
	return cleaned;
}
