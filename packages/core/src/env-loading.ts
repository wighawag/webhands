import {loadEnv} from 'ldenv';

/**
 * `.env` loading for the long-lived `serve` process (task
 * `env-placeholder-substitution-and-dotenv-loading`; prd
 * `distill-session-into-hand`, resolved decision #1).
 *
 * The controller that OWNS the browser (ADR-0005: `serve` launches the ONE
 * long-lived session) loads `.env` / `.env.local` / `.env.<mode>` at startup via
 * ldenv's importable {@link loadEnv}, so an `{ENV:NAME}` placeholder (see
 * `env-substitution.ts`) resolves against a gitignored `.env.local` and NOT only
 * the interactive shell. This is loaded in the SAME process that reads
 * `process.env` for substitution — the process that launches the browser — so a
 * value put in `.env.local` is visible to the `type` verb at type-time.
 *
 * WHY ldenv (not our own dotenv wiring): ldenv wraps `dotenv` +
 * `dotenv-expand` and, by its own documented contract, lets a variable ALREADY
 * PRESENT in the real environment WIN over a `.env` file (highest priority).
 * That is exactly the operator-expectation we want: an exported `PASSWORD` in
 * the shell beats a `PASSWORD` in a committed `.env`. We use ldenv ONLY as this
 * loader; the `{ENV:NAME}` placeholder grammar is webhands' own and is NOT
 * ldenv's `@@VAR` CLI syntax.
 *
 * ldenv MUTATES `process.env` in place (dotenv-expand assigns the parsed,
 * real-env-priority values back onto `process.env`), which is the whole point:
 * after this runs, `process.env.NAME` reflects the `.env` files, so the
 * in-process substitution reads them with no extra plumbing.
 */

/** Options for {@link loadWebhandsEnv}. */
export interface LoadWebhandsEnvOptions {
	/**
	 * The directory ldenv resolves `.env` files against (its `folder`, which
	 * bounds an upward search that STARTS at `process.cwd()`). Defaults to
	 * `process.cwd()` in production — the directory the operator ran `serve` from,
	 * where their project's `.env.local` lives.
	 *
	 * TESTS pass a TEMP dir here (and run with that dir as the cwd) so ldenv reads
	 * a fixture `.env.local` instead of the developer's real home/cwd files, and
	 * assert the real environment is untouched. See the env-loading test.
	 */
	readonly folder?: string;
	/**
	 * The ldenv mode, selecting `.env.<mode>` / `.env.<mode>.local` in addition to
	 * `.env` / `.env.local`. Omitted ⇒ ldenv's default (`local`, i.e. only `.env`
	 * + `.env.local`). Threaded through so a `serve --mode <m>` (a future flag)
	 * can select a mode; not wired to a flag today.
	 */
	readonly mode?: string;
}

/**
 * Load `.env` / `.env.local` / `.env.<mode>` into `process.env` for the served
 * controller, honouring ldenv's real-env-wins priority, and return the parsed
 * file variables (ldenv's own return value) for inspection/testing.
 *
 * Idempotent-ish: because the real environment wins, a var already set (by the
 * shell OR by a prior load) is NOT overwritten by a `.env` file, so a second
 * call cannot clobber an operator's exported value. Called once at `serve`
 * startup, before the browser is used, so `{ENV:NAME}` substitution at
 * type-time sees the loaded files.
 */
export function loadWebhandsEnv(
	options: LoadWebhandsEnvOptions = {},
): Record<string, string> {
	const folder = options.folder ?? process.cwd();
	return loadEnv({
		folder,
		...(options.mode !== undefined ? {mode: options.mode} : {}),
	});
}
