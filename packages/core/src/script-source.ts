/**
 * Compiling the `script` verb's SOURCE into the function it must evaluate to
 * (ADR-0012; the contract is unchanged, only the COMPILE is tolerant).
 *
 * ADR-0012 fixes the contract: a `script` file is JS that EVALUATES TO A
 * FUNCTION of the live page. What this module adds is only the COMPILE step:
 * turning the file's text into that function value, tolerating the two shapes a
 * human naturally writes, and failing with a message that states the constraint
 * when it genuinely cannot.
 *
 * Why this exists as its own module: the original compile was one inline
 * `new Function('page', 'p', 'return (' + source + ');')` in the verb body,
 * which textually WRAPS the source in an expression position. That made two
 * perfectly natural files hard syntax errors whose messages named the token
 * rather than the cause:
 *
 * - a trailing semicolon (`async (page) => {...};`) became `return (fn;);`,
 *   reported as "Unexpected token ';'";
 * - a top-level `const CONFIG = {...}` before the function became
 *   `return (const CONFIG ...)`, reported as "Unexpected token 'const'".
 *
 * Neither message mentions the expression constraint, so the author cannot tell
 * what to change. We keep the SAME contract (the file's value is the function)
 * and make the compile accept the module-style spelling of it.
 *
 * TRUST: compiling + running caller JS in-process is the surface ADR-0012
 * already defines for `script` (the same page-script trust surface as `eval`,
 * loopback-only). This module does not widen it: `eval` here evaluates the very
 * source the caller handed us, nothing else, and no new capability is exposed.
 *
 * SEAM: deliberately free of Playwright/CDP types (ADR-0003). The page bindings
 * arrive as `unknown` and are passed through untouched, so this compile step is
 * pure and unit-testable with no browser at all.
 */

/**
 * The page values bound into the compiled source's scope, so a script body can
 * name `page` (the documented parameter name) or the shorthand `p` directly, as
 * the locator-expression compiler does. Typed `unknown` to keep Playwright types
 * out of this module (ADR-0003); the caller passes its live page for both.
 */
export interface ScriptSourceBindings {
	readonly page: unknown;
	readonly p: unknown;
}

/**
 * The internal name the source text is bound to inside the compiled wrapper.
 * Deliberately unlikely to collide with anything a caller writes, because the
 * wrapper's direct `eval` puts the caller's own declarations in the SAME scope.
 */
const SOURCE_BINDING = '__webhandsScriptSource';

/**
 * Compile a `script` source to the value it evaluates to, which the caller then
 * checks is a function (see {@link InvalidScriptSourceError} for the failure
 * path).
 *
 * Two strategies, tried in order, so today's files keep their EXACT current
 * semantics and only the previously-failing shapes take the new path:
 *
 * 1. **Expression form** (unchanged, the historical compile): the whole source
 *    in an expression position, `return (<source>)`. This is what a bare
 *    `async (page) => {...}` has always used.
 * 2. **Program form** (new, used only when (1) is a SyntaxError): evaluate the
 *    source as a PROGRAM and take its completion value, which is the value of
 *    its last expression statement. That is exactly the semantics a human
 *    expects from a file that declares some top-level consts and then ends with
 *    the function, and it also makes a trailing semicolon a non-event (an empty
 *    statement does not change a program's completion value).
 *
 * A single leading `export default` is stripped first, because writing it is the
 * other natural reflex for "this file's value is this function" and ESM syntax
 * is not available inside a function body.
 *
 * What still CANNOT work, by construction: real ESM `import` (the source is not
 * a module) and `module.exports = ...` (there is no CJS module object). Both
 * surface through {@link InvalidScriptSourceError}, whose message names the
 * constraint and shows a correct minimal example instead of only echoing the
 * token the parser choked on.
 *
 * @throws InvalidScriptSourceError if neither form parses.
 */
export function compileScriptSource(
	source: string,
	bindings: ScriptSourceBindings,
): unknown {
	const normalized = stripExportDefault(source);

	// COMPILE and RUN are separated on purpose, and this is the subtle part.
	//
	// `new Function(...)` throws a SyntaxError only for a PARSE failure, whereas
	// INVOKING the result can throw a SyntaxError of the caller's own making:
	// `JSON.parse('{')`, `new RegExp('[')`, a nested `eval`. An earlier version
	// wrapped construction and invocation in ONE try and branched on `instanceof
	// SyntaxError`, which conflated the two with two bad consequences: a script whose
	// `JSON.parse` failed was re-run from the top (so its side effects, e.g. a
	// half-driven booking flow, happened TWICE), and the author was then told their
	// file had the wrong shape instead of being shown their own parse error.
	//
	// So: decide the SHAPE by compiling only, pick the form, and invoke exactly once.
	const expressionForm = tryCompile(`return (${normalized});`);
	if (expressionForm !== undefined) {
		// (1) The historical expression form. Tried FIRST so every script that works
		// today runs through the identical path it always did.
		return invoke(expressionForm, normalized, bindings);
	}

	// (2) The program form: the file's completion value, which is what makes
	// top-level statements and a trailing semicolon work. The wrapper itself always
	// parses (the caller's text rides in as DATA for a direct `eval`), so we
	// parse-check the source SEPARATELY to tell "this file cannot be a function of
	// the page" from "this file threw while running".
	if (tryCompile(normalized) === undefined) {
		// Neither form parses: a genuine shape problem, reported with the constraint.
		// The parse error comes from compiling the source as a program, which is the
		// more useful of the two messages (the expression form's error is an artefact
		// of our own wrapping).
		throw new InvalidScriptSourceError(parseErrorOf(normalized));
	}
	const programForm = tryCompile(`return eval(${SOURCE_BINDING});`);
	if (programForm === undefined) {
		// Unreachable in practice (the wrapper has no caller text in it), but failing
		// loudly beats returning undefined and reporting "not a function" later.
		throw new InvalidScriptSourceError(
			new SyntaxError('could not build the program-form wrapper'),
		);
	}
	// Invoked OUTSIDE any SyntaxError branch: whatever this throws is the caller's
	// own runtime error and propagates untouched, exactly once.
	return invoke(programForm, normalized, bindings);
}

/**
 * Invoke a compiled wrapper, translating ONLY the CommonJS tell into the
 * explaining error.
 *
 * Why this exists: `module.exports = async (page) => {...}` PARSES perfectly well
 * (it is just an assignment expression), so it reaches the invocation and dies with
 * a bare `ReferenceError: module is not defined`. That is precisely the
 * token-echoing failure this module replaced, and worse, {@link
 * InvalidScriptSourceError} explicitly advertises `module.exports` as a shape it
 * knows about, so arriving at a raw ReferenceError made the message a liar.
 *
 * The translation is deliberately narrow: a `ReferenceError` naming one of the CJS
 * globals, nothing else. Every other runtime error from the caller's script
 * propagates untouched, because it is theirs and remapping it would hide it.
 */
function invoke(
	wrapper: CompiledWrapper,
	source: string,
	bindings: ScriptSourceBindings,
): unknown {
	try {
		return wrapper(bindings.page, bindings.p, source);
	} catch (cause) {
		if (isCommonJsReferenceError(cause)) {
			throw new InvalidScriptSourceError(cause);
		}
		throw cause;
	}
}

/** True iff `cause` is a "module/exports/require is not defined" ReferenceError. */
function isCommonJsReferenceError(cause: unknown): boolean {
	return (
		cause instanceof ReferenceError &&
		/\b(module|exports|require)\b is not defined/.test(cause.message)
	);
}

/** The compiled wrapper for one strategy, or `undefined` if it does not PARSE. */
function tryCompile(body: string): CompiledWrapper | undefined {
	try {
		// eslint-disable-next-line no-new-func
		return new Function('page', 'p', SOURCE_BINDING, body) as CompiledWrapper;
	} catch (cause) {
		if (cause instanceof SyntaxError) {
			return undefined;
		}
		throw cause;
	}
}

/** The SyntaxError from compiling `source` as a program (for the error message). */
function parseErrorOf(source: string): unknown {
	try {
		// eslint-disable-next-line no-new-func
		new Function('page', 'p', SOURCE_BINDING, source);
		return new SyntaxError('the source does not evaluate to a function');
	} catch (cause) {
		return cause;
	}
}

/** The shape `new Function('page', 'p', <binding>, body)` produces. */
type CompiledWrapper = (page: unknown, p: unknown, src: string) => unknown;

// (`page`/`p` are bound as wrapper PARAMETERS, the same shape the locator-expression
// compiler uses, and the source text rides in as SOURCE_BINDING so the program-form
// body can reach it through a DIRECT `eval` -- which is what gives the evaluated
// program access to `page`/`p` and yields its completion value.)

/**
 * Strip ONE leading `export default` from the source, so a file spelled the ESM
 * way still compiles.
 *
 * Narrow on purpose: only a prefix of the WHOLE (trimmed) source is stripped,
 * never an occurrence further in, so this cannot rewrite text inside a string or
 * a comment. A file with top-level statements before an `export default` keeps
 * its `export` and fails loudly with the explaining error, which is the honest
 * outcome: it is a module, and modules are not what `script` loads.
 */
function stripExportDefault(source: string): string {
	const match = /^\s*export\s+default\s+/.exec(source);
	return match === null ? source : source.slice(match[0].length);
}

/**
 * A `script` source that does not parse in EITHER compile form.
 *
 * The message is the point. The old failure echoed the parser's token
 * ("Unexpected token 'const'") with no mention of the constraint that caused it,
 * so the author had to guess. This states what the file must end with, shows a
 * correct minimal example, lists what is now tolerated (so the author does not
 * "fix" something that already works), and names the two shapes that genuinely
 * cannot work. The parser's own message is kept at the end, and as `cause`, so
 * nothing is hidden.
 */
export class InvalidScriptSourceError extends Error {
	/** Stable, machine-readable discriminator (mirrors `core`'s typed errors). */
	readonly code = 'invalid-script-source' as const;

	constructor(cause: unknown) {
		super(
			[
				'script: the source must evaluate to a function of the page.',
				'',
				'The file must END with an EXPRESSION that IS the function, e.g.',
				'',
				'  async (page) => {',
				"    await page.click('#go');",
				'    return await page.title();',
				'  }',
				'',
				'Tolerated: a trailing semicolon, top-level statements before that final',
				'expression (e.g. `const CONFIG = {...}`), and a leading `export default`.',
				'NOT supported: ESM `import` (use a top-level const instead) and',
				'`module.exports = ...` (the file is not a module).',
				'',
				// Labelled by KIND: a parse failure and a "module is not defined" are both
				// legitimate ways to arrive here, and calling the second one a parser error
				// would send the author hunting for a syntax mistake that does not exist.
				`${cause instanceof SyntaxError ? 'Parser error' : 'Underlying error'}: ${
					cause instanceof Error ? cause.message : String(cause)
				}`,
			].join('\n'),
			{cause},
		);
		this.name = 'InvalidScriptSourceError';
	}
}
