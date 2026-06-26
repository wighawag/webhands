/**
 * A test-only third-party hand authored against the PUBLIC `Hand` contract,
 * used to prove Phase-2 Model B: a hand-contributed verb surfaced to the agent
 * over the session RPC. Plain ESM, no build step, so the loader can `import()`
 * it exactly as a real pinned entry would.
 *
 * It contributes two verbs:
 *
 * - `readMarker(suffix)` — runs against the live page and returns a SERIALIZABLE
 *   value (a plain object built from page state plus the caller's argument). It
 *   proves a hand verb's result crosses the wire by value and that arguments
 *   reach the served hand. The page state it reads (`#marker`) comes from the
 *   `eval.html` fixture.
 * - `boom()` — THROWS, to prove an in-hand throw REJECTS faithfully on the
 *   client with the page-side message, exactly as the `eval` RPC path does.
 *
 * Neither verb is on the seam `Page` type; the test reaches them through the
 * dynamic hand-verb RPC path, which is precisely the Phase-2 reality.
 *
 * @type {import('../../../src/index.js').Hand}
 */
export default function rpcHand({pwPage, ensureOpen}) {
	return {
		verbs: {
			async readMarker(suffix) {
				ensureOpen();
				const marker = await pwPage.evaluate(
					() => document.getElementById('marker')?.textContent ?? null,
				);
				return {marker, suffix, ok: true};
			},
			async boom() {
				ensureOpen();
				throw new Error('hand verb exploded');
			},
		},
	};
}
