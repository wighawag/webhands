/**
 * The `cookies export` / `cookies import` verb's FILE FORMAT (PRD story 11).
 *
 * The seam already carries the transport-neutral cookie primitives:
 * {@link Page.cookies} reads the active context's cookies and
 * {@link Page.setCookies} loads cookies into it. The export/import VERB is built
 * ON TOP of those two methods (the forward-note: refine the existing seam,
 * do NOT add a parallel cookie path). What this module adds is only the
 * SERIALIZATION the verb needs to move a session to/from disk: how a
 * `Cookie[]` is written to (and read back from) an export file.
 *
 * The format is deliberately transport-neutral JSON of the seam's own
 * {@link Cookie} type (no CDP/Playwright type, ADR-0003): a small envelope
 * (`{version, cookies}`) so the file is self-describing and a future format
 * change can be detected rather than silently mis-parsed. Both the CLI verb and
 * the round-trip test share THIS one source of truth for the format, so the
 * thing a user backs up and the thing import reads back can never drift apart.
 */

import type {Cookie} from './seam.js';

/**
 * The current export-file schema version. Bumped only on a
 * backwards-INCOMPATIBLE format change; {@link deserializeCookies} rejects an
 * unknown version rather than guessing.
 */
export const COOKIES_EXPORT_VERSION = 1 as const;

/**
 * The on-disk shape of an exported session: a versioned envelope around the
 * transport-neutral {@link Cookie} list. Self-describing so import can verify
 * it is reading a format it understands.
 */
export interface CookiesExport {
	/** Format version (see {@link COOKIES_EXPORT_VERSION}). */
	readonly version: typeof COOKIES_EXPORT_VERSION;
	/** The exported cookies, exactly as the seam's {@link Page.cookies} returns them. */
	readonly cookies: readonly Cookie[];
}

/**
 * Serialize the cookies read from the seam ({@link Page.cookies}) into the
 * export file's text. Pretty-printed JSON so a human can read/diff a backed-up
 * session. This is pure: it does NO disk I/O, so the caller (the CLI verb, a
 * test) owns WHERE the file lands — which is what lets a test keep its export
 * file in its own temp dir.
 */
export function serializeCookies(cookies: readonly Cookie[]): string {
	const payload: CookiesExport = {
		version: COOKIES_EXPORT_VERSION,
		cookies,
	};
	return JSON.stringify(payload, null, '\t') + '\n';
}

/**
 * Parse an export file's text back into the cookies to hand to the seam's
 * {@link Page.setCookies} ({@link parse} is pure; the caller does the disk read
 * and the `setCookies` call). Rejects anything that is not a recognised export
 * envelope so a corrupt or wrong-version file surfaces as a clear error rather
 * than silently importing nothing or a half-parsed list.
 *
 * @throws Error if the text is not valid JSON, not the expected envelope shape,
 *   or carries an unknown {@link COOKIES_EXPORT_VERSION}.
 */
export function deserializeCookies(text: string): readonly Cookie[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (cause) {
		throw new Error('cookies import: file is not valid JSON', {cause});
	}

	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('cookies import: file is not a cookies export envelope');
	}

	const envelope = parsed as {version?: unknown; cookies?: unknown};
	if (envelope.version !== COOKIES_EXPORT_VERSION) {
		throw new Error(
			`cookies import: unsupported export version ${String(
				envelope.version,
			)} (expected ${COOKIES_EXPORT_VERSION})`,
		);
	}
	if (!Array.isArray(envelope.cookies)) {
		throw new Error('cookies import: export envelope has no cookies array');
	}

	return envelope.cookies as readonly Cookie[];
}
