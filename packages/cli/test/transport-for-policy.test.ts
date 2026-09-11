import {describe, expect, it} from 'vitest';
import type {OpenTarget, Session} from '@webhands/core';
import {transportForPolicy, type TransportFactories} from '../src/index.js';

/**
 * WHICH browser a launch policy brings up, and with which options.
 *
 * This is the one genuinely branchy decision in the CLI, and it used to be inline
 * in `defaultServeSession`, which meant `serve --real-chrome` was only ever
 * asserted as a FLAG: every `serve` wiring test injects a fake serve seam, so the
 * code that turns `realChrome: true` into a `RealChromeTransport` (and forwards
 * `--keep-browser` / `--proxy` / `--expose-cdp`) ran in no test at all. Reviewing
 * the change set is what surfaced that gap.
 *
 * Hermetic by construction: the transport CONSTRUCTORS are injected and record
 * their options, so nothing launches, spawns or binds. What is asserted is the
 * policy-to-options mapping, which is exactly what a user's flags buy them.
 */
describe('transportForPolicy (which browser a policy brings up)', () => {
	const home = {root: '/tmp/not-used'};

	/** Recording factories plus the calls they saw. */
	function recording() {
		const realChrome: unknown[] = [];
		const launch: unknown[] = [];
		const attach: number[] = [];
		const opened: OpenTarget[] = [];
		const session = {} as Session;

		const factories: TransportFactories = {
			realChrome: (_home, options) => {
				realChrome.push(options);
				return {
					async open(t: OpenTarget) {
						opened.push(t);
						return session;
					},
					cdpEndpoint: () => 'http://127.0.0.1:41111',
				};
			},
			launch: (_home, options) => {
				launch.push(options);
				return {
					async open(t: OpenTarget) {
						opened.push(t);
						return session;
					},
					cdpEndpoint: () => 'http://127.0.0.1:42222',
				};
			},
			attach: () => ({
				async open(t: OpenTarget) {
					attach.push(1);
					opened.push(t);
					return session;
				},
			}),
		};
		return {factories, realChrome, launch, attach, opened};
	}

	describe('--real-chrome', () => {
		it('builds the real-Chrome transport and forwards keepBrowser + proxy', async () => {
			const {factories, realChrome, launch, opened} = recording();
			const {transport} = transportForPolicy(
				home,
				{
					realChrome: true,
					keepBrowser: true,
					proxy: 'socks5h://127.0.0.1:1080',
				},
				factories,
			);

			// No Playwright launch transport is built at all in this mode.
			expect(launch).toHaveLength(0);
			expect(realChrome).toEqual([
				{keepBrowser: true, proxy: 'socks5h://127.0.0.1:1080'},
			]);

			// A launch target routes to it (the seam is unchanged: ADR-0003).
			await transport.open({mode: 'launch', profile: 'default'});
			expect(opened).toEqual([{mode: 'launch', profile: 'default'}]);
		});

		it('forwards NEITHER flag when unset (minimal options, core decides)', async () => {
			const {factories, realChrome} = recording();
			transportForPolicy(home, {realChrome: true}, factories);
			expect(realChrome).toEqual([{}]);
		});

		it('does NOT advertise a CDP endpoint unless --expose-cdp was passed', () => {
			// The spawned browser always HAS a debugging port (that is how we attach), so
			// this is purely about whether the caller asked to know it. Advertising it
			// unasked would hand out a shared driving surface nobody requested.
			const {factories} = recording();
			const without = transportForPolicy(home, {realChrome: true}, factories);
			expect(without.cdpEndpoint).toBeUndefined();

			const {factories: f2} = recording();
			const with_ = transportForPolicy(
				home,
				{realChrome: true, exposeCdp: true},
				f2,
			);
			// Previously this combination was silently ignored: no endpoint, no warning.
			expect(with_.cdpEndpoint?.()).toBe('http://127.0.0.1:41111');
		});

		it('routes an ATTACH target to the attach transport, never spawning', async () => {
			// `--endpoint` is the more specific request and must win, so we never spawn a
			// second browser nor adopt the lifetime of one the user started. (The `serve`
			// command separately WARNS that the bring-up flags are then moot.)
			const {factories, attach, opened} = recording();
			const {transport} = transportForPolicy(
				home,
				{realChrome: true, proxy: 'socks5h://127.0.0.1:1080'},
				factories,
			);
			await transport.open({mode: 'attach', endpoint: 'http://127.0.0.1:9222'});
			expect(attach).toEqual([1]);
			expect(opened).toEqual([
				{mode: 'attach', endpoint: 'http://127.0.0.1:9222'},
			]);
		});
	});

	describe('the default Playwright launch path', () => {
		it('forwards the stealth policy and keeps exposeCdp OFF by default', () => {
			const {factories, launch, realChrome} = recording();
			transportForPolicy(
				home,
				{stealth: true, systemBrowser: 'chrome'},
				factories,
			);
			expect(realChrome).toHaveLength(0);
			expect(launch).toEqual([
				{stealth: true, systemBrowser: 'chrome', exposeCdp: false},
			]);
		});

		it('forwards exposeCdp TRUE only when asked', () => {
			const {factories, launch} = recording();
			transportForPolicy(home, {exposeCdp: true}, factories);
			expect(launch[0]).toMatchObject({exposeCdp: true});
		});

		it('always advertises the launch transport CDP resolver (undefined when off)', () => {
			// The launch path keeps its resolver unconditionally: `startSessionServer`
			// calls it after open and the transport returns undefined when no port was
			// opened, so there is nothing to branch on here.
			const {factories} = recording();
			const {cdpEndpoint} = transportForPolicy(home, {}, factories);
			expect(cdpEndpoint?.()).toBe('http://127.0.0.1:42222');
		});

		it('forwards the proxy and the viewport tri-state as given', () => {
			const {factories, launch} = recording();
			transportForPolicy(
				home,
				{proxy: 'socks5://host:1080', noViewport: true},
				factories,
			);
			expect(launch[0]).toMatchObject({
				proxy: 'socks5://host:1080',
				noViewport: true,
			});
		});
	});
});
