import {UnresolvedEnvPlaceholderError} from './errors.js';

/**
 * `{ENV:NAME}` placeholder substitution for the value-bearing verbs (task
 * `env-placeholder-substitution-and-dotenv-loading`; prd
 * `distill-session-into-hand`, resolved decision #1).
 *
 * This is webhands' OWN placeholder grammar, deliberately DISTINCT from ldenv's
 * `@@VAR` command-line syntax (ldenv is used here ONLY as the importable
 * `.env` loader, see `env-loading.ts`). A value-bearing verb (`type`) runs the
 * caller's value through {@link substituteEnvPlaceholders} at type-time, in the
 * SERVED controller process where the environment was loaded, so:
 *
 * - a value with NO `{ENV:...}` token is returned VERBATIM (backward compatible;
 *   the pre-substitution behaviour is unchanged for every ordinary value), and
 * - an `{ENV:NAME}` token is replaced by `process.env.NAME`, so the literal
 *   secret never appears in the tool-call, the (future) verb trace, or an
 *   emitted hand scaffold, while the real value still reaches the page.
 *
 * HONEST SCOPE (prd framing): `{ENV:NAME}` is HYGIENE, not a security boundary.
 * The substituted value still lands in the DOM and is readable back, and a local
 * agent could read the env itself; the point is only to avoid gratuitously
 * writing a literal credential into the tool-call and the on-disk artifacts when
 * a placeholder works identically. It is NOT trying to hide the secret from the
 * agent (the context already trusts the agent).
 *
 * LOUD over silent: an `{ENV:NAME}` whose variable is UNSET or EMPTY throws a
 * typed {@link UnresolvedEnvPlaceholderError} rather than substituting an empty
 * string. A silent empty type would look like a successful login while sending
 * nothing, the exact quiet-wrong-result this repo rejects.
 */

/**
 * The `{ENV:NAME}` token grammar. `NAME` is a POSIX-style environment variable
 * name: a letter or underscore followed by letters, digits, or underscores. The
 * grammar is intentionally narrow so it cannot ambiguously match arbitrary
 * `{...}` content a real value might legitimately contain (e.g. JSON, a
 * templating snippet); only a well-formed `{ENV:VALID_NAME}` is treated as a
 * placeholder, everything else is typed verbatim.
 */
const ENV_PLACEHOLDER = /\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Whether a value contains at least one well-formed `{ENV:NAME}` placeholder.
 * A pure helper so a caller (or a test) can branch without re-implementing the
 * grammar. A value with no placeholder is substituted to itself (verbatim).
 */
export function hasEnvPlaceholder(value: string): boolean {
	// `test` advances `lastIndex` on a global regex; reset so this stays pure.
	ENV_PLACEHOLDER.lastIndex = 0;
	const result = ENV_PLACEHOLDER.test(value);
	ENV_PLACEHOLDER.lastIndex = 0;
	return result;
}

/**
 * Resolve every `{ENV:NAME}` placeholder in `value` against `env` (defaults to
 * the current process's `process.env`, read AT CALL TIME — the served process
 * that loaded `.env` files at `serve` startup), returning the value with each
 * token replaced by its resolved environment value.
 *
 * - No placeholder ⇒ the value is returned UNCHANGED (verbatim, backward
 *   compatible). This is the common case and must stay a no-op.
 * - A placeholder whose var is a NON-EMPTY string ⇒ replaced by that value.
 * - A placeholder whose var is UNSET or EMPTY ⇒ throws
 *   {@link UnresolvedEnvPlaceholderError} naming the var (never a silent empty).
 *
 * Multiple placeholders in one value are each resolved; the FIRST unresolved one
 * fails loud. `verb` is threaded through only to name the failing verb in the
 * error (defaults to `type`, the sole value-bearing verb today).
 *
 * IN-PROCESS by design: it reads the env of the process it runs in (the served
 * controller), NOT a child process. Substitution is done here, in-process, so
 * the token crosses the RPC wire unchanged and only the served process ever
 * holds the resolved secret — which is what keeps the tool-call and the trace
 * free of the literal.
 */
export function substituteEnvPlaceholders(
	value: string,
	env: NodeJS.ProcessEnv = process.env,
	verb: string = 'type',
): string {
	// Fast path: no token ⇒ verbatim, so an ordinary value is untouched and this
	// function is a pure pass-through (the backward-compatible contract).
	if (!hasEnvPlaceholder(value)) {
		return value;
	}
	return value.replace(ENV_PLACEHOLDER, (_match, name: string) => {
		const resolved = env[name];
		if (resolved === undefined || resolved === '') {
			throw new UnresolvedEnvPlaceholderError(name, verb);
		}
		return resolved;
	});
}
