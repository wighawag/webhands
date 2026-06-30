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

/**
 * A per-adapter PROTOCOL PREAMBLE: the toolkit-specific wrapper the harness
 * composes AROUND the (toolkit-agnostic) goal-prompt. It is NOT goal priming
 * (see
 * `work/notes/observations/eval-end-state-assertion-needs-the-agent-to-leave-the-session-open.md`):
 * it tells the agent HOW the test is administered (which toolkit it has, and the
 * rule of the test that it must leave the browser open for the harness to
 * verify), NOT how to SOLVE the goal. The no-priming rule still binds the GOAL
 * itself; the preamble is a separate, legitimate layer.
 *
 * Both the webhands config and the Playwright-only config share the SAME goal +
 * the SAME harness end-state assertion; ONLY this preamble differs (different
 * toolkit, different leave-open wording). That difference is exactly what makes
 * the two configs a fair "does webhands deliver?" comparison: same goal, two
 * toolkits.
 */
export interface ProtocolPreamble {
	/** A stable name for this preamble's toolkit (`webhands`, `playwright`). */
	readonly toolkit: string;
	/**
	 * The toolkit reference: how the agent reaches/drives the browser. For the
	 * webhands config this is the verb-surface reference; for the Playwright-only
	 * config it teaches RAW Playwright (drive a browser via Playwright APIs), with
	 * NO mention of webhands (routing it through webhands would defeat the
	 * baseline).
	 */
	readonly toolkitReference: string;
	/**
	 * The harness-PROTOCOL rule, toolkit-worded: when done, STOP and leave the
	 * browser open on the final page for the harness to verify; do not
	 * close/reset it. Toolkit-specific wording (webhands: do not run
	 * `webhands stop`; Playwright: do not `browser.close()`), but the RULE is the
	 * same for every adapter, because the harness asserts the end state AFTER the
	 * agent finishes (the resolving insight in the observation note).
	 */
	readonly leaveOpenRule: string;
}

/**
 * The WEBHANDS protocol preamble (the default, the COLD config): the agent
 * drives the browser through the published `webhands` verb surface, and must not
 * tear the session down (the harness reads that same session for its verdict).
 * COLD because it only POINTS the agent at the discovery command (`--llms-full`)
 * rather than handing it the surface up front, so the agent pays the runtime
 * "discovery tax" a real deployment with the skill synced would not
 * (`work/notes/findings/scoreboard-transcript-analysis-where-the-token-gap-comes-from.md`).
 */
/** The webhands leave-open rule, shared by the cold and skilled preambles. */
const WEBHANDS_LEAVE_OPEN_RULE =
	'When you have finished, STOP and leave the browser open on the final ' +
	'page so the result can be verified. Do NOT close, reset, or run ' +
	'`webhands stop`.';

export const WEBHANDS_PREAMBLE: ProtocolPreamble = {
	toolkit: 'webhands',
	toolkitReference: VERB_SURFACE_REFERENCE,
	leaveOpenRule: WEBHANDS_LEAVE_OPEN_RULE,
};

/**
 * The SKILLED webhands toolkit reference: the curated, SITE-AGNOSTIC workflow
 * knowledge from `skills/use-webhands/SKILL.md`, inlined so the agent STARTS
 * already knowing the webhands surface (the way a real agent with the
 * `use-webhands` skill synced would), instead of discovering it COLD at runtime.
 *
 * WHY a curated transcription and not the raw SKILL.md file: the shipped skill
 * carries worked EXAMPLES that name a specific site URL
 * (`kayak.co.uk/flights/...`) and selector-shaped fragments (`frameLocator(`,
 * `querySelector`). Those are legitimate teaching examples in the skill, but if
 * fed to the agent-under-test they would trip the no-priming SELECTOR_SHAPES /
 * extra-URL rules: a site URL + selectors in the agent's input is exactly the
 * shape the no-priming guard forbids. So this reference distils the skill's
 * PROTOCOL layer (the serve lifecycle, the verb pipe, reading cheaply, pacing
 * XHR, the verb quick-reference) and DROPS the site-specific worked examples.
 * It is generic tool-usage knowledge (how to use webhands), site-agnostic by
 * construction, so it is PROTOCOL not goal priming. The {@link assertSkilledReferenceUnprimed}
 * guard + the self-test assert it carries no selector-shaped fragment and no
 * site URL, so this property cannot silently rot.
 */
export const WEBHANDS_SKILL_REFERENCE =
	'Your only tool is the `webhands` CLI (invoke every command as ' +
	'`npx webhands <verb>`): it owns ONE long-lived headless browser (a `serve` ' +
	'process bound to a profile) and every other verb is a thin client that ' +
	'drives that SAME live page and exits, so you compose verbs across separate ' +
	'invocations. This reference is COMPLETE: drive directly from it, you do NOT ' +
	'need to run `npx webhands <verb> --help` or `npx webhands --llms-full` at ' +
	'runtime. The core flow:\n' +
	'1. Start and HOLD the session: `serve` blocks its shell, so from automation ' +
	'start it backgrounded and poll its log for the endpoint, e.g. ' +
	'`nohup npx webhands serve > /tmp/webhands-serve.log 2>&1 &` then ' +
	'`sleep 12 && cat /tmp/webhands-serve.log` (expect ok:true, an endpoint, a ' +
	'pid). The tool NEVER silently spawns a browser; if a verb prints "run ' +
	'`serve` first", start serve and retry.\n' +
	'2. Drive it as separate invocations against the same page: `goto <url>`, ' +
	'`wait --ms <n>` (or `--navigation`/`--locator`) to pace, then `snapshot`, ' +
	'then `click`/`type`/`eval` as needed.\n' +
	'3. Read cheaply: `snapshot` returns a token-cheap accessibility-tree + text ' +
	'view (your default for "what is on the page"); use `--token-limit <n>` to ' +
	'cap output and `--full` only when you truly need raw DOM. Pipe a snapshot ' +
	'through grep to pull just the lines you care about. For structured ' +
	'extraction, `eval` a small JS expression and return a plain array/object ' +
	'(`--format json`); keep matching LOOSE and text-based (site DOM/class names ' +
	'change), and expect to iterate once or twice.\n' +
	'4. Pacing: results often arrive after navigation via background XHR. If a ' +
	'snapshot is empty or sparse the page is still loading; `wait --ms 6000-9000` ' +
	'(or `wait --navigation`) before snapshotting. This is normal, not a failure.\n' +
	'5. Batch a known sub-flow with one `script`: composing one verb per ' +
	'invocation is the safe default, but each invocation is a fresh model turn. ' +
	'When you ALREADY know a multi-step sub-flow (fill a form, submit, read the ' +
	'result), `script` runs it in ONE call against the same served page, the way ' +
	'a Playwright user writes a script by hand. It takes JS evaluating to an ' +
	'async function of the FULL live Playwright page \u2014 ' +
	'`async (page) => { ...use the standard Playwright page API (fill, click, ' +
	'select, the role/test-id/text locator helpers, auto-waiting) to do the whole ' +
	'flow...; return a serializable value }` \u2014 supplied as a FILE PATH: write ' +
	'that function to a file, then `npx webhands script flow.js`, and ' +
	"returns the function's serializable result. It gets real locators + " +
	'actions + auto-waiting; a thrown script returns a clean error.\n' +
	'LOCATOR GRAMMAR (the discrete act/read verbs): a locator argument is a raw ' +
	'Playwright locator EXPRESSION as a string and MUST be prefixed with `page.` ' +
	'(a `page.`-prefixed element/role/text/test-id query). A bare locator throws ' +
	'("not defined", or a bare id parses as a JS private field), so always write ' +
	'the `page.`-prefixed form. Frame scope rides INSIDE the locator string (a ' +
	'`page.`-prefixed frame hop), except `eval` which takes a separate `--frame ' +
	'<css>` flag.\n' +
	'FULL VERB REFERENCE (every verb also takes `--profile <name>` or `--endpoint ' +
	'<url>`; add `--format json` for machine output): `serve` start & hold the ' +
	'one browser (headless default, `--headed` to show); `setup-profile` one-time ' +
	'HEADED login/challenge-clear that persists the profile; `attach --endpoint ' +
	'<url>` reuse a Chromium you already started with remote debugging; `goto ' +
	'<url>` navigate; `wait` pace/settle (`--ms <n>` | `--locator <loc>` | ' +
	'`--navigation`, exactly one); `snapshot` token-cheap a11y+text view ' +
	'(`--full`, `--token-limit <n>`); `eval <expr>` run a page-world JS ' +
	'expression (`--frame <css>` for a same-origin child frame); `script ' +
	'<path>` run a DRIVER-CONTEXT function of the full Playwright page (read from a ' +
	'JS file PATH) to batch a whole sub-flow in ONE call; `click <loc>` / `type <loc> ' +
	'<text>` act via a `page.`-prefixed locator (`--by-ref` to use a durable ref ' +
	'from `query --with-refs`); `press <key>` press a key/chord (`--locator ' +
	'<loc>` or the focused element); `hover <loc>` reveal on-hover controls; ' +
	'`select <loc>` choose a native dropdown option (`--value <v>` | `--label ' +
	'<l>`); `scroll` (`--to <loc>` | `--by <dx,dy>`); `drag <source> <target>`; ' +
	'`mouse --x <n> --y <n>` viewport-pixel mouse input (`--action`, `--button`); ' +
	'`query <loc>` read structured data per match (`--attr`/`--prop`/`--pw` are ' +
	'REPEATABLE, `--with-refs` mints durable refs); `count`/`exists`/`is-visible` ' +
	'/`get-attribute <loc> --name <attr>` tiny reads; `screenshot` capture a PNG ' +
	'to a FILE path (`--scope viewport|full|element`, `--locator`, `--out`); ' +
	'`cookies export <file>`/`cookies import <file>` move the session; `stop` ' +
	'tear the session down. ' +
	'Use only those verbs to drive the browser; do not assume any site-specific ' +
	'selectors, steps, or URLs beyond the one named in the goal.';

/**
 * The SCRIPT-FORWARD skilled reference: the same full-surface skill knowledge,
 * but it LEADS with the `script` batch path so the agent is nudged to compose a
 * whole sub-flow in one driver-context call rather than verb-at-a-time. Used by
 * the `webhands-script-forward` agent kind to measure whether PUTTING SCRIPT
 * FORWARD (vs merely listing it) changes the agent's behaviour + token cost.
 */
export const WEBHANDS_SCRIPT_FORWARD_REFERENCE =
	'Your only tool is the `webhands` CLI (invoke every command as ' +
	'`npx webhands <verb>`): it owns ONE long-lived headless browser (a `serve` ' +
	'process bound to a profile) and every other verb is a thin client that ' +
	'drives that SAME live page and exits. This reference is COMPLETE: drive ' +
	'directly from it, you do NOT need `npx webhands <verb> --help` or ' +
	'`npx webhands --llms-full` at runtime.\n' +
	'PREFERRED PATH \u2014 batch the flow with one `script`: webhands hands you the ' +
	'FULL live Playwright `page`, so once you know the steps, do the whole ' +
	'sub-flow in ONE call instead of one verb per turn. `script` takes JS ' +
	'evaluating to an async function of the page and returns its serializable ' +
	'result \u2014 `async (page) => { ...navigate, then use the standard ' +
	'Playwright page API (fill, click, select, the role/test-id/text locator ' +
	'helpers, auto-waiting) to run the whole flow...; return a serializable ' +
	'value }` \u2014 supplied as a FILE PATH: write that function to a file, then ' +
	'`npx webhands script flow.js`. It gets real locators + actions + auto-waiting; ' +
	'a thrown script returns a clean error. Prefer this for any multi-step flow ' +
	'you can plan.\n' +
	'Start and HOLD the session first (`serve` blocks, so background it: ' +
	'`nohup npx webhands serve > /tmp/webhands-serve.log 2>&1 &` then ' +
	'`sleep 12 && cat /tmp/webhands-serve.log`, expect ok:true + an endpoint). ' +
	'When you need to LOOK before acting, read cheaply with `snapshot` ' +
	'(token-cheap a11y+text) or `eval`/`script` a small read; pace background ' +
	'XHR with `wait --ms 6000-9000`.\n' +
	'LOCATOR GRAMMAR (for the discrete act/read verbs below): a locator argument ' +
	'is a raw Playwright locator EXPRESSION as a string and MUST be prefixed with ' +
	'`page.`; a bare locator throws, so always write the `page.`-prefixed form. ' +
	'Frame scope rides INSIDE the locator string, except `eval` which takes a ' +
	'separate `--frame <css>` flag.\n' +
	'FULL VERB REFERENCE (also available for single steps + exploration; every ' +
	'verb takes `--profile <name>`/`--endpoint <url>`, add `--format json` for ' +
	'machine output): `serve` start & hold the browser (`--headed` to show); ' +
	'`setup-profile` one-time HEADED login that persists the profile; `attach ' +
	'--endpoint <url>` reuse a Chromium started with remote debugging; `goto ' +
	'<url>` navigate; `wait` pace/settle (`--ms`|`--locator`|`--navigation`); ' +
	'`snapshot` token-cheap a11y+text view (`--full`, `--token-limit`); `eval ' +
	'<expr>` page-world JS (`--frame <css>`); `script <path>` driver-context batch ' +
	'from a JS file PATH; `click <loc>`/`type <loc> <text>` act via a `page.`-' +
	'prefixed locator (`--by-ref`); `press <key>` (`--locator`); `hover <loc>`; ' +
	'`select <loc>` (`--value`|`--label`); `scroll` (`--to`|`--by <dx,dy>`); ' +
	'`drag <source> <target>`; `mouse --x <n> --y <n>` viewport-pixel input ' +
	'(`--action`,`--button`); `query <loc>` structured per-match read (repeatable ' +
	'`--attr`/`--prop`/`--pw`, `--with-refs`); `count`/`exists`/`is-visible`/' +
	'`get-attribute <loc> --name <attr>`; `screenshot` PNG to a FILE path ' +
	'(`--scope`,`--locator`,`--out`); `cookies export`/`import <file>`; `stop` ' +
	'tear the session down. ' +
	'Use only those verbs to drive the browser; do not assume any site-specific ' +
	'selectors, steps, or URLs beyond the one named in the goal.';

/**
 * The SCRIPT-ONLY skilled reference: the truest head-to-head with the
 * raw-Playwright baseline. Where {@link WEBHANDS_SCRIPT_FORWARD_REFERENCE} merely
 * LEADS with `script` (the discrete act/read verbs still listed as a fallback),
 * this reference makes `script` the EXCLUSIVE driving path: the agent drives the
 * WHOLE flow as a SEQUENCE of file-only `script` runs, reading the live page
 * INSIDE each script (the Playwright `page` API) and returning a serializable
 * value, then writing the NEXT script from what it read. There is no
 * verb-at-a-time `click`/`type`/`snapshot` working path: a read-decide-loop is a
 * sequence of `script` files, each one model turn.
 *
 * WHY: `script` hands the agent the FULL live Playwright `page`, so a script-only
 * webhands agent and a raw-Playwright agent write the SAME automation against the
 * SAME shared browser; the ONLY difference is webhands SERVES the browser (and
 * need not re-launch its own). This isolates the SURFACE from the
 * chattiness/discovery confounds the other kinds carry, so the script-only leg is
 * the cleanest "is the webhands surface itself competitive with raw Playwright?"
 * reading. Used by the `webhands-script-only` agent kind.
 *
 * It stays NO-PRIMING-CLEAN exactly like the script-forward reference: the same
 * GENERIC `async (page) => {...}` example shape (no selector-shaped fragment) and
 * NO site URL, so {@link assertSkilledReferenceUnprimed} passes.
 */
export const WEBHANDS_SCRIPT_ONLY_REFERENCE =
	'Your only tool is the `webhands` CLI, and you drive the browser EXCLUSIVELY ' +
	'through ONE verb: `script`. webhands owns ONE long-lived headless browser (a ' +
	'`serve` process bound to a profile); `script` runs a function you write ' +
	'against that SAME live page, the way a raw-Playwright user writes a script by ' +
	'hand. Do NOT use the discrete `click`/`type`/`snapshot`/`goto` verbs at all; ' +
	'do everything inside `script` functions. This reference is COMPLETE: drive ' +
	'directly from it, you do NOT need `npx webhands <verb> --help` or ' +
	'`npx webhands --llms-full` at runtime.\n' +
	'THE ONE DRIVING VERB \u2014 `script`: it takes JS evaluating to an async ' +
	'function of the FULL live Playwright `page` and returns its serializable ' +
	'result \u2014 `async (page) => { ...navigate, then use the standard ' +
	'Playwright page API (fill, click, select, the role/test-id/text locator ' +
	'helpers, auto-waiting) to act, AND read whatever you need off the live page ' +
	'(textContent, counts, values); return a serializable value (what you read, or ' +
	'a done flag) }` \u2014 supplied as a FILE PATH: write that function to a file, ' +
	'then `npx webhands script ./flow.js`, and read the serializable result it ' +
	'prints. It gets real locators + actions + auto-waiting; a thrown script ' +
	'returns a clean error.\n' +
	'READ-DECIDE-LOOP AS A SEQUENCE OF SCRIPTS: when the next action depends on ' +
	'live page state you cannot know up front, do NOT try to one-shot it. Write a ' +
	'script that ACTS then READS and RETURNS what it saw; read that returned value; ' +
	'DECIDE; then write the NEXT `./flow.js` based on it and run it again. Each ' +
	'`script` run is ONE model turn, so a look\u2192decide\u2192act loop is just a ' +
	'short sequence of these file-only runs. Keep your reads inside the script ' +
	'(return a small serializable value), not as separate verbs.\n' +
	'Start and HOLD the session first (`serve` blocks, so background it: ' +
	'`nohup npx webhands serve > /tmp/webhands-serve.log 2>&1 &` then ' +
	'`sleep 12 && cat /tmp/webhands-serve.log`, expect ok:true + an endpoint). ' +
	'Pace background XHR from INSIDE the script (await the page settling / a ' +
	'locator) rather than with a separate wait verb. Matching should stay LOOSE ' +
	'and text-based (site DOM/class names change), and expect to iterate once or ' +
	'twice.\n' +
	'Use only `script` to drive the browser; do not assume any site-specific ' +
	'selectors, steps, or URLs beyond the one named in the goal.';

/**
 * The WEBHANDS-SKILLED protocol preamble: the SAME webhands verb surface and the
 * SAME leave-open rule as {@link WEBHANDS_PREAMBLE}, but its toolkit reference is
 * the inlined {@link WEBHANDS_SKILL_REFERENCE} so the agent starts KNOWING the
 * surface instead of discovering it cold. ONLY the up-front knowledge differs
 * from the cold config: the verb surface the agent drives, the goal, and the
 * harness's end-state assertion are all identical, which is what makes
 * cold-vs-skilled a clean A/B of the skill's value (and skilled-vs-Playwright the
 * fair-shake number a real deployment would see).
 */
export const WEBHANDS_SKILLED_PREAMBLE: ProtocolPreamble = {
	toolkit: 'webhands-skilled',
	toolkitReference: WEBHANDS_SKILL_REFERENCE,
	leaveOpenRule: WEBHANDS_LEAVE_OPEN_RULE,
};

/**
 * The SCRIPT-FORWARD skilled preamble: full skill knowledge that LEADS with the
 * `script` batch path, to measure whether putting `script` forward (vs merely
 * listing it among the verbs) shifts the agent toward one-call sub-flows.
 */
export const WEBHANDS_SCRIPT_FORWARD_PREAMBLE: ProtocolPreamble = {
	toolkit: 'webhands-script-forward',
	toolkitReference: WEBHANDS_SCRIPT_FORWARD_REFERENCE,
	leaveOpenRule: WEBHANDS_LEAVE_OPEN_RULE,
};

/**
 * The SCRIPT-ONLY skilled preamble: full skill knowledge, but the agent drives
 * the browser EXCLUSIVELY through file-only `script` runs (no discrete
 * `click`/`type`/`snapshot` working path), so a script-only webhands agent and a
 * raw-Playwright agent write the SAME automation against the SAME shared browser.
 * This is the truest head-to-head with the Playwright baseline: it isolates the
 * SURFACE from the chattiness/discovery confounds, so it is the cleanest "is the
 * webhands surface itself competitive?" reading.
 */
export const WEBHANDS_SCRIPT_ONLY_PREAMBLE: ProtocolPreamble = {
	toolkit: 'webhands-script-only',
	toolkitReference: WEBHANDS_SCRIPT_ONLY_REFERENCE,
	leaveOpenRule: WEBHANDS_LEAVE_OPEN_RULE,
};

/**
 * The env var the harness passes the SHARED driving surface's CDP endpoint in,
 * and that the Playwright-only preamble points the agent at. Administered as
 * PROTOCOL (env + preamble), the SAME channel the webhands command reaches the
 * agent through (`WEBHANDS_HOME`), NOT goal priming: it tells the agent HOW the
 * test is administered (which browser to drive), never how to SOLVE the goal, so
 * the no-priming rule still binds the goal.
 */
export const CDP_ENDPOINT_ENV = 'WEBHANDS_CDP_ENDPOINT';

/**
 * The PLAYWRIGHT-ONLY protocol preamble (the baseline): the agent drives a
 * browser using RAW Playwright APIs ONLY, with NO webhands. It CONNECTS its
 * Playwright to the SHARED browser the harness already serves
 * (`chromium.connectOverCDP(<endpoint>)`), NOT a browser of its own, and drives
 * the EXISTING page there. That shared surface is what makes the baseline's
 * verdict trustworthy: the harness reads the SAME page the agent drove,
 * regardless of toolkit (finding
 * `baseline-comparison-needs-a-shared-driving-surface-not-two-browsers`).
 * Routing this agent through webhands would defeat the baseline, so the preamble
 * never points it at a webhands verb (it may only name webhands to FORBID it).
 *
 * The CDP endpoint is supplied as PROTOCOL via the {@link CDP_ENDPOINT_ENV}
 * environment variable (the same env channel the webhands command's
 * `WEBHANDS_HOME` rides), so the preamble's wording is STATIC (it names the env
 * var) while the live endpoint value reaches the agent at launch. This keeps the
 * endpoint protocol, not goal priming.
 */
export const PLAYWRIGHT_PREAMBLE: ProtocolPreamble = {
	toolkit: 'playwright',
	toolkitReference:
		'Your only tool is raw Playwright (the `playwright` library). A browser is ' +
		`ALREADY RUNNING for you; its CDP endpoint is in the \`${CDP_ENDPOINT_ENV}\` ` +
		'environment variable. CONNECT to it with ' +
		`\`chromium.connectOverCDP(process.env.${CDP_ENDPOINT_ENV})\`, take the ` +
		'existing context and its existing page (`browser.contexts()[0]`, ' +
		'`context.pages()[0]`), and drive THAT page (`goto` the entry URL, ' +
		'locate/click/type, etc.). Do NOT launch your own browser ' +
		'(`chromium.launch()` / `launchPersistentContext`); you must drive the ' +
		'shared one so the result can be verified. ' +
		'EVERY script you run must let its `node` process EXIT: a live ' +
		'`connectOverCDP` connection keeps the Node event loop alive, so at the ' +
		'END of each script call `await browser.disconnect()` (this ends YOUR ' +
		'client connection so the process exits) and do NOT call ' +
		'`browser.close()` (which would tear down the SHARED browser the harness ' +
		'must still read). If a script does not `disconnect()`, `node` will HANG ' +
		'to the time limit and the run will fail. ' +
		"When navigating, prefer `goto(url, {waitUntil: 'domcontentloaded'})` " +
		'plus an explicit locator/`waitForSelector` wait for the element you need; ' +
		"do NOT use `waitUntil: 'networkidle'` on app pages, which may never " +
		'settle and will also hang the script. ' +
		'Do NOT use webhands or any other ' +
		'browser-automation toolkit. Do not assume any site-specific selectors, ' +
		'steps, or URLs beyond the one named in the goal.',
	leaveOpenRule:
		'When you have finished, STOP and leave the SHARED browser open on the ' +
		'final page so the result can be verified. Two DIFFERENT things. (1) Do ' +
		'NOT CLOSE the shared browser: never call `browser.close()`, ' +
		'`context.close()`, or `page.close()`, and do not reset the page; closing ' +
		'it would destroy the session the harness verifies. (2) DO DISCONNECT ' +
		'your own client at the end of every script: `await browser.disconnect()` ' +
		'ends YOUR CDP connection (so your `node` process exits) WITHOUT closing ' +
		'the shared browser, which keeps running for the harness. Disconnecting is ' +
		'REQUIRED so each script exits; closing is forbidden.',
};

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
 * Assert a SKILLED preamble's inlined toolkit reference does not smuggle goal
 * priming: it must carry NO selector-shaped fragment (the same SELECTOR_SHAPES
 * the GOAL is held to) and NO http(s) URL at all (the skilled reference is
 * site-agnostic; it should never name ANY site, even one). This is the
 * preamble-layer analogue of {@link assertNoPriming}: the no-priming guard binds
 * the GOAL, but an inlined skill is a NEW way priming could sneak in through the
 * PROTOCOL layer, so the skilled reference is held to the same spirit. The skill
 * teaches HOW to use webhands (generic, site-agnostic), never how to solve a
 * given site; if a future edit pasted a worked example with a real URL/selector,
 * this throws {@link PrimingViolationError} so it cannot silently rot into goal
 * priming.
 */
export function assertSkilledReferenceUnprimed(reference: string): void {
	for (const shape of SELECTOR_SHAPES) {
		if (shape.test(reference)) {
			throw new PrimingViolationError(
				`the skilled toolkit reference carries a selector-shaped fragment ` +
					`(matched ${shape}); inlined skill text is PROTOCOL (how to use ` +
					`webhands), not goal priming, so it must name NO site-specific ` +
					`selectors. Drop the worked example that carries it.`,
			);
		}
	}
	const urls = extractUrls(reference);
	if (urls.length > 0) {
		throw new PrimingViolationError(
			`the skilled toolkit reference names a URL (${urls[0]}); the inlined ` +
				`skill is SITE-AGNOSTIC protocol and must name no site at all. Drop ` +
				`the worked example that carries it.`,
		);
	}
}

/**
 * Assemble the EXACT text handed to the agent-under-test on stdin: the
 * (toolkit-agnostic) goal-prompt + the per-adapter PROTOCOL preamble, and
 * nothing else. Runs {@link assertNoPriming} on the GOAL first, so building the
 * input is the no-priming enforcement point; the preamble is a separate,
 * legitimate layer (toolkit + leave-open rule) NOT subject to the no-priming
 * guard, because it administers the test rather than solving it.
 *
 * The `preamble` defaults to {@link WEBHANDS_PREAMBLE} so an existing caller
 * gets the webhands config unchanged; the Playwright-only config passes
 * {@link PLAYWRIGHT_PREAMBLE}. The GOAL text is IDENTICAL across preambles, which
 * is what keeps the two configs an apples-to-apples comparison.
 *
 * This is the ONLY sanctioned way to produce agent input; the adapter consumes
 * its return verbatim.
 */
export function buildAgentInput(
	entry: EvalEntry,
	preamble: ProtocolPreamble = WEBHANDS_PREAMBLE,
): string {
	assertNoPriming(entry);
	// A SKILLED preamble inlines skill text into the PROTOCOL layer, a new path
	// priming could sneak in through; hold its reference to the no-priming spirit
	// too, so a primed inlined skill never reaches a real agent (load-bearing like
	// assertNoPriming on the goal).
	if (
		preamble.toolkit === WEBHANDS_SKILLED_PREAMBLE.toolkit ||
		preamble.toolkit === WEBHANDS_SCRIPT_FORWARD_PREAMBLE.toolkit ||
		preamble.toolkit === WEBHANDS_SCRIPT_ONLY_PREAMBLE.toolkit
	) {
		assertSkilledReferenceUnprimed(preamble.toolkitReference);
	}
	return (
		`${entry.goalPrompt.trim()}\n\n` +
		`${preamble.toolkitReference}\n\n` +
		`${preamble.leaveOpenRule}\n`
	);
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
