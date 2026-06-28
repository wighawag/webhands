import {homedir} from 'node:os';
import {join} from 'node:path';

/**
 * Where the controller's dedicated profiles (and other config state) live.
 *
 * This is a SHARED/GLOBAL, per-user location: by default
 * `~/.webhands`. Profiles are dedicated browser user-data dirs
 * under `<root>/profiles/<name>` (PRD "Profile management"; ADR-0002: never the
 * OS default Chrome profile). The endpoint file from ADR-0005 also lives under
 * this root, owned by a later task.
 *
 * Because writing here touches a real, shared location, TESTS MUST override the
 * root to a scratch dir and assert the real one is untouched. The override is
 * the {@link CONTROLLER_HOME_ENV} environment variable (or an explicit
 * `root` passed to {@link resolveProfileLocation}); nothing else points a
 * launch at the real home.
 */

/** The directory name appended to the user's home for the default root. */
export const DEFAULT_HOME_DIRNAME = '.webhands';

/**
 * Environment variable that overrides the controller home root. Set this (to a
 * temp dir) in tests, or to relocate state in production. When set to a
 * non-empty value it fully replaces the `~/.webhands` default.
 */
export const CONTROLLER_HOME_ENV = 'WEBHANDS_HOME';

/** The subdirectory under the home root that holds dedicated profiles. */
export const PROFILES_DIRNAME = 'profiles';

/**
 * The subdirectory under the home root where the `screenshot` verb MINTS its
 * PNG files (the Tier-4 managed screenshots dir, prd
 * `broaden-agent-verb-surface`, R3). It lives BESIDE `profiles/` under the SAME
 * overridable home root, so the same `root`/`WEBHANDS_HOME` override that
 * isolates profiles in a test also isolates screenshots — nothing writes to the
 * real `~/.webhands/screenshots` unless the home root points there.
 */
export const SCREENSHOTS_DIRNAME = 'screenshots';

/** Inputs that influence where a profile resolves (all optional, for tests). */
export interface ProfileLocationOptions {
	/**
	 * Explicit home root, highest precedence. When omitted, falls back to the
	 * {@link CONTROLLER_HOME_ENV} env var, then `~/.webhands`.
	 */
	readonly root?: string;
	/** Environment to read the override from. Defaults to `process.env`. */
	readonly env?: NodeJS.ProcessEnv;
}

/** A resolved set of controller paths for a given profile name. */
export interface ProfileLocation {
	/** The controller home root (e.g. `~/.webhands`). */
	readonly homeRoot: string;
	/** The directory holding all dedicated profiles (`<homeRoot>/profiles`). */
	readonly profilesRoot: string;
	/** The dedicated user-data dir for this profile (`<profilesRoot>/<name>`). */
	readonly profileDir: string;
	/** The profile name that was resolved. */
	readonly profile: string;
}

/**
 * Resolve the controller home root. Precedence:
 * 1. an explicit `options.root`,
 * 2. the {@link CONTROLLER_HOME_ENV} env var (if non-empty),
 * 3. `~/.webhands`.
 */
export function resolveHomeRoot(options: ProfileLocationOptions = {}): string {
	if (options.root !== undefined && options.root !== '') {
		return options.root;
	}
	const env = options.env ?? process.env;
	const fromEnv = env[CONTROLLER_HOME_ENV];
	if (fromEnv !== undefined && fromEnv !== '') {
		return fromEnv;
	}
	return join(homedir(), DEFAULT_HOME_DIRNAME);
}

/**
 * Resolve every path for a named profile. Does NOT touch the filesystem (no
 * dir is created or checked here) so it is pure and safe to call freely; the
 * transport decides what to do when the dir is absent (raise
 * `MissingProfileError`) or present.
 */
export function resolveProfileLocation(
	profile: string,
	options: ProfileLocationOptions = {},
): ProfileLocation {
	const homeRoot = resolveHomeRoot(options);
	const profilesRoot = join(homeRoot, PROFILES_DIRNAME);
	return {
		homeRoot,
		profilesRoot,
		profileDir: join(profilesRoot, profile),
		profile,
	};
}

/**
 * Resolve the managed SCREENSHOTS directory (`<homeRoot>/screenshots`) the
 * `screenshot` verb mints PNGs under (prd `broaden-agent-verb-surface`, R3).
 * Like {@link resolveProfileLocation} it is PURE (creates no directory) and
 * honours the same `root`/`WEBHANDS_HOME` precedence, so a test that points the
 * home root at a temp dir isolates screenshots there and the real
 * `~/.webhands/screenshots` stays untouched. The verb (in the transport) is
 * responsible for creating the dir lazily on first write.
 */
export function resolveScreenshotsDir(
	options: ProfileLocationOptions = {},
): string {
	return join(resolveHomeRoot(options), SCREENSHOTS_DIRNAME);
}
