import {readFile} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Hand} from './hand-host.js';

/**
 * Explicit, declarative third-party-hand loading (Phase 2 of the "hands" prd,
 * `work/prds/tasked/hands-pluggable-page-capabilities.md`; ADR-0007).
 *
 * A third-party **hand** is in-process Node code the host will hand the live
 * Playwright page (see {@link Hand}). Because that is arbitrary Node code in the
 * webhands process — a strictly LARGER surface than `eval` (which is sandboxed
 * to the page's JS world) — loading a hand is a TRUST act: the right mental
 * model is npm supply-chain trust, "loading a hand == trusting an in-process npm
 * dependency" (ADR-0007). This module makes that trust act EXPLICIT and
 * DECLARATIVE, modeled on pi's `packages[]`:
 *
 * - A hand loads ONLY because it is NAMED in config ({@link HandsConfig}), each
 *   entry carrying a PINNED entry point. NAMING a hand in config IS the trust
 *   act.
 * - There is NO auto-discovery, NO `node_modules` scan, NO convention-inferred
 *   entry file. An installed-but-not-named hand never loads.
 * - INSTALL is SEPARATE from LOAD/trust: `npm install <hand>` alone never
 *   auto-loads it; the operator installs the dependency themselves (a managed
 *   installer is explicitly OUT of scope) and then names it here to load it.
 *
 * The trust boundary stays LOCAL-only: hands widen the in-process surface, not
 * the remote one (no new network listener). This module never installs, never
 * scans a directory, and never reads anything beyond the entries the config
 * explicitly names.
 */

/**
 * One explicitly-named third-party hand. NAMING an entry here is the trust act
 * (ADR-0007); webhands will load EXACTLY this entry and nothing it was not told
 * about.
 */
export interface HandEntry {
	/**
	 * The operator-chosen identifier for this hand. Used in error messages and
	 * to make the config self-documenting; it has no install side effect (naming
	 * is the trust act, not an install instruction).
	 */
	readonly name: string;
	/**
	 * Descriptive provenance, e.g. `npm:@scope/hand` or `git:https://…`. Mirrors
	 * pi's named-source shape. It is RECORDED, not acted on: webhands does NOT
	 * install from it (install is separate from load/trust — the operator
	 * installs the dependency themselves). Optional.
	 */
	readonly source?: string;
	/**
	 * The PINNED entry point: the exact module file webhands will `import()`. No
	 * convention-inferred entry, no `package.json` `main` lookup, no directory
	 * scan — the operator pins the file. A relative path is resolved against
	 * {@link LoadHandsOptions.baseDir} (the config's own directory); an absolute
	 * path is used as-is.
	 */
	readonly entry: string;
}

/**
 * The webhands hand config: an EXPLICIT named list of third-party hands. Modeled
 * on pi's `settings.json` `packages[]` (a named list of sources, each with a
 * pinned entry). An empty/absent list means no third-party hands load.
 */
export interface HandsConfig {
	readonly hands: readonly HandEntry[];
}

/** The filename webhands reads the hand config from, under the home root. */
export const HANDS_CONFIG_FILENAME = 'hands.json';

/** A loaded hand paired with the config entry that named it (for diagnostics). */
export interface LoadedHand {
	readonly entry: HandEntry;
	readonly hand: Hand;
}

/** Options controlling how config entries resolve to modules. */
export interface LoadHandsOptions {
	/**
	 * The base directory a relative {@link HandEntry.entry} resolves against.
	 * Defaults to the current working directory. In production this is the
	 * config's own directory; in tests it points at a scratch dir so the real
	 * config/loading paths are never touched.
	 */
	readonly baseDir?: string;
	/**
	 * The importer used to load a pinned entry. Defaults to a dynamic `import()`
	 * of the resolved file URL. Injectable so tests can load a fixture hand
	 * without a real on-disk module.
	 */
	readonly importModule?: (specifier: string) => Promise<unknown>;
}

/**
 * Error raised when a NAMED hand cannot be loaded: its pinned entry is missing,
 * fails to import, or does not export a {@link Hand}. A named hand that fails to
 * resolve is a hard error (not a silent skip) so a typo or a broken/half-removed
 * dependency surfaces loudly rather than silently dropping a capability the
 * operator explicitly trusted.
 */
export class HandLoadError extends Error {
	readonly entry: HandEntry;
	constructor(entry: HandEntry, detail: string, options?: {cause?: unknown}) {
		super(
			`failed to load hand '${entry.name}' (entry '${entry.entry}'): ${detail}`,
			options,
		);
		this.name = 'HandLoadError';
		this.entry = entry;
	}
}

/**
 * Read the hand config from `<homeRoot>/hands.json`. A missing file yields an
 * EMPTY config (no third-party hands) — the default, install-separate-from-load
 * posture: webhands loads nothing it was not explicitly told to. A present file
 * that is malformed is a hard error (so a broken config is not silently treated
 * as "no hands").
 */
export async function readHandsConfig(homeRoot: string): Promise<HandsConfig> {
	const path = resolve(homeRoot, HANDS_CONFIG_FILENAME);
	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') {
			return {hands: []};
		}
		throw cause;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new Error(`invalid hand config at ${path}: not valid JSON`, {cause});
	}
	return normalizeConfig(parsed, path);
}

/**
 * Validate a parsed config object into a {@link HandsConfig}. Enforces the
 * explicit-named-list + pinned-entry shape: every entry MUST carry a non-empty
 * `name` and a non-empty `entry` (the pinned module). A missing/blank pin is
 * rejected rather than guessed (no convention-inferred entry).
 */
export function normalizeConfig(
	parsed: unknown,
	whence = 'hand config',
): HandsConfig {
	if (parsed === null || typeof parsed !== 'object') {
		throw new Error(`invalid ${whence}: expected an object`);
	}
	const handsValue = (parsed as {hands?: unknown}).hands;
	if (handsValue === undefined) {
		return {hands: []};
	}
	if (!Array.isArray(handsValue)) {
		throw new Error(`invalid ${whence}: 'hands' must be an array`);
	}
	const hands = handsValue.map((value, i) => normalizeEntry(value, i, whence));
	return {hands};
}

function normalizeEntry(value: unknown, i: number, whence: string): HandEntry {
	if (value === null || typeof value !== 'object') {
		throw new Error(`invalid ${whence}: hands[${i}] must be an object`);
	}
	const {name, entry, source} = value as Record<string, unknown>;
	if (typeof name !== 'string' || name === '') {
		throw new Error(
			`invalid ${whence}: hands[${i}].name must be a non-empty string`,
		);
	}
	if (typeof entry !== 'string' || entry === '') {
		throw new Error(
			`invalid ${whence}: hands[${i}].entry (the pinned entry point) must be a non-empty string`,
		);
	}
	if (source !== undefined && typeof source !== 'string') {
		throw new Error(`invalid ${whence}: hands[${i}].source must be a string`);
	}
	return source === undefined ? {name, entry} : {name, entry, source};
}

/**
 * Load every hand NAMED in `config`, in declaration order. Each entry's pinned
 * {@link HandEntry.entry} is resolved (relative ⇒ against
 * {@link LoadHandsOptions.baseDir}) and imported; the module must export a
 * {@link Hand} as its DEFAULT export or as a named `hand` export. A failure to
 * resolve/import/validate a named hand throws {@link HandLoadError} (named hands
 * fail loud, never silently skip).
 *
 * Loading nothing for an empty list is the whole point of the model: only the
 * entries the operator explicitly named load, so an installed-but-not-named hand
 * is never reached here.
 */
export async function loadHands(
	config: HandsConfig,
	options: LoadHandsOptions = {},
): Promise<LoadedHand[]> {
	const baseDir = options.baseDir ?? process.cwd();
	const importModule =
		options.importModule ??
		((specifier) => import(specifier) as Promise<unknown>);

	const loaded: LoadedHand[] = [];
	for (const entry of config.hands) {
		const specifier = resolveEntrySpecifier(entry.entry, baseDir);
		let mod: unknown;
		try {
			mod = await importModule(specifier);
		} catch (cause) {
			throw new HandLoadError(entry, 'could not import the pinned entry', {
				cause,
			});
		}
		const hand = extractHand(mod);
		if (hand === undefined) {
			throw new HandLoadError(
				entry,
				'the module does not export a Hand (expected a default export or a named `hand` export that is a function)',
			);
		}
		loaded.push({entry, hand});
	}
	return loaded;
}

/**
 * Resolve a pinned entry to an import specifier. A relative/absolute filesystem
 * path is resolved against `baseDir` and converted to a `file://` URL (so a
 * Windows path or a path with spaces imports correctly); anything else is passed
 * through verbatim (the operator may pin a bare package specifier they have
 * installed themselves — webhands does not install it).
 */
function resolveEntrySpecifier(entry: string, baseDir: string): string {
	if (isAbsolute(entry) || entry.startsWith('.')) {
		return pathToFileURL(resolve(baseDir, entry)).href;
	}
	return entry;
}

/** Pull a {@link Hand} out of an imported module (default or named `hand`). */
function extractHand(mod: unknown): Hand | undefined {
	if (mod === null || typeof mod !== 'object') {
		return undefined;
	}
	const record = mod as Record<string, unknown>;
	const candidate = record.default ?? record.hand;
	return typeof candidate === 'function' ? (candidate as Hand) : undefined;
}
