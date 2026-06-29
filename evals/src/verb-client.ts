import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);

/**
 * The harness's window onto webhands' EXISTING surface (prd property 2; user
 * story 12). It shells out to the SAME `webhands <verb>` path the README leads
 * with, parses the structured JSON envelope incur emits, and exposes the READ
 * verbs the harness uses to make end-state assertions ITSELF
 * (`exists`/`count`/`getAttribute`/`query`/`snapshot`/`goto`). It adds NO new
 * verb: it is a thin client over the published CLI, never a back door.
 *
 * Every invocation targets the live SERVE session the harness owns, with
 * `WEBHANDS_HOME` pinned to the harness's isolated temp root (so the real
 * `~/.webhands` is never touched, ADR-0005 shared-write note).
 */

/** How to invoke webhands: the command + its fixed leading args. */
export interface WebhandsCommand {
	/** The executable (e.g. `node`, `npx`). */
	readonly command: string;
	/**
	 * Fixed leading args BEFORE the verb (e.g. `['/abs/path/dist/bin.js']` for
	 * `node`, or `['--yes', 'webhands']` for `npx`). The verb + its flags are
	 * appended per call.
	 */
	readonly args: readonly string[];
}

/** Config for a {@link VerbClient}: the command + the isolated home + env. */
export interface VerbClientOptions {
	/** How to invoke webhands (see {@link WebhandsCommand}). */
	readonly webhands: WebhandsCommand;
	/** The isolated `WEBHANDS_HOME` root every verb call is pinned to. */
	readonly home: string;
	/** Extra env to merge (the base is `process.env` + `WEBHANDS_HOME`). */
	readonly env?: NodeJS.ProcessEnv;
	/** Per-verb timeout (ms). Default 30s. */
	readonly timeoutMs?: number;
}

/**
 * The full incur envelope (`--full-output --format json`): `{ok, data, error,
 * meta}`. The verb's declared output payload is under `data`; an error envelope
 * carries `ok:false` + `error`.
 */
interface Envelope {
	readonly ok: boolean;
	readonly data?: Record<string, unknown>;
	readonly error?: {readonly code: string; readonly message: string};
	readonly meta?: unknown;
}

/**
 * Drive webhands' read verbs against the live served page. Each method runs one
 * `webhands <verb>` process, pins `WEBHANDS_HOME` to the isolated root, parses
 * the JSON envelope, and returns the typed field. Acting verbs are deliberately
 * NOT exposed: the harness READS to make a verdict; the AGENT (or the scripted
 * trace) is what ACTS.
 */
export class VerbClient {
	private readonly opts: VerbClientOptions;

	constructor(opts: VerbClientOptions) {
		this.opts = opts;
	}

	/** Navigate the served live page (used by the precheck to load the entry URL). */
	async goto(url: string): Promise<void> {
		await this.invoke('goto', [url]);
	}

	/** Does any element match this Playwright locator? (`webhands exists`). */
	async exists(locator: string): Promise<boolean> {
		const data = await this.invoke('exists', [locator]);
		return data.exists === true;
	}

	/** How many elements match this locator? (`webhands count`). */
	async count(locator: string): Promise<number> {
		const data = await this.invoke('count', [locator]);
		return typeof data.count === 'number' ? data.count : 0;
	}

	/** Is the first match actionability-grade visible? (`webhands is-visible`). */
	async isVisible(locator: string): Promise<boolean> {
		const data = await this.invoke('is-visible', [locator]);
		return data.visible === true;
	}

	/** Read a DOM attribute off the first match (`webhands get-attribute`). */
	async getAttribute(locator: string, name: string): Promise<string | null> {
		const data = await this.invoke('get-attribute', [locator, '--name', name]);
		return typeof data.value === 'string' ? data.value : null;
	}

	/** The page URL at snapshot time (`webhands snapshot`). */
	async url(): Promise<string> {
		const data = await this.invoke('snapshot', []);
		return typeof data.url === 'string' ? data.url : '';
	}

	/** The agent-readable snapshot content (`webhands snapshot`). */
	async snapshot(): Promise<string> {
		const data = await this.invoke('snapshot', []);
		return typeof data.content === 'string' ? data.content : '';
	}

	/**
	 * Run one `webhands <verb> ...args --full-output --format json` and return the
	 * envelope's `data` payload. `WEBHANDS_HOME` is pinned to the isolated root so
	 * reads hit the harness's own serve session and never the real `~/.webhands`.
	 * A non-zero exit or a non-`ok` envelope throws (the caller decides if that is
	 * a failed check or a health miss).
	 */
	private async invoke(
		verb: string,
		args: readonly string[],
	): Promise<Record<string, unknown>> {
		const argv = [
			...this.opts.webhands.args,
			verb,
			...args,
			'--full-output',
			'--format',
			'json',
		];
		const env: NodeJS.ProcessEnv = {
			...process.env,
			...this.opts.env,
			WEBHANDS_HOME: this.opts.home,
		};
		let stdout: string;
		try {
			const result = await run(this.opts.webhands.command, argv, {
				env,
				timeout: this.opts.timeoutMs ?? 30_000,
				maxBuffer: 32 * 1024 * 1024,
			});
			stdout = result.stdout;
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			throw new Error(`webhands ${verb} failed: ${detail}`);
		}
		const env2 = parseEnvelope(stdout);
		if (env2.ok === false) {
			const msg = env2.error?.message ?? stdout.trim();
			throw new Error(`webhands ${verb} returned a non-ok envelope: ${msg}`);
		}
		return env2.data ?? {};
	}
}

/**
 * Parse the structured JSON envelope incur prints (with `--json`). Tolerant of
 * leading/trailing noise: takes the first balanced `{...}` block, so a stray log
 * line cannot break the parse. Throws if no JSON object is found.
 */
export function parseEnvelope(stdout: string): Envelope {
	const start = stdout.indexOf('{');
	const end = stdout.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) {
		throw new Error(`no JSON envelope in webhands output: ${stdout.trim()}`);
	}
	const json = stdout.slice(start, end + 1);
	return JSON.parse(json) as Envelope;
}
