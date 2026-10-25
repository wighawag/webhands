import {spawn, type ChildProcess} from 'node:child_process';
import {mkdir, stat, writeFile} from 'node:fs/promises';
import {
	ExtensionNotConnectedError,
	MissingProfileError,
	RealChromeStartError,
	StaleRefError,
	UnsupportedByTransportError,
} from './errors.js';
import {substituteEnvPlaceholders} from './env-substitution.js';
import {
	BridgeDisconnectedError,
	mintBridgeToken,
	startExtensionBridge,
	type ExtensionBridge,
} from './extension-bridge.js';
import {
	EXTENSION_ID,
	resolveExtensionDir,
	writeExtension,
	writeExtensionConfig,
} from './extension-files.js';
import {
	matchesCookieFilter,
	normalizeRefToLocator,
	pngDimensions,
	resolveScreenshotPath,
} from './hand-host.js';
import {compileLocator, splitFrameHops} from './locator-compiler.js';
import {
	inputBackendFor,
	startXvfb,
	type InputBackend,
	type OwnedDisplay,
} from './os-input.js';
import {
	resolveProfileLocation,
	resolveScreenshotsDir,
	type ProfileLocationOptions,
} from './profile-location.js';
import {captureTail, envArgs, REAL_CHROME_ARGS_ENV} from './real-chrome.js';
import {
	liveSingletonHolder,
	resolveSetupProfileExecutable,
} from './setup-profile.js';
import {
	validateCookieFilter,
	validateSnapshotOptions,
	type ActionOptions,
	type ClickResult,
	type Cookie,
	type CookieFilter,
	type LocatorString,
	type MouseInput,
	type OpenTarget,
	type QueryOptions,
	type QueryRow,
	type Screenshot,
	type ScreenshotOptions,
	type ScrollTarget,
	type SelectChoice,
	type Session,
	type Snapshot,
	type SnapshotOptions,
	type Transport,
	type WaitCondition,
	type WebHandsPage,
} from './seam.js';

/**
 * The EXTENSION transport (ADR-0018): drive a plain browser with NO CDP at all.
 *
 * The browser is started as an ordinary process, the way `setup-profile` starts
 * it (no `--remote-debugging-*`, no `--enable-automation`, no Playwright default
 * args), so `navigator.webdriver` stays `false`. A small MV3 extension loaded into
 * it does the in-page work through Playwright's own selector engine, and every
 * pointer and keyboard action is TRUSTED OS-level input sent by this controller
 * (`os-input.ts`), on a private Xvfb unless `headed`.
 *
 * The verb surface is the seam's, unchanged (ADR-0003). What this transport cannot
 * do yet REFUSES with {@link UnsupportedByTransportError}; nothing degrades
 * silently. It offers no hands: a hand receives a live Playwright page, and there
 * is none here.
 */
export interface ExtensionTransportOptions {
	/** Drive the system Chrome (`--real-chrome`) instead of the pinned build. */
	readonly realChrome?: boolean;
	/** Explicit browser executable (bypasses resolution; tests, unusual installs). */
	readonly executablePath?: string;
	/** Env for the browser, Xvfb, xdotool and executable discovery. */
	readonly env?: NodeJS.ProcessEnv;
	/**
	 * How long to wait for the extension to connect after the browser starts.
	 * Default 20s: a warm real profile can take a while to start its workers.
	 */
	readonly connectTimeoutMs?: number;
	/** Window (and private display) size. Default 1920x1080. */
	readonly windowSize?: {readonly width: number; readonly height: number};
}

const TRANSPORT = 'extension';

export class ExtensionTransport implements Transport {
	readonly #location: ProfileLocationOptions;
	readonly #options: ExtensionTransportOptions;

	constructor(
		location: ProfileLocationOptions = {},
		options: ExtensionTransportOptions = {},
	) {
		this.#location = location;
		this.#options = options;
	}

	/** The stable extension directory this transport writes and loads. */
	extensionDir(): string {
		return resolveExtensionDir(this.#location);
	}

	async open(target: OpenTarget): Promise<Session> {
		if (target.mode !== 'launch') {
			throw new UnsupportedByTransportError(
				'attach',
				TRANSPORT,
				'this transport starts its own plain browser so that no debugging ' +
					'port exists; attaching means a debugging port by definition',
			);
		}
		const env = this.#options.env ?? this.#location.env ?? process.env;
		const loc = resolveProfileLocation(target.profile, this.#location);
		if (!(await isDirectory(loc.profileDir))) {
			throw new MissingProfileError(loc.profile, loc.profileDir);
		}
		const executablePath = await resolveSetupProfileExecutable({
			...(this.#options.executablePath !== undefined
				? {executablePath: this.#options.executablePath}
				: {}),
			...(this.#options.realChrome === true ? {realChrome: true} : {}),
			env,
		});
		const holder = await liveSingletonHolder(loc.profileDir);
		if (holder !== undefined) {
			throw new RealChromeStartError(
				executablePath,
				`a browser (pid ${String(holder)}) is already running against ${loc.profileDir}`,
			);
		}

		const size = this.#options.windowSize ?? {width: 1920, height: 1080};
		const cleanups: Array<() => Promise<void>> = [];
		const unwind = async () => {
			for (const fn of cleanups.reverse()) {
				try {
					await fn();
				} catch {
					// Best-effort teardown; the original error is what matters.
				}
			}
		};

		try {
			// The display first, then the input backend on it: both fail fast (a
			// missing Xvfb/xdotool is an install problem) BEFORE any browser starts.
			let display: string | undefined;
			if (target.headed === true) {
				display = env.DISPLAY;
			} else {
				const owned: OwnedDisplay = await startXvfb({env, ...size});
				cleanups.push(() => owned.close());
				display = owned.display;
			}
			const input = await inputBackendFor(display, env);

			const token = mintBridgeToken();
			const bridge = await startExtensionBridge({
				extensionId: EXTENSION_ID,
				token,
			});
			cleanups.push(() => bridge.close());
			const extensionDir = this.extensionDir();
			await writeExtension(extensionDir, {port: bridge.port, token});
			// On teardown (after the browser is gone: cleanups run in reverse), leave an
			// INERT config, so a later plain start of this profile does not keep
			// dialling a port that is no longer ours.
			cleanups.push(() => writeExtensionConfig(extensionDir));

			const args = buildExtensionBrowserArgs({
				userDataDir: loc.profileDir,
				extensionDir,
				size,
				env,
				startUrl: bridge.startUrl,
			});
			const child: ChildProcess = spawn(executablePath, args, {
				env: {...env, ...(display !== undefined ? {DISPLAY: display} : {})},
				stdio: ['ignore', 'ignore', 'pipe'],
				detached: false,
			});
			const stderr = captureTail(child, 2_000);
			let exited = false;
			const exitedPromise = new Promise<void>((resolve) => {
				child.once('exit', () => {
					exited = true;
					resolve();
				});
				child.once('error', () => {
					exited = true;
					resolve();
				});
			});
			cleanups.push(() => terminate(child, exitedPromise));

			const connectTimeoutMs = this.#options.connectTimeoutMs ?? 20_000;
			try {
				await Promise.race([
					bridge.waitForConnection(connectTimeoutMs),
					exitedPromise.then(async () => {
						throw new RealChromeStartError(
							executablePath,
							'it exited before the extension connected',
							{stderr: await stderr.read()},
						);
					}),
				]);
			} catch (cause) {
				if (cause instanceof BridgeDisconnectedError) {
					throw new ExtensionNotConnectedError(
						`${executablePath} started but the extension did not connect within ${connectTimeoutMs}ms`,
						extensionDir,
						{cause},
					);
				}
				throw cause;
			}
			const init = await bridge.call<{tabId: number; windowId: number}>('init');

			const page = new ExtensionPage({
				bridge,
				input,
				tabId: init.tabId,
				windowId: init.windowId,
				screenshotsDir: resolveScreenshotsDir(this.#location),
			});

			let closed = false;
			let resolveClosed!: () => void;
			const closedPromise = new Promise<void>((r) => {
				resolveClosed = r;
			});
			const close = async () => {
				if (closed) return;
				closed = true;
				await unwind();
				resolveClosed();
			};
			// The human (or a crash) closing the browser ends the session too.
			void exitedPromise.then(() => {
				void close();
			});
			return {
				page,
				close,
				waitForClose: () =>
					closed || exited ? Promise.resolve() : closedPromise,
			};
		} catch (cause) {
			await unwind();
			throw cause;
		}
	}
}

/**
 * The browser argv, and deliberately nothing more. ABSENT on purpose (and asserted
 * by a test): `--remote-debugging-port`, `--remote-debugging-pipe`,
 * `--enable-automation`, `--headless`, and every Playwright default arg.
 */
export function buildExtensionBrowserArgs(options: {
	readonly userDataDir: string;
	readonly extensionDir: string;
	readonly size: {readonly width: number; readonly height: number};
	readonly env?: NodeJS.ProcessEnv;
	/** The first page (the bridge's inert wake-up page). Default `about:blank`. */
	readonly startUrl?: string;
}): string[] {
	// The operator's extra args are honoured (a container may need --no-sandbox),
	// but never one that would bring back what this transport exists to remove.
	const extra = envArgs(options.env ?? process.env);
	const forbidden = extra.filter((arg) =>
		/^--(remote-debugging-|enable-automation|headless)/.test(arg),
	);
	if (forbidden.length > 0) {
		throw new UnsupportedByTransportError(
			forbidden.join(' '),
			TRANSPORT,
			`${REAL_CHROME_ARGS_ENV} may not add a debugging, automation or headless flag here`,
		);
	}
	return [
		`--user-data-dir=${options.userDataDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		// Honoured by Chromium and Chrome for Testing; IGNORED by branded Chrome 137+,
		// where the extension must have been loaded unpacked once (ADR-0018).
		`--load-extension=${options.extensionDir}`,
		'--window-position=0,0',
		`--window-size=${options.size.width},${options.size.height}`,
		...extra,
		options.startUrl ?? 'about:blank',
	];
}

async function terminate(
	child: ChildProcess,
	exited: Promise<void>,
): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	try {
		child.kill('SIGTERM');
	} catch {
		return;
	}
	const timer = setTimeout(() => {
		try {
			child.kill('SIGKILL');
		} catch {
			// gone
		}
	}, 5_000);
	await exited;
	clearTimeout(timer);
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where an element lives: its frame, that frame's offset in the top viewport, and the in-frame selector. */
interface FrameTarget {
	readonly frameId: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly selector: string;
}

interface ActionTarget {
	readonly status: 'ok' | 'retry' | 'error';
	readonly reason?: string;
	readonly message?: string;
	readonly point?: {x: number; y: number};
}

interface MoveRecord {
	readonly seq: number;
	readonly clientX?: number;
	readonly clientY?: number;
	readonly screenX?: number;
	readonly screenY?: number;
}

interface Geometry {
	readonly screenX: number;
	readonly screenY: number;
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly innerWidth: number;
	readonly innerHeight: number;
	readonly dpr: number;
	readonly move: MoveRecord;
}

/** Screen DEVICE pixels of the top viewport's (0,0), and the CSS-to-device scale. */
interface Calibration {
	readonly key: string;
	originX: number;
	originY: number;
	readonly scale: number;
}

/** Default actionability budget. No silent untrusted fallback on this transport. */
const DEFAULT_ACTION_TIMEOUT_MS = 10_000;

/** The {@link WebHandsPage} of the extension transport. */
class ExtensionPage implements WebHandsPage {
	readonly #bridge: ExtensionBridge;
	readonly #input: InputBackend;
	readonly #tabId: number;
	readonly #windowId: number;
	readonly #screenshotsDir: string;
	#calibration: Calibration | undefined;
	#lastScreen: {x: number; y: number} | undefined;

	constructor(deps: {
		bridge: ExtensionBridge;
		input: InputBackend;
		tabId: number;
		windowId: number;
		screenshotsDir: string;
	}) {
		this.#bridge = deps.bridge;
		this.#input = deps.input;
		this.#tabId = deps.tabId;
		this.#windowId = deps.windowId;
		this.#screenshotsDir = deps.screenshotsDir;
	}

	// --- plumbing ------------------------------------------------------------

	#frame<T>(
		frameId: number,
		msg: Record<string, unknown>,
		timeoutMs = 10_000,
	): Promise<T> {
		return this.#bridge.call<T>(
			'frame',
			{tabId: this.#tabId, frameId, msg, timeoutMs},
			{timeoutMs: timeoutMs + 5_000},
		);
	}

	/** Walk the frame hops of a selector to the frame holding its last part. */
	async #resolveFrames(selector: string, scroll = false): Promise<FrameTarget> {
		const parts = splitFrameHops(selector);
		let frameId = 0;
		let offsetX = 0;
		let offsetY = 0;
		for (const part of parts.slice(0, -1)) {
			const hop = await this.#bridge.call<{
				frameId: number;
				offsetX: number;
				offsetY: number;
			}>(
				'probeFrame',
				{tabId: this.#tabId, frameId, selector: part, scroll, timeoutMs: 5_000},
				{timeoutMs: 15_000},
			);
			frameId = hop.frameId;
			offsetX += hop.offsetX;
			offsetY += hop.offsetY;
		}
		return {frameId, offsetX, offsetY, selector: parts[parts.length - 1]!};
	}

	/** Poll until `attempt` yields a value or the budget runs out, then fail with the last reason. */
	async #until<T>(
		what: string,
		timeoutMs: number,
		attempt: () => Promise<{value?: T; reason?: string}>,
	): Promise<T> {
		const deadline = Date.now() + timeoutMs;
		let reason = 'it never became ready';
		for (;;) {
			let result: {value?: T; reason?: string};
			try {
				result = await attempt();
			} catch (cause) {
				// A frame that is mid-navigation, or not yet present, is retried.
				if (Date.now() >= deadline) throw cause;
				result = {
					reason: cause instanceof Error ? cause.message : String(cause),
				};
			}
			if (result.value !== undefined) return result.value;
			if (result.reason !== undefined) reason = result.reason;
			if (Date.now() >= deadline) {
				throw new Error(`${what}: timed out after ${timeoutMs}ms (${reason})`);
			}
			await sleep(100);
		}
	}

	/** Resolve an actionable point (frame-local CSS px) for a selector. */
	async #actionable(
		verb: string,
		selector: string,
		state: 'enabled' | 'editable' | 'visible',
		timeoutMs: number,
	): Promise<{target: FrameTarget; point: {x: number; y: number}}> {
		return this.#until(`${verb} ${selector}`, timeoutMs, async () => {
			const target = await this.#resolveFrames(selector, true);
			const r = await this.#frame<ActionTarget>(target.frameId, {
				op: 'actionTarget',
				selector: target.selector,
				state,
				strict: true,
			});
			if (r.status === 'error') throw new Error(`${verb}: ${r.message}`);
			if (r.status === 'ok' && r.point !== undefined) {
				return {value: {target, point: r.point}};
			}
			return {reason: r.reason};
		});
	}

	/** Measure where the top viewport sits on the screen, from a TRUSTED mousemove. */
	async #calibrate(): Promise<Calibration> {
		const g = await this.#frame<Geometry>(0, {op: 'geometry'});
		const key = [
			g.screenX,
			g.screenY,
			g.outerWidth,
			g.outerHeight,
			g.innerWidth,
			g.innerHeight,
			g.dpr,
		].join(',');
		if (this.#calibration?.key === key) return this.#calibration;
		const scale = g.dpr;
		// First estimate: the viewport sits at the bottom of the window, inside
		// equal side borders. Toolbars and info bars vary, so it is only a start.
		const border = Math.max(0, (g.outerWidth - g.innerWidth) / 2);
		const estimate: Calibration = {
			key,
			scale,
			originX: (g.screenX + border) * scale,
			originY: (g.screenY + g.outerHeight - g.innerHeight - border) * scale,
		};
		const point = await this.#frame<{x: number; y: number}>(0, {
			op: 'calibrationPoint',
		});
		for (const nudge of [0, 3]) {
			const before = await this.#frame<MoveRecord>(0, {op: 'lastMove'});
			const sx = estimate.originX + (point.x + nudge) * scale;
			const sy = estimate.originY + (point.y + nudge) * scale;
			await this.#input.move(sx, sy);
			this.#lastScreen = {x: Math.round(sx), y: Math.round(sy)};
			const after = await this.#awaitMove(0, before.seq);
			if (after?.screenX !== undefined && after.clientX !== undefined) {
				// screenX - clientX is exactly the viewport origin in screen DIPs.
				estimate.originX = (after.screenX - after.clientX) * scale;
				estimate.originY = (after.screenY! - after.clientY!) * scale;
				this.#calibration = estimate;
				return estimate;
			}
		}
		// No trusted move reached the top document (something covers the whole
		// viewport); fall back to the estimate, which #pointTo still verifies.
		this.#calibration = estimate;
		return estimate;
	}

	async #awaitMove(
		frameId: number,
		seq: number,
	): Promise<MoveRecord | undefined> {
		const deadline = Date.now() + 750;
		while (Date.now() < deadline) {
			const move = await this.#frame<MoveRecord>(frameId, {op: 'lastMove'});
			if (move.seq > seq) return move;
			await sleep(25);
		}
		return undefined;
	}

	/**
	 * Move the OS pointer onto a frame-local CSS point, and VERIFY it arrived: the
	 * target frame must report a trusted mousemove at (about) that point. One
	 * correction is allowed (from the event's own coordinates); a persistent miss
	 * is an error, never a click somewhere else.
	 */
	async #pointTo(
		target: FrameTarget,
		point: {x: number; y: number},
	): Promise<void> {
		const cal = await this.#calibrate();
		for (let attempt = 0; attempt < 2; attempt++) {
			const sx = Math.round(
				cal.originX + (target.offsetX + point.x) * cal.scale,
			);
			const sy = Math.round(
				cal.originY + (target.offsetY + point.y) * cal.scale,
			);
			if (this.#lastScreen?.x === sx && this.#lastScreen.y === sy) {
				// Already there: no mousemove would fire. Step off and back.
				await this.#input.move(sx + 2, sy + 2);
			}
			const before = await this.#frame<MoveRecord>(target.frameId, {
				op: 'lastMove',
			});
			await this.#input.move(sx, sy);
			this.#lastScreen = {x: sx, y: sy};
			const move = await this.#awaitMove(target.frameId, before.seq);
			if (move === undefined || move.clientX === undefined) {
				throw new Error(
					`the pointer did not reach the target's frame at (${point.x}, ${point.y}); ` +
						`something covers it, or the window moved`,
				);
			}
			const dx = point.x - move.clientX;
			const dy = point.y - move.clientY!;
			if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return;
			cal.originX += dx * cal.scale;
			cal.originY += dy * cal.scale;
		}
		throw new Error(
			`the pointer kept missing the target at (${point.x}, ${point.y}); refusing to click elsewhere`,
		);
	}

	async #selectorFor(
		target: string,
		options: ActionOptions | undefined,
		verb: string,
	) {
		if (options?.byRef !== true) return compileLocator(target);
		const ref = normalizeRefToLocator(target);
		const selector = compileLocator(ref);
		const resolved = await this.#resolveFrames(selector);
		const matched = await this.#frame<number>(resolved.frameId, {
			op: 'count',
			selector: resolved.selector,
		});
		if (matched !== 1) throw new StaleRefError(ref, matched, verb);
		return selector;
	}

	// --- verbs -----------------------------------------------------------------

	async navigate(url: string): Promise<void> {
		await this.#bridge.call(
			'goto',
			{tabId: this.#tabId, url, timeoutMs: 30_000},
			{timeoutMs: 35_000},
		);
		await this.#frame(0, {op: 'ready'}, 15_000);
		this.#calibration = undefined;
	}

	async snapshot(options?: SnapshotOptions): Promise<Snapshot> {
		validateSnapshotOptions(options);
		const tab = await this.#bridge.call<{url: string}>('tab', {
			tabId: this.#tabId,
		});
		const full = options?.full === true;
		const content = await this.#frame<string>(0, {op: 'snapshot', full});
		return {url: tab.url, view: full ? 'full' : 'accessibility', content};
	}

	async click(
		target: LocatorString,
		options?: ActionOptions,
	): Promise<ClickResult> {
		const selector = await this.#selectorFor(target, options, 'click');
		if (options?.dom === true) {
			const t = await this.#resolveFrames(selector);
			await this.#frame(t.frameId, {op: 'dispatchClick', selector: t.selector});
			return {via: 'dispatch'};
		}
		const {target: t, point} = await this.#actionable(
			'click',
			selector,
			'enabled',
			options?.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
		);
		await this.#pointTo(t, point);
		await this.#input.click('left');
		return {via: 'click'};
	}

	async type(
		target: LocatorString,
		text: string,
		options?: ActionOptions,
	): Promise<void> {
		const value = substituteEnvPlaceholders(text);
		const selector = await this.#selectorFor(target, options, 'type');
		if (options?.dom === true) {
			const t = await this.#resolveFrames(selector);
			await this.#frame(t.frameId, {
				op: 'domType',
				selector: t.selector,
				text: value,
			});
			return;
		}
		const {target: t, point} = await this.#actionable(
			'type',
			selector,
			'editable',
			options?.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
		);
		await this.#pointTo(t, point);
		await this.#input.click('left');
		await this.#until('type: focus', 2_000, async () =>
			(await this.#frame<boolean>(t.frameId, {
				op: 'isFocused',
				selector: t.selector,
			}))
				? {value: true}
				: {reason: 'the field did not take focus after the click'},
		);
		// `fill` semantics (what the Playwright transports do): replace the content.
		await this.#input.key('Control+a');
		if (value === '') {
			await this.#input.key('Backspace');
		} else {
			await this.#input.type(value);
		}
	}

	async press(
		key: string,
		target?: LocatorString,
		options?: ActionOptions,
	): Promise<void> {
		if (target !== undefined) {
			if (options?.dom === true) {
				throw new UnsupportedByTransportError('press --dom', TRANSPORT);
			}
			const selector = compileLocator(target);
			const {target: t, point} = await this.#actionable(
				'press',
				selector,
				'enabled',
				options?.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
			);
			await this.#pointTo(t, point);
			await this.#input.click('left');
		}
		await this.#input.key(key);
	}

	async mouse(input: MouseInput): Promise<void> {
		const cal = await this.#calibrate();
		const sx = Math.round(cal.originX + input.x * cal.scale);
		const sy = Math.round(cal.originY + input.y * cal.scale);
		await this.#input.move(sx, sy);
		this.#lastScreen = {x: sx, y: sy};
		const button = input.button ?? 'left';
		switch (input.action) {
			case 'move':
				return;
			case 'click':
				return this.#input.click(button);
			case 'down':
				return this.#input.down(button);
			case 'up':
				return this.#input.up(button);
		}
	}

	async wait(condition: WaitCondition): Promise<void> {
		switch (condition.kind) {
			case 'timeout':
				await sleep(condition.ms);
				return;
			case 'navigation':
				await this.#bridge.call(
					'waitNavigation',
					{tabId: this.#tabId, timeoutMs: 30_000},
					{timeoutMs: 35_000},
				);
				await this.#frame(0, {op: 'ready'}, 15_000);
				this.#calibration = undefined;
				return;
			case 'locator': {
				// Playwright's `waitFor()` default: attached AND visible. A pure READ:
				// no scrolling, no stability or hit-test check (an element under an
				// overlay is still "visible"), unlike the actionability check.
				const selector = compileLocator(condition.target);
				const outcome = await this.#until(
					`wait ${selector}`,
					30_000,
					async () => {
						const target = await this.#resolveFrames(selector);
						const state = await this.#frame<{count: number; visible: boolean}>(
							target.frameId,
							{op: 'isVisibleNow', selector: target.selector},
						);
						if (state.count > 1) return {value: state.count};
						return state.visible
							? {value: 1}
							: {
									reason:
										state.count === 0 ? 'no match yet' : 'not visible yet',
								};
					},
				);
				if (outcome > 1) {
					// Strict, like Playwright's waitFor(): never wait on a guess.
					throw new Error(
						`wait: strict mode violation: ${selector} resolved to ${outcome} elements`,
					);
				}
				return;
			}
		}
	}

	async cookies(): Promise<readonly Cookie[]> {
		const raw = await this.#bridge.call<ChromeCookie[]>('cookies.getAll');
		return raw.map(fromChromeCookie);
	}

	async setCookies(cookies: readonly Cookie[]): Promise<void> {
		await this.#bridge.call('cookies.set', {
			cookies: cookies.map(toChromeCookieSet),
		});
	}

	async clearCookies(filter: CookieFilter): Promise<number> {
		validateCookieFilter(filter);
		const raw = await this.#bridge.call<ChromeCookie[]>('cookies.getAll');
		const doomed = raw.filter(
			(c) =>
				filter.all === true || matchesCookieFilter(fromChromeCookie(c), filter),
		);
		await this.#bridge.call('cookies.remove', {
			cookies: doomed.map((c) => ({
				url: cookieUrl(c.domain, c.path, c.secure),
				name: c.name,
				storeId: c.storeId,
			})),
		});
		return doomed.length;
	}

	async query(
		target: LocatorString,
		options?: QueryOptions,
	): Promise<QueryRow[]> {
		if (options?.refs === true) {
			throw new UnsupportedByTransportError('query --with-refs', TRANSPORT);
		}
		const t = await this.#resolveFrames(compileLocator(target));
		const rows = await this.#frame<QueryRow[]>(t.frameId, {
			op: 'query',
			selector: t.selector,
			...(options?.attrs !== undefined ? {attrs: options.attrs} : {}),
			...(options?.props !== undefined ? {props: options.props} : {}),
			...(options?.pw !== undefined ? {pw: options.pw} : {}),
			...(options?.limit !== undefined ? {limit: options.limit} : {}),
		});
		// Boxes are reported in the TOP viewport's frame, like Playwright's boundingBox.
		return rows.map((row) =>
			row.pw?.bbox
				? {
						...row,
						pw: {
							...row.pw,
							bbox: {
								...row.pw.bbox,
								x: row.pw.bbox.x + t.offsetX,
								y: row.pw.bbox.y + t.offsetY,
							},
						},
					}
				: row,
		);
	}

	async count(target: LocatorString): Promise<number> {
		const t = await this.#resolveFrames(compileLocator(target));
		return this.#frame<number>(t.frameId, {op: 'count', selector: t.selector});
	}

	async exists(target: LocatorString): Promise<boolean> {
		return (await this.count(target)) > 0;
	}

	async isVisible(target: LocatorString): Promise<boolean> {
		const rows = await this.query(target, {pw: ['visible'], limit: 1});
		return rows[0]?.pw?.visible === true;
	}

	async getAttribute(
		target: LocatorString,
		name: string,
	): Promise<string | null> {
		const rows = await this.query(target, {attrs: [name], limit: 1});
		return rows[0]?.attrs?.[name] ?? null;
	}

	async screenshot(options?: ScreenshotOptions): Promise<Screenshot> {
		const scope = options?.scope ?? 'viewport';
		if (scope !== 'viewport' || options?.locator !== undefined) {
			throw new UnsupportedByTransportError(
				`screenshot --scope ${scope}`,
				TRANSPORT,
				'only the viewport scope (chrome.tabs.captureVisibleTab) is built',
			);
		}
		const path = await resolveScreenshotPath(
			this.#screenshotsDir,
			options?.out,
		);
		await mkdir(this.#screenshotsDir, {recursive: true});
		const dataUrl = await this.#bridge.call<string>('capture', {
			windowId: this.#windowId,
		});
		const buffer = Buffer.from(
			dataUrl.slice(dataUrl.indexOf(',') + 1),
			'base64',
		);
		await writeFile(path, buffer);
		const {width, height} = pngDimensions(buffer, path);
		return {path, width, height};
	}

	// --- not on this transport (yet) -------------------------------------------

	eval(): Promise<unknown> {
		return Promise.reject(
			new UnsupportedByTransportError(
				'eval',
				TRANSPORT,
				'page-world evaluation is subject to the page CSP or a user toggle here and is not built (ADR-0018)',
			),
		);
	}

	script(): Promise<unknown> {
		return Promise.reject(
			new UnsupportedByTransportError(
				'script',
				TRANSPORT,
				'there is no Playwright page to hand a script',
			),
		);
	}

	hover(_target: LocatorString, _options?: ActionOptions): Promise<void> {
		return Promise.reject(new UnsupportedByTransportError('hover', TRANSPORT));
	}

	select(
		_target: LocatorString,
		_choice: SelectChoice,
		_options?: ActionOptions,
	): Promise<void> {
		return Promise.reject(new UnsupportedByTransportError('select', TRANSPORT));
	}

	scroll(_target: ScrollTarget): Promise<void> {
		return Promise.reject(new UnsupportedByTransportError('scroll', TRANSPORT));
	}

	drag(
		_source: LocatorString,
		_target: LocatorString,
		_options?: ActionOptions,
	): Promise<void> {
		return Promise.reject(new UnsupportedByTransportError('drag', TRANSPORT));
	}
}

/** A cookie as `chrome.cookies` reports it. */
interface ChromeCookie {
	readonly name: string;
	readonly value: string;
	readonly domain: string;
	readonly hostOnly: boolean;
	readonly path: string;
	readonly secure: boolean;
	readonly httpOnly: boolean;
	readonly sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified';
	readonly session: boolean;
	readonly expirationDate?: number;
	readonly storeId: string;
}

const SAME_SITE_FROM: Readonly<Record<string, Cookie['sameSite']>> = {
	no_restriction: 'None',
	lax: 'Lax',
	strict: 'Strict',
};
const SAME_SITE_TO: Readonly<Record<string, ChromeCookie['sameSite']>> = {
	None: 'no_restriction',
	Lax: 'lax',
	Strict: 'strict',
};

/** Map to the seam shape, the way Playwright reports cookies (session = `expires: -1`). */
function fromChromeCookie(c: ChromeCookie): Cookie {
	return {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires:
			c.session || c.expirationDate === undefined ? -1 : c.expirationDate,
		httpOnly: c.httpOnly,
		secure: c.secure,
		...(SAME_SITE_FROM[c.sameSite] !== undefined
			? {sameSite: SAME_SITE_FROM[c.sameSite]}
			: {sameSite: 'Lax' as const}),
	};
}

function cookieUrl(
	domain: string | undefined,
	path: string | undefined,
	secure?: boolean,
) {
	const host = (domain ?? '').replace(/^\./, '');
	return `http${secure === true ? 's' : ''}://${host}${path ?? '/'}`;
}

function toChromeCookieSet(c: Cookie): Record<string, unknown> {
	if (c.domain === undefined || c.domain === '') {
		throw new Error(
			`cookies import: cookie ${JSON.stringify(c.name)} has no domain`,
		);
	}
	return {
		url: cookieUrl(c.domain, c.path, c.secure),
		name: c.name,
		value: c.value,
		// A leading dot means a domain cookie; without one, `chrome.cookies.set`
		// makes a host-only cookie when `domain` is omitted.
		...(c.domain.startsWith('.') ? {domain: c.domain} : {}),
		path: c.path ?? '/',
		...(c.secure !== undefined ? {secure: c.secure} : {}),
		...(c.httpOnly !== undefined ? {httpOnly: c.httpOnly} : {}),
		...(c.sameSite !== undefined ? {sameSite: SAME_SITE_TO[c.sameSite]} : {}),
		...(c.expires !== undefined && c.expires > 0
			? {expirationDate: c.expires}
			: {}),
	};
}
