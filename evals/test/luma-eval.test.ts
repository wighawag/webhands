import {describe, expect, it} from 'vitest';
import {buildLumaRegisterTurnstileEval} from '../src/catalogue/luma-register-turnstile.eval.js';
import {assertNoPriming} from '../src/no-priming.js';
import type {VerbClient} from '../src/verb-client.js';

/**
 * OFFLINE checks for the anti-bot Luma eval (ADR-0018). They never open Luma: the
 * live run is the opt-in `run-eval` runner only, with a human-logged-in profile.
 */
const ENV = {
	WEBHANDS_EVAL_LUMA_EVENT: 'https://luma.com/abc123',
	WEBHANDS_EVAL_LUMA_PROFILE: '/tmp/some-profile',
};

describe('luma-register-turnstile eval (offline)', () => {
	it('refuses to build without its live configuration, saying what to set', () => {
		expect(() => buildLumaRegisterTurnstileEval({})).toThrow(
			/WEBHANDS_EVAL_LUMA_EVENT.*WEBHANDS_EVAL_LUMA_PROFILE/s,
		);
		expect(() =>
			buildLumaRegisterTurnstileEval({
				...ENV,
				WEBHANDS_EVAL_LUMA_EVENT: 'https://example.com/x',
			}),
		).toThrow(/luma\.com/);
	});

	it('runs on the extension transport, from a COPY of the given profile', () => {
		const entry = buildLumaRegisterTurnstileEval(ENV);
		expect(entry.tier).toBe('anti-bot');
		expect(entry.serve).toEqual({profile: 'luma', transport: 'extension'});
		expect(entry.seedProfileDir).toBe('/tmp/some-profile');
		const branded = buildLumaRegisterTurnstileEval({
			...ENV,
			WEBHANDS_EVAL_LUMA_REAL_CHROME: '1',
		});
		expect(branded.serve).toMatchObject({realChrome: true});
	});

	it('passes the no-priming guard', () => {
		expect(() =>
			assertNoPriming(buildLumaRegisterTurnstileEval(ENV)),
		).not.toThrow();
	});

	it('treats an already-registered account as a health miss, never a PASS', async () => {
		const entry = buildLumaRegisterTurnstileEval(ENV);
		const registered = {
			exists: async (l: string) => l.includes('re (In|Going)'),
		} as unknown as VerbClient;
		const probe = entry.health[1]!;
		expect(await probe.check(registered)).toBe(false);
		const fresh = {exists: async () => false} as unknown as VerbClient;
		expect(await probe.check(fresh)).toBe(true);
	});
});
