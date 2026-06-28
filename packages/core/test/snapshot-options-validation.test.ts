import {describe, expect, it, vi} from 'vitest';
import {
	applySessionRpc,
	makeRpcPage,
	validateSnapshotOptions,
	type SessionRpcRequest,
	type Snapshot,
	type WebHandsPage,
} from '../src/index.js';

/**
 * The `snapshot` option is read from a SINGLE source of truth
 * ({@link validateSnapshotOptions}) applied at BOTH verb entry points: the
 * in-process host and the RPC server dispatch. This fixes a silent footgun: an
 * unknown/misshapen option (notably `{view: 'full'}`, a natural mistake because
 * the RESULT carries a `view` field) used to be silently dropped, returning the
 * WRONG view with no error. It must now REJECT loudly, and faithfully across the
 * RPC seam exactly as other verb throws do.
 *
 * These are fast, browser-free unit tests over the validator, the RPC server
 * dispatch (`applySessionRpc`), and the client proxy (`makeRpcPage`); the real
 * browser in-process path is covered in `snapshot-verb.test.ts`.
 */

/** A minimal fake page that records the `snapshot` options it was called with. */
function recordingPage(): {
	readonly page: WebHandsPage;
	readonly calls: Array<unknown>;
} {
	const calls: Array<unknown> = [];
	const page = {
		async navigate() {},
		async snapshot(options?: unknown): Promise<Snapshot> {
			calls.push(options);
			const full =
				typeof options === 'object' &&
				options !== null &&
				(options as {full?: unknown}).full === true;
			return {
				url: 'about:blank',
				view: full ? 'full' : 'accessibility',
				content: full ? '<html></html>' : 'a11y',
			};
		},
		async click() {},
		async type() {},
		async eval() {
			return undefined;
		},
		async wait() {},
		async cookies() {
			return [];
		},
		async setCookies() {},
	};
	return {page: page as unknown as WebHandsPage, calls};
}

describe('validateSnapshotOptions (the single source of truth)', () => {
	it('accepts undefined, {}, and {full: boolean}', () => {
		expect(validateSnapshotOptions(undefined)).toBeUndefined();
		expect(validateSnapshotOptions({})).toEqual({});
		expect(validateSnapshotOptions({full: true})).toEqual({full: true});
		expect(validateSnapshotOptions({full: false})).toEqual({full: false});
	});

	it('rejects an unknown key, naming it and hinting the right one', () => {
		expect(() => validateSnapshotOptions({view: 'full'} as never)).toThrow(
			/unknown option "view".*did you mean \{ full: true \}/,
		);
	});

	it('names every unknown key', () => {
		expect(() =>
			validateSnapshotOptions({view: 'full', raw: true} as never),
		).toThrow(/unknown option "view", "raw"/);
	});

	it('rejects a non-boolean full', () => {
		expect(() => validateSnapshotOptions({full: 'yes'} as never)).toThrow(
			/option "full" must be a boolean/,
		);
	});
});

describe('snapshot over the RPC seam (server dispatch)', () => {
	it('forwards a valid snapshot request to the page', async () => {
		const {page, calls} = recordingPage();
		const result = (await applySessionRpc(page, {
			verb: 'snapshot',
			full: true,
		})) as Snapshot;
		expect(result.view).toBe('full');
		expect(calls).toEqual([{full: true}]);
	});

	it('treats a bare snapshot request as the accessibility view (undefined options)', async () => {
		const {page, calls} = recordingPage();
		const result = (await applySessionRpc(page, {
			verb: 'snapshot',
		})) as Snapshot;
		expect(result.view).toBe('accessibility');
		expect(calls).toEqual([undefined]);
	});

	it('REJECTS a malformed request from a raw client faithfully across the seam (regression: {view: "full"})', async () => {
		const {page, calls} = recordingPage();
		// A raw (untyped) client POSTs the misspelled key directly. The server is
		// the load-bearing validator: it must reject rather than silently dropping
		// the key and returning the wrong view.
		await expect(
			applySessionRpc(page, {
				verb: 'snapshot',
				view: 'full',
			} as unknown as SessionRpcRequest),
		).rejects.toThrow(/unknown option "view".*did you mean \{ full: true \}/);
		// The page was never asked for a (wrong) snapshot.
		expect(calls).toEqual([]);
	});

	it('REJECTS a non-boolean full from a raw client', async () => {
		const {page} = recordingPage();
		await expect(
			applySessionRpc(page, {
				verb: 'snapshot',
				full: 'yes',
			} as unknown as SessionRpcRequest),
		).rejects.toThrow(/option "full" must be a boolean/);
	});
});

describe('snapshot over the RPC seam (client proxy)', () => {
	it('fails fast on a typed caller mistake before any round-trip', async () => {
		const send = vi.fn(async () => ({}) as Snapshot);
		const page = makeRpcPage(send as never);
		await expect(page.snapshot({view: 'full'} as never)).rejects.toThrow(
			/unknown option "view"/,
		);
		// Rejected before sending anything over the wire.
		expect(send).not.toHaveBeenCalled();
	});

	it('still forwards a valid option over the wire', async () => {
		const sent: SessionRpcRequest[] = [];
		const send = async (request: SessionRpcRequest): Promise<unknown> => {
			sent.push(request);
			return {url: '', view: 'full', content: ''} satisfies Snapshot;
		};
		const page = makeRpcPage(send);
		await page.snapshot({full: true});
		expect(sent).toEqual([{verb: 'snapshot', full: true}]);
	});
});
