import type {EvalEntry} from '../eval-contract.js';

/**
 * ANTI-BOT eval: register for a free Luma event whose Register action is guarded
 * by Cloudflare Turnstile (ADR-0018; finding
 * `cloudflare-turnstile-refuses-any-browser-with-a-debugging-port`).
 *
 * Every CDP-based webhands mode was refused at exactly this step on 25 Oct 2026,
 * so this eval exists to RE-MEASURE the claim behind the extension transport
 * rather than leave it as folklore. It runs `serve --transport extension` (no
 * debugging port anywhere; trusted OS-level input) on a COPY of a profile a human
 * logged into Luma with.
 *
 * It is live, account-bound and side-effecting by nature, so it is configured
 * from the environment and never runs by default:
 *
 * - `WEBHANDS_EVAL_LUMA_EVENT`: the URL of a FREE, no-approval Luma event the
 *   account is NOT yet registered for (registering is the end state; a re-run
 *   needs a different event or a cancelled registration).
 * - `WEBHANDS_EVAL_LUMA_PROFILE`: the path of the logged-in profile directory to
 *   copy (only read, never modified). For branded Google Chrome it must already
 *   have the webhands extension loaded unpacked; also set `WEBHANDS_CHROME` and
 *   `WEBHANDS_EXTENSION_DIR` (the directory that profile loaded it from).
 * - `WEBHANDS_EVAL_LUMA_REAL_CHROME=1`: drive the system Chrome (`--real-chrome`)
 *   instead of the pinned Chrome for Testing; needed when the profile was written
 *   by branded Chrome.
 *
 * No cleanup: cancelling a registration is a host-visible action, and the
 * precheck refuses (INCONCLUSIVE) an event the account is already registered
 * for, so a stale registration can never read as a PASS.
 */

const EVENT_ENV = 'WEBHANDS_EVAL_LUMA_EVENT';
const PROFILE_ENV = 'WEBHANDS_EVAL_LUMA_PROFILE';
const REAL_CHROME_ENV = 'WEBHANDS_EVAL_LUMA_REAL_CHROME';

/** What Luma shows once registered ("You're In"), straight or curly apostrophe. */
const REGISTERED = `page.getByText(/You[’']re (In|Going)/)`;

/** The plain-language goal: no selectors, no steps, no URL beyond the entry. */
export function lumaGoalPrompt(entryUrl: string): string {
	return (
		`Register for the free event at ${entryUrl} (the browser is already ` +
		`signed in to the account to use, so keep whatever it pre-fills). If the site ` +
		`asks you to prove you are human, do what a person would do. You are done ` +
		`when the event page confirms that you are registered.`
	);
}

/**
 * Build the entry from the environment (see the module doc). Throws a clear,
 * actionable error when it is not configured, before any browser starts.
 */
export function buildLumaRegisterTurnstileEval(
	env: NodeJS.ProcessEnv = process.env,
): EvalEntry {
	const entryUrl = env[EVENT_ENV];
	const profile = env[PROFILE_ENV];
	if (
		entryUrl === undefined ||
		entryUrl === '' ||
		profile === undefined ||
		profile === ''
	) {
		throw new Error(
			`luma-register-turnstile is a live, account-bound eval: set ${EVENT_ENV} ` +
				`(a free Luma event URL you are not registered for) and ${PROFILE_ENV} ` +
				`(a profile directory logged in to Luma). With branded Chrome also set ` +
				`${REAL_CHROME_ENV}=1, WEBHANDS_CHROME and WEBHANDS_EXTENSION_DIR.`,
		);
	}
	if (!/^https:\/\/(www\.)?(luma\.com|lu\.ma)\//.test(entryUrl)) {
		throw new Error(`${EVENT_ENV} must be a https://luma.com/... event URL`);
	}
	return {
		id: 'luma-register-turnstile',
		tier: 'anti-bot',
		target: 'Luma (Cloudflare Turnstile)',
		entryUrl,
		goalPrompt: lumaGoalPrompt(entryUrl),
		serve: {
			profile: 'luma',
			transport: 'extension',
			...(env[REAL_CHROME_ENV] === '1' ? {realChrome: true} : {}),
		},
		seedProfileDir: profile,
		health: [
			{
				describe: 'the event page rendered its title (an h1)',
				check: (verbs) =>
					verbs.exists(`page.getByRole('heading', { level: 1 })`),
			},
			{
				describe: 'the account is signed in and NOT already registered',
				check: async (verbs) =>
					!(await verbs.exists(REGISTERED)) &&
					!(await verbs.exists(`page.getByRole('link', { name: 'Sign in' })`)),
			},
		],
		milestones: [
			{
				id: 'on-event-page',
				check: {
					describe: 'the session is still on the event page',
					check: async (verbs) =>
						(await verbs.url()).startsWith(entryUrl.replace(/\/$/, '')),
				},
			},
			{
				id: 'registered',
				check: {
					describe: 'the event page confirms the registration',
					check: (verbs) => verbs.exists(REGISTERED),
				},
			},
		],
		endState: [
			{
				describe: 'the event page confirms the registration ("You\u2019re In")',
				check: (verbs) => verbs.exists(REGISTERED),
			},
		],
	};
}
