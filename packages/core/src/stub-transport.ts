import type {
	ActionOptions,
	Cookie,
	EvalOptions,
	MouseInput,
	OpenTarget,
	WebHandsPage,
	QueryOptions,
	QueryRow,
	Screenshot,
	ScreenshotOptions,
	ScriptOptions,
	ScrollTarget,
	SelectChoice,
	Session,
	Snapshot,
	SnapshotOptions,
	Transport,
	WaitCondition,
} from './seam.js';
import {validateSnapshotOptions} from './seam.js';

/**
 * A record of one verb call against the stub, for assertions in seam tests.
 */
export interface StubCall {
	readonly verb: keyof WebHandsPage;
	readonly args: readonly unknown[];
}

/**
 * An in-process, no-op {@link Transport} used to exercise the SEAM SHAPE
 * without a real browser. It is NOT the Playwright transport (that lands in a
 * later task) and implements no real verb behaviour: every verb is a no-op
 * that records the call so a unit test can assert an `open` -> `Session` ->
 * verb round-trip through the `core` `Driver` interface.
 *
 * Session lifetime: a session lives from {@link StubTransport.open} until its
 * {@link Session.close} is called. After `close()` the page rejects further
 * verb calls, mirroring the real "the browser is gone" contract so the seam's
 * lifetime is testable.
 */
export class StubTransport implements Transport {
	/** Every verb call across every session this transport opened, in order. */
	readonly calls: StubCall[] = [];

	async open(target: OpenTarget): Promise<Session> {
		const calls = this.calls;
		let closed = false;

		let resolveClosed!: () => void;
		const closedSignal = new Promise<void>((resolve) => {
			resolveClosed = resolve;
		});

		const ensureOpen = () => {
			if (closed) {
				throw new Error('session is closed');
			}
		};

		const url =
			target.mode === 'launch'
				? `stub://launch/${target.profile}`
				: `stub://attach/${target.endpoint}`;

		const page: WebHandsPage = {
			async navigate(to: string): Promise<void> {
				ensureOpen();
				calls.push({verb: 'navigate', args: [to]});
			},
			async snapshot(options?: SnapshotOptions): Promise<Snapshot> {
				ensureOpen();
				validateSnapshotOptions(options);
				calls.push({verb: 'snapshot', args: [options]});
				return {
					url,
					view: options?.full === true ? 'full' : 'accessibility',
					content: '',
				};
			},
			async click(t, options?: ActionOptions): Promise<void> {
				ensureOpen();
				// Record the ActionOptions only when given, so a plain-locator click
				// stays `[t]` (the existing seam assertions) and a `{byRef}` click
				// records `[t, {byRef: true}]`.
				calls.push({
					verb: 'click',
					args: options !== undefined ? [t, options] : [t],
				});
			},
			async type(t, text, options?: ActionOptions): Promise<void> {
				ensureOpen();
				calls.push({
					verb: 'type',
					args: options !== undefined ? [t, text, options] : [t, text],
				});
			},
			async eval(expression: string, options?: EvalOptions): Promise<unknown> {
				ensureOpen();
				calls.push({verb: 'eval', args: [expression, options]});
				return undefined;
			},
			async script(source: string, options?: ScriptOptions): Promise<unknown> {
				ensureOpen();
				// Record the options only when given, so a bare script stays `[source]`
				// (mirrors the optional-options recording the other verbs use).
				calls.push({
					verb: 'script',
					args: options !== undefined ? [source, options] : [source],
				});
				return undefined;
			},
			async wait(condition: WaitCondition): Promise<void> {
				ensureOpen();
				calls.push({verb: 'wait', args: [condition]});
			},
			async cookies(): Promise<readonly Cookie[]> {
				ensureOpen();
				calls.push({verb: 'cookies', args: []});
				return [];
			},
			async setCookies(cookies): Promise<void> {
				ensureOpen();
				calls.push({verb: 'setCookies', args: [cookies]});
			},
			async query(t, options?: QueryOptions): Promise<QueryRow[]> {
				ensureOpen();
				calls.push({verb: 'query', args: [t, options]});
				return [];
			},
			async count(t): Promise<number> {
				ensureOpen();
				calls.push({verb: 'count', args: [t]});
				return 0;
			},
			async exists(t): Promise<boolean> {
				ensureOpen();
				calls.push({verb: 'exists', args: [t]});
				return false;
			},
			async isVisible(t): Promise<boolean> {
				ensureOpen();
				calls.push({verb: 'isVisible', args: [t]});
				return false;
			},
			async getAttribute(t, name): Promise<string | null> {
				ensureOpen();
				calls.push({verb: 'getAttribute', args: [t, name]});
				return null;
			},
			async press(key: string, t): Promise<void> {
				ensureOpen();
				calls.push({verb: 'press', args: [key, t]});
			},
			async hover(t): Promise<void> {
				ensureOpen();
				calls.push({verb: 'hover', args: [t]});
			},
			async select(t, choice: SelectChoice): Promise<void> {
				ensureOpen();
				calls.push({verb: 'select', args: [t, choice]});
			},
			async scroll(t: ScrollTarget): Promise<void> {
				ensureOpen();
				calls.push({verb: 'scroll', args: [t]});
			},
			async drag(source, t): Promise<void> {
				ensureOpen();
				calls.push({verb: 'drag', args: [source, t]});
			},
			async mouse(input: MouseInput): Promise<void> {
				ensureOpen();
				calls.push({verb: 'mouse', args: [input]});
			},
			async screenshot(options?: ScreenshotOptions): Promise<Screenshot> {
				ensureOpen();
				calls.push({verb: 'screenshot', args: [options]});
				// A deterministic stand-in path/dimensions so a wiring test can assert
				// the verb round-trip + the attachment-capable `path` field WITHOUT a
				// real browser (no PNG is written; the stub implements no behaviour).
				return {path: 'stub://screenshot.png', width: 0, height: 0};
			},
		};

		return {
			page,
			async close(): Promise<void> {
				if (closed) {
					return;
				}
				closed = true;
				resolveClosed();
			},
			waitForClose(): Promise<void> {
				return closedSignal;
			},
		};
	}
}
