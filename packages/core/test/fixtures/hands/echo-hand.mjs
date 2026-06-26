/**
 * A test-only third-party hand authored against the PUBLIC `Hand` contract
 * (`@webhands/core`'s exported `Hand`/`HandContext`). It is plain ESM with no
 * build step so it can be `import()`ed by the loader exactly as a real pinned
 * entry would be. It contributes a NEW verb (`echoTitle`) implemented against
 * the live page it receives, proving a hand loaded through the public API plugs
 * into the same host the built-ins use.
 *
 * The verb is added to the page object dynamically; it is not part of the seam
 * `Page` type, so the end-to-end test reaches it via a cast. That is exactly the
 * Phase-2 reality: a third-party hand contributes verbs the core seam does not
 * know about ahead of time.
 *
 * @type {import('../../../src/index.js').Hand}
 */
export default function echoHand({pwPage, ensureOpen}) {
	return {
		verbs: {
			async echoTitle() {
				ensureOpen();
				return pwPage.title();
			},
		},
	};
}
