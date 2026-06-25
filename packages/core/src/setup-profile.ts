import {mkdir} from 'node:fs/promises';
import {PlaywrightLaunchTransport} from './playwright-launch-transport.js';
import {
	resolveProfileLocation,
	type ProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';
import type {Session, Transport} from './seam.js';

/**
 * The headed one-time-login flow (PRD User Story 1; CONTEXT `setup-profile`;
 * ADR-0002).
 *
 * `setup-profile` opens the dedicated profile in a VISIBLE (headed) browser so
 * a human logs into a site and/or clears an anti-bot challenge ONCE. The
 * cookies/state the human's session writes persist in the profile dir, so a
 * later `launch --headless` against the SAME profile reuses that logged-in
 * state without re-login.
 *
 * This is the orchestration layer over the launch transport, not a second
 * transport: the launch transport refuses to launch a profile whose dir does
 * not exist (a typed {@link MissingProfileError}, so a `launch` typo cannot
 * spawn a blank profile). CREATING that dir is exactly `setup-profile`'s job,
 * which is why the launch transport defers it here. So this flow:
 *
 * 1. resolves the dedicated profile dir (isolated to a temp root in tests,
 *    never the real `~/.my-browser-controller`),
 * 2. CREATES it if absent (the one place a profile dir is created), so the
 *    profile is now "set up" for later launches,
 * 3. opens it HEADED through the launch transport, and
 * 4. emits a clear, actionable prompt telling the human what to do (log in /
 *    clear the challenge, then close the window) and WHICH profile is being set
 *    up.
 *
 * The verb only OPENS the window; it never types credentials or touches a
 * credential (ADR-0002: the human does the one-time login, we never bypass it
 * or solve CAPTCHAs). The caller holds the returned {@link Session} open for
 * the interactive login and closes it when the human is done; on close the
 * persistent context flushes the new state to the profile dir. The real
 * third-party login is exercised only in the manual Kayak smoke, not here.
 */

/** A function that receives the headed-login prompt (one call, the full text). */
export type PromptSink = (message: string) => void;

/** Options for {@link setupProfile}. */
export interface SetupProfileOptions extends ProfileLocationOptions {
	/** Name of the dedicated profile to set up (e.g. `default`). */
	readonly profile: string;
	/**
	 * Where the actionable prompt is delivered. Defaults to STDERR
	 * (`console.error`), because STDOUT is reserved for the CLI's structured
	 * output envelope; the human-facing instruction is a side-channel message.
	 * Tests inject a sink to assert the prompt's content.
	 */
	readonly onPrompt?: PromptSink;
	/**
	 * The transport that opens the headed session. Defaults to a
	 * {@link PlaywrightLaunchTransport} bound to this flow's profile location.
	 * Injectable so the orchestration (dir creation, headed open, prompt) is
	 * testable without a real browser, and so the SAME launch transport the PRD
	 * mandates is reused rather than a parallel headed-open path.
	 */
	readonly transport?: Transport;
}

/** The result of {@link setupProfile}: the live headed session + where it is. */
export interface SetupProfileResult {
	/**
	 * The live headed session, held OPEN for the human's interactive login. The
	 * caller closes it when the human is done; closing flushes the session state
	 * to the profile dir for a later headless launch.
	 */
	readonly session: Session;
	/** The resolved location of the profile that was set up. */
	readonly location: ProfileLocation;
}

/**
 * Run the headed `setup-profile` flow for {@link SetupProfileOptions.profile}.
 *
 * Creates the dedicated profile dir if absent, opens it headed through the
 * launch transport, emits the actionable prompt, and returns the live session
 * for the caller to hold open during the interactive login (see this module's
 * overview). Does NOT close the session: holding it open IS the headed-login
 * window, and the caller owns its lifetime.
 */
export async function setupProfile(
	options: SetupProfileOptions,
): Promise<SetupProfileResult> {
	const {profile, onPrompt, transport, ...locationOptions} = options;
	const location = resolveProfileLocation(profile, locationOptions);

	// Create the dedicated profile dir (idempotent). This is the ONE place a
	// profile dir is created: the launch transport refuses a missing one with
	// MissingProfileError precisely so `setup-profile` owns its creation.
	await mkdir(location.profileDir, {recursive: true});

	const driver = transport ?? new PlaywrightLaunchTransport(locationOptions);

	// Open the profile HEADED (visible) so the human can interact with it.
	const session = await driver.open({
		mode: 'launch',
		profile,
		headed: true,
	});

	const sink: PromptSink = onPrompt ?? ((m) => console.error(m));
	sink(buildPrompt(location));

	return {session, location};
}

/**
 * Compose the clear, actionable headed-login prompt (PRD acceptance: tell the
 * user what to do AND which profile is being set up). Kept pure so a test can
 * assert its content directly.
 */
export function buildPrompt(location: ProfileLocation): string {
	return [
		`Setting up the "${location.profile}" profile for my-browser-controller.`,
		`Profile directory: ${location.profileDir}`,
		'',
		'A browser window is now open. In that window:',
		'  1. Log in to the site(s) you want this profile to stay signed in to.',
		'  2. Clear any anti-bot challenge / CAPTCHA if one appears.',
		'  3. When you are done, CLOSE the browser window.',
		'',
		'Your session (cookies, logins, challenge clearance) is saved into the',
		'profile directory above, so a later `launch --headless` against the same',
		'profile reuses it without re-login. Nobody but you types your credentials:',
		'this tool only opens the window.',
	].join('\n');
}
