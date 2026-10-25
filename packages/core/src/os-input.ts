import {execFile, spawn, type ChildProcess} from 'node:child_process';
import {access, constants} from 'node:fs/promises';
import {delimiter, join} from 'node:path';
import {promisify} from 'node:util';
import {OsInputUnavailableError} from './errors.js';

const run = promisify(execFile);

/**
 * OS-level input for the extension transport (ADR-0018).
 *
 * Content-script events are `isTrusted: false`, which is exactly what an anti-bot
 * check reads, and `chrome.debugger` is CDP behind an infobar. So pointer and
 * keyboard input come from the OPERATING SYSTEM, driven by the controller: the
 * browser sees the same events a human's mouse and keyboard produce.
 *
 * Coordinates here are SCREEN DEVICE pixels of the backend's display. The
 * conversion from the seam's viewport CSS pixels lives in the transport, where
 * the page geometry is known.
 *
 * Built: X11 via `xdotool` (XTest). Designed behind this interface, not built:
 * Wayland (uinput, e.g. `ydotool`, needs `/dev/uinput` access), macOS (Quartz
 * `CGEvent`, needs the Accessibility permission) and Windows (`SendInput`).
 */
export interface InputBackend {
	/** A human-readable name for messages (`xdotool on :99`). */
	readonly name: string;
	move(x: number, y: number): Promise<void>;
	down(button: MouseButtonName): Promise<void>;
	up(button: MouseButtonName): Promise<void>;
	click(button: MouseButtonName): Promise<void>;
	/** Type literal text into whatever has keyboard focus. */
	type(text: string): Promise<void>;
	/** Press a key chord in Playwright's grammar (`Control+A`, `Enter`). */
	key(chord: string): Promise<void>;
}

export type MouseButtonName = 'left' | 'right' | 'middle';

const BUTTON: Readonly<Record<MouseButtonName, string>> = {
	left: '1',
	middle: '2',
	right: '3',
};

/** Milliseconds between typed keystrokes (a human-ish cadence). */
const TYPE_DELAY_MS = 35;

/** Env var naming the `xdotool` executable, for an install off `PATH`. */
export const XDOTOOL_ENV = 'WEBHANDS_XDOTOOL';
/** Env var naming the `Xvfb` executable, for an install off `PATH`. */
export const XVFB_ENV = 'WEBHANDS_XVFB';

/**
 * Find an executable: the env override (honoured EXACTLY: a wrong path is an
 * error, not a fallback), else the first match on `PATH`.
 */
export async function findExecutable(
	name: string,
	envName: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
	const override = env[envName];
	if (override !== undefined && override.trim() !== '') {
		return (await isExecutable(override)) ? override : undefined;
	}
	for (const dir of (env.PATH ?? '').split(delimiter)) {
		if (dir === '') continue;
		const candidate = join(dir, name);
		if (await isExecutable(candidate)) return candidate;
	}
	return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Map a Playwright key name (`keyboard.press` grammar) to an X keysym name.
 * Single printable characters pass through (xdotool resolves them itself).
 */
const KEYSYMS: Readonly<Record<string, string>> = {
	Control: 'ctrl',
	ControlOrMeta: 'ctrl',
	Alt: 'alt',
	Shift: 'shift',
	Meta: 'super',
	Enter: 'Return',
	Tab: 'Tab',
	Backspace: 'BackSpace',
	Delete: 'Delete',
	Escape: 'Escape',
	Space: 'space',
	' ': 'space',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	Home: 'Home',
	End: 'End',
	PageUp: 'Prior',
	PageDown: 'Next',
	Insert: 'Insert',
	'+': 'plus',
	'-': 'minus',
	'.': 'period',
	',': 'comma',
	'/': 'slash',
	';': 'semicolon',
	"'": 'apostrophe',
	'=': 'equal',
	'[': 'bracketleft',
	']': 'bracketright',
	'\\': 'backslash',
	'`': 'grave',
};

/** Translate a Playwright chord (`Control+Shift+A`) into an xdotool chord. */
export function toXdotoolChord(chord: string): string {
	if (chord === '+') return 'plus';
	// A trailing `+` key (`Control++`) is the one ambiguity of the `+` separator.
	const parts = chord.endsWith('++')
		? [...chord.slice(0, -2).split('+'), '+']
		: chord.split('+');
	return parts
		.map((part) => {
			if (part === '')
				throw new Error(`invalid key chord ${JSON.stringify(chord)}`);
			const mapped = KEYSYMS[part];
			if (mapped !== undefined) return mapped;
			if (/^F([1-9]|1[0-9]|2[0-4])$/.test(part)) return part;
			if (/^Key[A-Z]$/.test(part)) return part.slice(3).toLowerCase();
			if (/^Digit[0-9]$/.test(part)) return part.slice(5);
			if ([...part].length === 1) return part;
			throw new Error(
				`press: key ${JSON.stringify(part)} has no OS-level mapping on this transport`,
			);
		})
		.join('+');
}

/** The X11 backend: XTest through `xdotool`, on one display. */
export class XdotoolBackend implements InputBackend {
	readonly name: string;
	readonly #exe: string;
	readonly #env: NodeJS.ProcessEnv;

	constructor(
		exe: string,
		display: string,
		env: NodeJS.ProcessEnv = process.env,
	) {
		this.#exe = exe;
		this.#env = {...env, DISPLAY: display};
		this.name = `xdotool on ${display}`;
	}

	async #x(...args: string[]): Promise<void> {
		await run(this.#exe, args, {env: this.#env, timeout: 30_000});
	}

	move(x: number, y: number): Promise<void> {
		return this.#x(
			'mousemove',
			'--sync',
			String(Math.round(x)),
			String(Math.round(y)),
		);
	}
	down(button: MouseButtonName): Promise<void> {
		return this.#x('mousedown', BUTTON[button]);
	}
	up(button: MouseButtonName): Promise<void> {
		return this.#x('mouseup', BUTTON[button]);
	}
	click(button: MouseButtonName): Promise<void> {
		return this.#x('click', BUTTON[button]);
	}
	type(text: string): Promise<void> {
		// A human-ish cadence; xdotool remaps keysyms for characters outside the
		// keymap, so non-ASCII text types too.
		//
		// The text goes in on STDIN (`--file -`), never as an argument: `type`
		// resolves `{ENV:NAME}` secrets before this point, and an argument is
		// readable by every local process in /proc/<pid>/cmdline. The timeout
		// grows with the text, so long input is never cut off half-typed.
		const timeout = 30_000 + text.length * (TYPE_DELAY_MS + 20);
		return new Promise<void>((resolve, reject) => {
			const child = spawn(
				this.#exe,
				['type', '--delay', String(TYPE_DELAY_MS), '--file', '-'],
				{env: this.#env, stdio: ['pipe', 'ignore', 'pipe']},
			);
			let stderr = '';
			child.stderr?.on('data', (d: Buffer) => {
				stderr = (stderr + d.toString()).slice(-1000);
			});
			const timer = setTimeout(() => {
				child.kill('SIGKILL');
				reject(new Error(`xdotool type timed out after ${timeout}ms`));
			}, timeout);
			child.once('error', (cause) => {
				clearTimeout(timer);
				reject(cause);
			});
			child.once('exit', (code) => {
				clearTimeout(timer);
				if (code === 0) resolve();
				else
					reject(
						new Error(
							`xdotool type exited with code ${String(code)}: ${stderr}`,
						),
					);
			});
			child.stdin?.end(text);
		});
	}
	key(chord: string): Promise<void> {
		return this.#x('key', '--', toXdotoolChord(chord));
	}
}

/** A display the transport started for itself, and how to end it. */
export interface OwnedDisplay {
	/** The X display name (`:99`). */
	readonly display: string;
	close(): Promise<void>;
}

/**
 * Start a private Xvfb on a free display number (`-displayfd` lets the server
 * pick one and tell us), at 96 DPI so Chrome's device scale is 1 (finding
 * `branded-chrome-extension-install-paths`), with no TCP listener.
 */
export async function startXvfb(options: {
	readonly env?: NodeJS.ProcessEnv;
	readonly width?: number;
	readonly height?: number;
}): Promise<OwnedDisplay> {
	const env = options.env ?? process.env;
	const exe = await findExecutable('Xvfb', XVFB_ENV, env);
	if (exe === undefined) {
		throw new OsInputUnavailableError(
			'Xvfb',
			`the extension transport runs the browser on its own X display so OS ` +
				`input never moves your pointer, and Xvfb was not found on PATH (or ` +
				`at ${XVFB_ENV}). Install it (NixOS: the \`xvfb\` package; Debian/` +
				`Ubuntu: \`apt install xvfb\`), or pass --headed to use your own display.`,
		);
	}
	const width = options.width ?? 1920;
	const height = options.height ?? 1080;
	const child: ChildProcess = spawn(
		exe,
		[
			'-displayfd',
			'3',
			'-screen',
			'0',
			`${width}x${height}x24`,
			'-dpi',
			'96',
			'-nolisten',
			'tcp',
			// Exit when the last client (the browser) disconnects, so a controller
			// that dies without its teardown cannot leave a display behind once the
			// browser is gone.
			'-terminate',
		],
		{env, stdio: ['ignore', 'ignore', 'pipe', 'pipe'], detached: false},
	);
	let stderr = '';
	child.stderr?.on('data', (d: Buffer) => {
		stderr = (stderr + d.toString()).slice(-2000);
	});
	const display = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			// Never leave a half-started display behind.
			child.kill('SIGKILL');
			reject(new Error(`Xvfb did not report a display within 10s: ${stderr}`));
		}, 10_000);
		child.once('error', (cause) => {
			clearTimeout(timer);
			reject(cause);
		});
		const fd = child.stdio[3] as NodeJS.ReadableStream | null;
		let text = '';
		fd?.on('data', (d: Buffer) => {
			text += d.toString();
			if (text.includes('\n')) {
				clearTimeout(timer);
				resolve(`:${text.trim()}`);
			}
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`Xvfb exited with code ${String(code)}: ${stderr}`));
		});
	});
	return {
		display,
		async close() {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = new Promise<void>((r) => child.once('exit', () => r()));
			child.kill('SIGTERM');
			const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
			await exited;
			clearTimeout(timer);
		},
	};
}

/**
 * Pick the input backend for a display. Only X11 is built; anything else is a
 * typed refusal rather than a silent fallback to untrusted events.
 */
export async function inputBackendFor(
	display: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
	platform: string = process.platform,
): Promise<InputBackend> {
	if (platform !== 'linux') {
		throw new OsInputUnavailableError(
			'CGEvent/SendInput',
			`no OS-level input backend is built for ${platform} yet (ADR-0018 designs ` +
				`one behind the same interface). Use the default Playwright transport here.`,
		);
	}
	if (display === undefined || display === '') {
		throw new OsInputUnavailableError(
			'xdotool',
			'there is no X display to send input to (Wayland-only sessions need a uinput ' +
				'backend, which is not built; drop --headed to use a private Xvfb)',
		);
	}
	const exe = await findExecutable('xdotool', XDOTOOL_ENV, env);
	if (exe === undefined) {
		throw new OsInputUnavailableError(
			'xdotool',
			`xdotool was not found on PATH (or at ${XDOTOOL_ENV}). Install it (NixOS: ` +
				`the \`xdotool\` package; Debian/Ubuntu: \`apt install xdotool\`).`,
		);
	}
	return new XdotoolBackend(exe, display, env);
}
