import {describe, expect, it} from 'vitest';
import {StubTransport, type Driver} from '@my-browser-controller/core';

describe('cli -> core wiring', () => {
	it('can consume the core Driver seam across the workspace boundary', async () => {
		const driver: Driver = new StubTransport();
		const session = await driver.open({mode: 'launch', profile: 'default'});
		await session.page.navigate('https://example.test/');
		await session.close();
		expect((driver as StubTransport).calls).toHaveLength(1);
	});
});
