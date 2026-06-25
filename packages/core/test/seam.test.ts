import {describe, expect, it} from 'vitest';
import {
	locator,
	StubTransport,
	type Driver,
	type Transport,
} from '../src/index.js';

describe('Driver/Transport seam', () => {
	it('round-trips open -> Session -> a no-op verb through the seam', async () => {
		// Address the seam at its interface type, not the concrete class.
		const transport: Transport = new StubTransport();

		const session = await transport.open({mode: 'launch', profile: 'default'});

		await session.page.navigate('https://example.test/');
		await session.page.click(locator(`getByRole('button', {name: 'Search'})`));

		await session.close();

		expect((transport as StubTransport).calls).toEqual([
			{verb: 'navigate', args: ['https://example.test/']},
			{verb: 'click', args: [`getByRole('button', {name: 'Search'})`]},
		]);
	});

	it('exposes every verb on the Page surface and round-trips them', async () => {
		const transport = new StubTransport();
		const session = await transport.open({
			mode: 'attach',
			endpoint: 'ws://localhost:9222',
		});
		const {page} = session;

		await page.navigate('https://example.test/');
		const snap = await page.snapshot();
		await page.click(locator(`getByText('ok')`));
		await page.type(locator(`getByLabel('Query')`), 'flights');
		await page.eval('1 + 1');
		await page.wait({kind: 'timeout', ms: 0});
		await page.cookies();
		await page.setCookies([{name: 'sid', value: 'abc'}]);
		await session.close();

		expect(snap.url).toBe('stub://attach/ws://localhost:9222');
		expect(transport.calls.map((c) => c.verb)).toEqual([
			'navigate',
			'snapshot',
			'click',
			'type',
			'eval',
			'wait',
			'cookies',
			'setCookies',
		]);
	});

	it('rejects verbs after the session is closed (lifetime contract)', async () => {
		const transport = new StubTransport();
		const session = await transport.open({mode: 'launch', profile: 'default'});
		await session.close();

		await expect(
			session.page.navigate('https://example.test/'),
		).rejects.toThrow('session is closed');
	});

	it('Driver is an alias of Transport', () => {
		// Type-level assertion: a StubTransport satisfies the Driver alias.
		const driver: Driver = new StubTransport();
		expect(typeof driver.open).toBe('function');
	});
});
