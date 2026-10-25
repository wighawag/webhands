import {spawn} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {automationFlagsInTree} from '../src/automation-check.js';

/**
 * The no-automation-signals assertion walks the WHOLE process tree under the
 * served session, so a debugging flag on any descendant (a browser, a renderer)
 * is caught, not just one on the root. Linux-only, like the transport.
 */
describe.runIf(process.platform === 'linux')('automationFlagsInTree', () => {
	it('finds a debugging flag on a descendant process, and nothing when there is none', async () => {
		const clean = await automationFlagsInTree(process.pid);
		expect(clean.flags.filter((f) => f.arg.includes('9999'))).toEqual([]);

		const child = spawn(
			process.execPath,
			[
				'-e',
				'setTimeout(() => {}, 10000)',
				'--',
				'--remote-debugging-port=9999',
			],
			{stdio: 'ignore'},
		);
		try {
			await new Promise((r) => setTimeout(r, 300));
			const found = await automationFlagsInTree(process.pid);
			expect(found.flags).toContainEqual({
				pid: child.pid,
				arg: '--remote-debugging-port=9999',
			});
			expect(found.processes).toBeGreaterThan(1);
		} finally {
			child.kill();
		}
	});
});
