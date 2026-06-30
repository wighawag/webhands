import {createServer, type Server} from 'node:http';
import {mintNonce} from './nonce.js';

/**
 * The MESSY-DOM, explore-then-act LOCAL fixture (task
 * `eval-tier3-local-messy-dom-explore-then-act`). The FIRST stable tier-3 eval
 * that measures webhands' INTENDED edge: driving a MESSY, unfamiliar DOM where a
 * blind write-once script breaks down because the agent must EXPLORE (snapshot /
 * read) to FIND the right elements before it can act. It replaces the
 * head-to-head gap left by the hard-down live `magento-checkout` tier-3 (finding
 * `work/notes/findings/magento-demo-tier3-stability.md`, HTTP 526 for days), so
 * the tier-3 reading is reproducible and immune to third-party outages.
 *
 * WHY a local fixture and not the live store: the SAME reasoning as the dynamic
 * fixture (`./dynamic-fixture.ts`) - the harness needs a target that is
 * HOST-DETERMINISTIC (every value a pure function of the per-run nonce, so the
 * self-test can re-derive the correct end state) yet AGENT-UNPREDICTABLE (only
 * revealed on the page at run time, so a cached blind script is useless). A live
 * store gives realism but its DOM is not under our control, so we cannot make the
 * messy levers a clean nonce-seeded function the self-test can check, and it can
 * flake the run.
 *
 * PLAYWRIGHT-FAIR (the load-bearing design): both legs face the IDENTICAL DOM, so
 * any webhands edge is about the EXPLORE surface, NEVER a DOM tilted in webhands'
 * favour. The DOM is hostile to BLIND SCRIPTING, not to Playwright: a
 * raw-Playwright agent that READS the page at run time can solve it exactly as a
 * webhands agent can; what neither can do is pre-encode a fixed selector/flow.
 *
 * THE MESSY LEVERS (combined, all nonce-seeded so a cached script is useless):
 *
 *  1. NO SEMANTIC LANDMARKS / NO STABLE HOOKS ON THE TARGETS. The actionable
 *     controls (the section toggles + the option rows) carry NO
 *     `id`/`data-testid`/`name`/ARIA role and a nonce-RANDOMISED, meaningless
 *     class name (e.g. `class="x7f3a2"`). So neither toolkit can hardcode a
 *     selector; BOTH must locate by VISIBLE TEXT / structure discovered at run
 *     time. (The page-frame landmarks - the heading, the instruction line, the
 *     result marker the HARNESS reads - keep stable ids; those are not the
 *     targets the agent must find, they are the scaffolding the harness verdict
 *     reads, exactly as the dynamic fixture keeps `#cart-subtotal` stable.)
 *  2. THE TARGET IS IDENTIFIED ONLY BY CONTENT THE AGENT MUST READ. The page
 *     prints an instruction naming a nonce-seeded SECTION word and a nonce-seeded
 *     option CODE; the correct controls are the section whose label is that word
 *     and the row whose code is that code. A blind script cannot pre-encode
 *     either, because both are nonce-randomised and only shown at run time.
 *  3. MULTI-STEP EXPLORE-TO-REVEAL NAVIGATION. The option rows are NOT on the
 *     first view: the agent must first OPEN the correct section (act) to REVEAL
 *     the rows (read again), then act on the correct row. So the flow is
 *     read -> act -> read -> act, never one blind script.
 *  4. DECOYS + LATE CONTENT. Every section holds several similar-looking rows
 *     (only one is correct, distinguished by the nonce CODE), and the rows are
 *     injected via a short `setTimeout` AFTER the section opens, so the agent
 *     must PACE (wait) and RE-READ - exactly the messy-real-DOM behaviour the
 *     tier exists to catch.
 *
 * Every per-run value derives from the nonce via the pure helpers below, so
 * {@link computeExpectedTarget} can re-derive the correct (section, row) the
 * harness checks against by its OWN reads, WITHOUT re-running the agent.
 */

/** One option row inside a section: a nonce CODE + a decoy/correct flag. */
export interface MessyOption {
	/**
	 * The nonce-seeded option CODE shown as the row's visible text (e.g. `qr-7a3`).
	 * The correct row is identified ONLY by this code matching the instruction;
	 * there is no stable hook on the row.
	 */
	readonly code: string;
	/** A nonce-randomised, meaningless class name on the row (no semantic hook). */
	readonly className: string;
}

/** One section: a nonce-seeded label word + its option rows (revealed on open). */
export interface MessySection {
	/**
	 * The nonce-seeded SECTION label word shown on the toggle (e.g. `harbor`). The
	 * correct section is the one whose label is the instruction's section word.
	 */
	readonly label: string;
	/** A nonce-randomised, meaningless class name on the toggle (no semantic hook). */
	readonly toggleClass: string;
	/** A nonce-randomised, meaningless class name on the revealed panel. */
	readonly panelClass: string;
	/** The option rows revealed when this section is opened (decoys + maybe one correct). */
	readonly options: readonly MessyOption[];
}

/** The fully-resolved per-run fixture model (everything derives from the nonce). */
export interface MessyDomModel {
	/** The per-run nonce that seeds every value (so a cached script is useless). */
	readonly nonce: string;
	/** The sections shown on the first view, in nonce-seeded order. */
	readonly sections: readonly MessySection[];
	/** The index (into {@link sections}) of the section the agent must open. */
	readonly correctSectionIndex: number;
	/** The index (into the correct section's options) of the row the agent must act on. */
	readonly correctOptionIndex: number;
}

/** A seeded, deterministic PRNG (mulberry32) so a nonce reproduces the page. */
function seededRng(seedText: string): () => number {
	// Fold the nonce text into a 32-bit seed (same fold as the dynamic fixture).
	let h = 1779033703 ^ seedText.length;
	for (let i = 0; i < seedText.length; i++) {
		h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	let a = h >>> 0;
	return function next(): number {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A fixed pool of section label WORDS (the words are stable; which/order varies). */
const SECTION_WORDS: readonly string[] = [
	'harbor',
	'meadow',
	'cinder',
	'lantern',
	'thistle',
	'quartz',
	'willow',
	'beacon',
];

/** How many sections the first view shows. */
const SECTION_COUNT = 4;
/** How many option rows each section reveals (decoys + at most one correct). */
const OPTIONS_PER_SECTION = 4;

/** Base-36 token of a given length, seeded by the rng (meaningless class/code text). */
function token(rng: () => number, length: number): string {
	let s = '';
	while (s.length < length) {
		s += Math.floor(rng() * 36 ** 6)
			.toString(36)
			.padStart(6, '0');
	}
	return s.slice(0, length);
}

/**
 * Resolve the full per-run fixture model from a nonce: a nonce-seeded set of
 * sections (each with a nonce label word, nonce-random class names, and
 * nonce-coded option rows), plus the nonce-chosen correct (section, row). Pure:
 * the SAME nonce always yields the SAME model, so the harness can re-derive the
 * expected end state for the self-test.
 */
export function resolveMessyModel(nonce: string = mintNonce()): MessyDomModel {
	const rng = seededRng(nonce);

	// A nonce-seeded selection + order of section words (Fisher-Yates over a copy),
	// so WHICH words appear and in what order varies per run.
	const words = [...SECTION_WORDS];
	for (let i = words.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[words[i], words[j]] = [words[j], words[i]];
	}
	const chosenWords = words.slice(0, SECTION_COUNT);

	const sections: MessySection[] = chosenWords.map((label) => {
		const options: MessyOption[] = [];
		for (let o = 0; o < OPTIONS_PER_SECTION; o++) {
			options.push({
				// A two-part code (`<3 letters>-<3 base36>`) so decoy rows look alike
				// but the correct one is a distinct, run-revealed string.
				code: `${token(rng, 3)}-${token(rng, 3)}`,
				className: `c${token(rng, 5)}`,
			});
		}
		return {
			label,
			toggleClass: `t${token(rng, 5)}`,
			panelClass: `p${token(rng, 5)}`,
			options,
		};
	});

	// The nonce-chosen correct target: a section (NOT necessarily the first, so a
	// reveal step is required) and a row within it (NOT necessarily the first, so a
	// decoy-vs-correct read is required).
	const correctSectionIndex = Math.floor(rng() * sections.length);
	const correctOptionIndex = Math.floor(rng() * OPTIONS_PER_SECTION);

	return {nonce, sections, correctSectionIndex, correctOptionIndex};
}

/** The correct (section, row) the harness re-derives - host-deterministic. */
export interface ExpectedTarget {
	/** The nonce-seeded label WORD of the section the agent had to open. */
	readonly sectionLabel: string;
	/** The nonce-seeded CODE of the row the agent had to act on. */
	readonly optionCode: string;
}

/**
 * Re-derive the correct (section label, option code) from the model: the harness's
 * deterministic reference for the self-test + the on-page instruction. Pure
 * function of the model/nonce. The end-state assertion does NOT re-derive the
 * agent's clicks; it reads the on-page result marker and checks it carries THIS
 * code, so any path that actioned the correct row passes.
 */
export function computeExpectedTarget(model: MessyDomModel): ExpectedTarget {
	const section = model.sections[model.correctSectionIndex];
	const option = section.options[model.correctOptionIndex];
	return {sectionLabel: section.label, optionCode: option.code};
}

/** HTML-escape a value (the nonce codes/words are alphanumeric, but be safe). */
function esc(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Render the per-run messy-DOM fixture HTML for a resolved model. */
export function renderMessyHtml(model: MessyDomModel): string {
	const expected = computeExpectedTarget(model);

	// The sections render as toggles with NO id/role/testid and a nonce-random
	// class; their option rows are NOT in the initial markup - they are injected by
	// the page script (after a short setTimeout) when the section opens, so the
	// rows are LATE content the agent must wait for and re-read.
	const sectionMarkup = model.sections
		.map((section, sIdx) => {
			const optionData = section.options
				.map(
					(opt) =>
						`{"code":${JSON.stringify(opt.code)},"cls":${JSON.stringify(
							opt.className,
						)}}`,
				)
				.join(',');
			return `
			<div class="${esc(section.toggleClass)}" data-section-index="${sIdx}">
				<div class="${esc(section.toggleClass)}-h">${esc(section.label)}</div>
				<div class="${esc(section.panelClass)}" data-options='[${optionData}]'></div>
			</div>`;
		})
		.join('');

	// The INSTRUCTION line is the only place the correct (section word, option code)
	// is revealed, and it is shown on the page (so it is run-revealed, not in the
	// goal). The result marker (#explore-result) is a STABLE landmark the HARNESS
	// reads; it is empty until the correct row is actioned, then carries the
	// actioned code so the end state is deterministically checkable.
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Messy DOM explore fixture (nonce ${esc(model.nonce)})</title>
	</head>
	<body>
		<h1 id="heading">Directory</h1>
		<div id="app-ready" data-ready="true">directory loaded</div>

		<p id="explore-instruction" data-section="${esc(
			expected.sectionLabel,
		)}" data-code="${esc(expected.optionCode)}">
			Open the section labelled "<span class="instr-section">${esc(
				expected.sectionLabel,
			)}</span>" and select the entry whose code is
			"<span class="instr-code">${esc(expected.optionCode)}</span>".
		</p>

		<div id="sections">${sectionMarkup}
		</div>

		<!-- The harness's STABLE result landmark: empty until the correct row is
		     actioned, then it carries the actioned code (so the end state and which
		     code was chosen both persist on the final DOM for the harness). -->
		<div id="explore-result" data-selected-code="" hidden></div>

		<script>
			(function () {
				var EXPECTED_CODE = ${JSON.stringify(expected.optionCode)};
				var sectionsRoot = document.getElementById('sections');
				var toggles = sectionsRoot.children;
				for (var i = 0; i < toggles.length; i++) {
					(function (toggle) {
						var header = toggle.children[0];
						var panel = toggle.children[1];
						header.addEventListener('click', function () {
							// Re-opening is idempotent: only inject once.
							if (panel.getAttribute('data-open') === 'true') return;
							panel.setAttribute('data-open', 'true');
							var options = JSON.parse(panel.getAttribute('data-options') || '[]');
							// LATE content: inject the rows after a short delay so the agent
							// must pace (wait) and re-read after opening a section.
							setTimeout(function () {
								for (var k = 0; k < options.length; k++) {
									(function (opt) {
										var row = document.createElement('div');
										row.className = opt.cls;
										row.textContent = opt.code;
										row.addEventListener('click', function () {
											if (opt.code === EXPECTED_CODE) {
												var result = document.getElementById('explore-result');
												result.setAttribute('data-selected-code', opt.code);
												result.textContent = 'selected ' + opt.code;
												result.hidden = false;
											}
											// A wrong row click is a no-op on the result marker: the
											// harness reads the marker, so a decoy click never passes.
										});
										panel.appendChild(row);
									})(options[k]);
								}
							}, 350);
						});
					})(toggles[i]);
				}
			})();
		</script>
	</body>
</html>
`;
}

/** A running messy-DOM-fixture server bound to one per-run model. */
export interface MessyDomFixtureServer {
	/** The base URL, e.g. `http://127.0.0.1:52831`. */
	readonly url: string;
	/** The per-run model the served page renders (its nonce, sections, target). */
	readonly model: MessyDomModel;
	/** Stop the server and release the port. */
	close(): Promise<void>;
}

/**
 * Start a local HTTP server that serves ONE per-run messy-DOM fixture page (the
 * resolved `model`). Mirrors {@link startDynamicFixtureServer}: it lives in
 * `src/` so BOTH the deterministic self-test AND the live `run-eval` runner can
 * serve the same page. Binds `127.0.0.1` on an OS-assigned port; every path
 * serves the one fixture page (so a trailing-slash entry URL just works).
 */
export async function startMessyDomFixtureServer(
	model: MessyDomModel = resolveMessyModel(),
): Promise<MessyDomFixtureServer> {
	const html = renderMessyHtml(model);
	const server: Server = createServer((_req, res) => {
		res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
		res.end(html);
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

	const address = server.address();
	if (address === null || typeof address === 'string') {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		throw new Error('messy-dom fixture server failed to bind to a TCP port');
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		model,
		close() {
			return new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		},
	};
}
