import {errors as pwErrors} from 'playwright';
import {describe, expect, it} from 'vitest';
import {clickLocator, isTimeoutError} from '../src/hand-host.js';

/**
 * The `click` verb's dispatch ESCAPE must engage for a timeout raised by the
 * engine ACTUALLY driving the page, not only for one raised by the `playwright`
 * package (finding `patchright-ships-its-own-timeouterror-class`).
 *
 * The bug: the escape branched on `cause instanceof pwErrors.TimeoutError`, a
 * CLASS-IDENTITY check against the `playwright` package's class. Under
 * `--stealth` the page is driven by **Patchright**, a separate npm package that
 * ships its OWN `TimeoutError` class, so the check was false for every timeout it
 * raised. Verified against the installed packages:
 *
 *   playwright.errors.TimeoutError === patchright.errors.TimeoutError  // false
 *
 * The consequence was silent: under stealth, `click` on a label-hidden radio
 * rethrew a raw timeout instead of dispatching, i.e. the documented escape path
 * simply did not exist in the one mode users reach for when a site fights back.
 *
 * HERMETIC by construction: `clickLocator` resolves its target through the
 * locator EXPRESSION compiler, so a fake `page` whose `locator()` returns a
 * scripted stub exercises the real branch with no browser, no Patchright install
 * (it is an OPTIONAL dependency, legitimately absent) and no flake. The
 * cross-package class inequality above is a property of the packages, not of this
 * code, so reproducing it with a foreign class is the faithful test.
 */
describe('click dispatch fallback is engine-agnostic', () => {
	/**
	 * A stub page whose single locator fails `click` with `clickError` and records
	 * every call, so the test can assert WHICH path ran.
	 */
	function stubPage(clickError: unknown) {
		const calls: string[] = [];
		const target = {
			async click(): Promise<void> {
				calls.push('click');
				throw clickError;
			},
			async dispatchEvent(type: string): Promise<void> {
				calls.push(`dispatch:${type}`);
			},
		};
		return {page: {locator: () => target} as never, calls};
	}

	/** A foreign `TimeoutError` class, exactly Patchright's shape (own class). */
	class ForeignTimeoutError extends Error {
		constructor(message = 'locator.click: Timeout 1000ms exceeded.') {
			super(message);
			this.name = 'TimeoutError';
		}
	}

	it('dispatches on a FOREIGN TimeoutError (the stealth/Patchright case)', async () => {
		const foreign = new ForeignTimeoutError();
		// Guard the premise: this is NOT playwright's class, exactly as Patchright's
		// is not. If this ever became true, the test would stop proving anything.
		expect(foreign instanceof pwErrors.TimeoutError).toBe(false);

		const {page, calls} = stubPage(foreign);
		await clickLocator(page, "p.locator('#hidden-radio')");

		// The escape engaged: the click was attempted, then dispatched.
		expect(calls).toEqual(['click', 'dispatch:click']);
	});

	it('still dispatches on playwright own TimeoutError (unchanged vanilla path)', async () => {
		const {page, calls} = stubPage(
			new pwErrors.TimeoutError('locator.click: Timeout 1000ms exceeded.'),
		);
		await clickLocator(page, "p.locator('#hidden-radio')");
		expect(calls).toEqual(['click', 'dispatch:click']);
	});

	it('the PREDICATE itself accepts a foreign timeout and rejects look-alikes', async () => {
		// Tested directly because the predicate guards TWO branches and only one is
		// reachable from a fixture: `clickLocator`'s escape (covered above) and
		// `resolveSameOriginFrame`'s "no iframe matched" mapping, whose stealth-engine
		// timeout no hermetic test can produce. Half the documented fix was therefore
		// unguarded.
		class ForeignTimeout extends Error {
			constructor() {
				super('Timeout 1000ms exceeded.');
				this.name = 'TimeoutError';
			}
		}
		// Playwright's own class, and a structurally identical foreign one.
		expect(isTimeoutError(new pwErrors.TimeoutError('x'))).toBe(true);
		expect(isTimeoutError(new ForeignTimeout())).toBe(true);

		// Not timeouts: a strict-mode violation, a plain error whose MESSAGE merely
		// mentions a timeout, and non-errors. Matching on the message instead of the
		// name would wrongly swallow the third case.
		expect(isTimeoutError(new Error('strict mode violation'))).toBe(false);
		expect(isTimeoutError(new Error('Timeout 30000ms exceeded.'))).toBe(false);
		expect(isTimeoutError('TimeoutError')).toBe(false);
		expect(isTimeoutError(undefined)).toBe(false);
	});

	it('does NOT dispatch on a non-timeout failure (fail-loud preserved)', async () => {
		// A strict-mode violation (locator matched many) must keep failing loudly:
		// dispatching there would act on an element the caller never identified.
		const strict = new Error('strict mode violation: resolved to 3 elements');
		const {page, calls} = stubPage(strict);

		await expect(clickLocator(page, "p.locator('.row')")).rejects.toThrowError(
			/strict mode violation/,
		);
		expect(calls).toEqual(['click']);
	});
});
