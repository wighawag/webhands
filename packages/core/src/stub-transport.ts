import type {
	Cookie,
	OpenTarget,
	Page,
	Session,
	Snapshot,
	SnapshotOptions,
	Transport,
	WaitCondition,
} from './seam.js';

/**
 * A record of one verb call against the stub, for assertions in seam tests.
 */
export interface StubCall {
	readonly verb: keyof Page;
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

		const page: Page = {
			async navigate(to: string): Promise<void> {
				ensureOpen();
				calls.push({verb: 'navigate', args: [to]});
			},
			async snapshot(options?: SnapshotOptions): Promise<Snapshot> {
				ensureOpen();
				calls.push({verb: 'snapshot', args: [options]});
				return {
					url,
					view: options?.full === true ? 'full' : 'accessibility',
					content: '',
				};
			},
			async click(t): Promise<void> {
				ensureOpen();
				calls.push({verb: 'click', args: [t]});
			},
			async type(t, text): Promise<void> {
				ensureOpen();
				calls.push({verb: 'type', args: [t, text]});
			},
			async eval(expression: string): Promise<unknown> {
				ensureOpen();
				calls.push({verb: 'eval', args: [expression]});
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
