import {describe, expect, it} from 'vitest';
import {
	compileScriptSource,
	InvalidScriptSourceError,
	isControllerError,
} from '../src/index.js';

/**
 * The `script` verb's SOURCE COMPILE (ADR-0012's contract unchanged: the file's
 * VALUE is the function; only the compile tolerates how it is spelled).
 *
 * PURE tests: no browser, no fixture server, no Playwright. The compile step is
 * deliberately a standalone module taking `unknown` page bindings (ADR-0003), so
 * the shapes a human naturally writes can be pinned here without the cost and
 * flakiness of a real launch. The end-to-end proof that the verb runs such a
 * file against a live page lives in `script-verb.test.ts`.
 *
 * The regression these lock in: the historical compile textually wrapped the
 * source in an expression position (`return (<source>)`), so a trailing
 * semicolon failed with "Unexpected token ';'" and a top-level `const` with
 * "Unexpected token 'const'" — messages that name the token and never the
 * constraint that caused it.
 */
describe('compileScriptSource (script verb source shapes)', () => {
	/** Sentinel page bindings: compile never touches them, it only binds them. */
	const bindings = {page: {marker: 'PAGE'}, p: {marker: 'PAGE'}};

	describe('the shapes that already worked keep working', () => {
		it('compiles a bare arrow expression (the documented form)', () => {
			const fn = compileScriptSource(
				'async (page) => page.marker',
				bindings,
			) as (page: unknown) => Promise<unknown>;
			expect(typeof fn).toBe('function');
		});

		it('binds `page` and `p` into the source scope', async () => {
			// A body that names `page` directly (not via its parameter) resolves the
			// binding, and so does the `p` shorthand — the same two names the locator
			// compiler binds.
			const fromPage = compileScriptSource(
				'() => page.marker',
				bindings,
			) as () => string | undefined;
			const fromP = compileScriptSource('() => p.marker', bindings) as () =>
				| string
				| undefined;
			expect(fromPage()).toBe('PAGE');
			expect(fromP()).toBe('PAGE');
		});

		it('invokes with the caller-supplied page, returning the script result', async () => {
			const fn = compileScriptSource(
				'async (page) => `seen:${page.marker}`',
				bindings,
			) as (page: unknown) => Promise<string>;
			await expect(fn(bindings.page)).resolves.toBe('seen:PAGE');
		});
	});

	describe('the shapes that used to be hard syntax errors', () => {
		it('tolerates a TRAILING SEMICOLON after the arrow function', () => {
			// Previously: `return (async (page) => {...};);` => "Unexpected token ';'".
			const fn = compileScriptSource(
				'async (page) => {\n\treturn page.marker;\n};',
				bindings,
			);
			expect(typeof fn).toBe('function');
		});

		it('tolerates TOP-LEVEL statements before the final function expression', () => {
			// Previously: `return (const CONFIG = ...)` => "Unexpected token 'const'".
			const source = [
				"const CONFIG = {greeting: 'hi'};",
				'function shout(text) {',
				'\treturn text.toUpperCase();',
				'}',
				'',
				'async (page) => shout(`${CONFIG.greeting}:${page.marker}`)',
			].join('\n');
			const fn = compileScriptSource(source, bindings) as (
				page: unknown,
			) => Promise<string>;
			expect(typeof fn).toBe('function');
			return expect(fn(bindings.page)).resolves.toBe('HI:PAGE');
		});

		it('tolerates top-level statements AND a trailing semicolon together', () => {
			const source = ['const N = 3;', 'async (page) => N * 2;'].join('\n');
			const fn = compileScriptSource(source, bindings) as (
				page: unknown,
			) => Promise<number>;
			return expect(fn(bindings.page)).resolves.toBe(6);
		});

		it('tolerates a leading `export default` (the other natural reflex)', () => {
			const fn = compileScriptSource(
				'export default async (page) => page.marker;',
				bindings,
			);
			expect(typeof fn).toBe('function');
		});

		it('keeps a leading comment working in the module-style path', () => {
			const source = [
				'// Drive the booking flow.',
				'const SEAT = "window";',
				'async (page) => SEAT;',
			].join('\n');
			expect(typeof compileScriptSource(source, bindings)).toBe('function');
		});
	});

	describe('failures state the constraint instead of echoing a token', () => {
		/** Compile and return the rejection, asserting it is the typed error. */
		function failureFor(source: string): InvalidScriptSourceError {
			let thrown: unknown;
			try {
				compileScriptSource(source, bindings);
			} catch (cause) {
				thrown = cause;
			}
			expect(thrown).toBeInstanceOf(InvalidScriptSourceError);
			return thrown as InvalidScriptSourceError;
		}

		it('explains the contract, shows an example, and names what is tolerated', () => {
			const err = failureFor('async (page) => {');
			expect(err.code).toBe('invalid-script-source');
			// Deliberately NOT a ControllerError, unlike every other typed error added
			// alongside it. A ControllerError's contract is that the CLI maps its `code` to
			// a message plus an exact FIX COMMAND; no command fixes a malformed script, and
			// the explaining message below IS the fix. The `script` verb already wraps this
			// in its own `invalid-script` envelope code. Asserted so the asymmetry reads as
			// a decision rather than an oversight.
			expect(isControllerError(err)).toBe(false);
			// States the constraint...
			expect(err.message).toMatch(/must END with an EXPRESSION/);
			// ...shows a correct minimal example...
			expect(err.message).toMatch(/async \(page\) => \{/);
			// ...and tells the author what it already accepts, so they do not "fix"
			// something that works.
			expect(err.message).toMatch(/trailing semicolon/);
			expect(err.message).toMatch(/top-level statements/);
			// ...while still surfacing the parser's own words (nothing hidden).
			expect(err.message).toMatch(/Parser error: /);
			expect(err.cause).toBeInstanceOf(SyntaxError);
		});

		it('names `module.exports` as unsupported, the other reflex the message mentions', () => {
			// The error text advertises `module.exports = ...` as a known-unsupported
			// shape, so it must actually ARRIVE at that error. It used to escape as a bare
			// `ReferenceError: module is not defined`, i.e. exactly the token-echoing
			// failure this whole change replaced.
			const err = failureFor('module.exports = async (page) => 1;');
			expect(err.message).toMatch(/module\.exports/);
			expect(err.message).toMatch(/must END with an EXPRESSION/);
		});

		it('names ESM `import` as unsupported rather than failing cryptically', () => {
			const err = failureFor(
				['import fs from "node:fs";', 'async (page) => 1;'].join('\n'),
			);
			expect(err.message).toMatch(/ESM `import`/);
			expect(err.message).toMatch(/use a top-level const instead/);
		});

		it('reports a non-function value through the verb contract, not the compile', () => {
			// `{a: 1}` PARSES in the program form (as a block) and yields a value, so
			// the compile legitimately succeeds and the "not a function" check is the
			// caller's (runScript's) job. Pinning it here documents the split.
			expect(typeof compileScriptSource('{a: 1}', bindings)).not.toBe(
				'function',
			);
		});
	});

	describe("a source that PARSES but throws is the caller's own error", () => {
		it('propagates the runtime error untouched (not wrapped as a shape problem)', () => {
			expect(() =>
				compileScriptSource('(() => { throw new Error("boom"); })()', bindings),
			).toThrowError(/boom/);
		});

		it('does NOT re-run a source whose own RUNTIME SyntaxError looks like a parse error', () => {
			// The trap this pins, found in review. `JSON.parse`, `new RegExp` and a nested
			// `eval` all throw SyntaxError at RUNTIME. An earlier version compiled and
			// invoked inside ONE try and branched on `instanceof SyntaxError`, so such a
			// script was indistinguishable from a file with the wrong shape: it got re-run
			// from the top (side effects TWICE, which for a half-driven booking flow is a
			// real hazard) and the author was then shown a shape complaint instead of
			// their own parse error.
			const calls: string[] = [];
			const bad = {
				page: {
					bump() {
						calls.push('bump');
						return '{not json';
					},
				},
				p: undefined,
			};
			// Parses fine as an expression; throws SyntaxError from JSON.parse when run.
			const source = '((cfg) => async (page) => cfg)(JSON.parse(page.bump()))';

			let thrown: unknown;
			try {
				compileScriptSource(source, bad);
			} catch (cause) {
				thrown = cause;
			}

			// The caller's OWN error, surfaced as-is: not remapped to a shape complaint.
			expect(thrown).toBeInstanceOf(SyntaxError);
			expect(thrown).not.toBeInstanceOf(InvalidScriptSourceError);
			expect((thrown as Error).message).toMatch(/JSON/i);
			// And the side effect happened EXACTLY once.
			expect(calls).toEqual(['bump']);
		});

		it('runs a module-style source exactly once too (no double side effects)', () => {
			// The program form is only reached when the expression form does not PARSE, so
			// there is no first evaluation to double. Pinned because the guarantee is a
			// property of the compile ORDER, which a future refactor could quietly lose.
			const calls: string[] = [];
			const counting = {
				page: {
					tick() {
						calls.push('tick');
						return 1;
					},
				},
				p: undefined,
			};
			// A top-level statement (so only the PROGRAM form parses) with a side effect.
			const fn = compileScriptSource(
				['const n = page.tick();', 'async () => n;'].join('\n'),
				counting,
			);
			expect(typeof fn).toBe('function');
			expect(calls).toEqual(['tick']);
		});

		it('does not evaluate the source twice when it throws at top level', () => {
			// The program-form retry is reached ONLY on a SyntaxError, so a source
			// that parses and throws must run exactly once; a double-run would repeat
			// the side effects of a half-finished flow.
			const calls: number[] = [];
			const counting = {
				page: {
					tick() {
						calls.push(1);
						throw new Error('after-tick');
					},
				},
				p: undefined,
			};
			expect(() => compileScriptSource('page.tick()', counting)).toThrowError(
				/after-tick/,
			);
			expect(calls).toHaveLength(1);
		});
	});
});
