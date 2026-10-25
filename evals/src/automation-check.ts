import {readdir, readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {VerbClient} from './verb-client.js';

/**
 * The "no automation signals" assertion an anti-bot eval needs (ADR-0018). A PASS
 * on such an eval is only evidence about the no-CDP transport if the session
 * really had (1) no remote-debugging or automation flag on ANY process under the
 * served session, and (2) `navigator.webdriver === false` as a page reads it.
 *
 * (2) is read on a loopback page the harness serves, NOT on the target site:
 * the extension transport deliberately has no page-world `eval`, and
 * `navigator.webdriver` is a browser-level property set from the command line,
 * so it is the same value on every page of that browser. (1) is the stronger
 * check; it is Linux-only (`/proc`), which is where this transport runs.
 */

/** Flags that mean a debugging surface or automation mode is on. */
const AUTOMATION_FLAG =
	/^--(remote-debugging-(port|pipe|address)|enable-automation|headless)/;

/** One offending argument on one process. */
export interface FlagHit {
	readonly pid: number;
	readonly arg: string;
}

/** The result of {@link checkAutomationSignals}. */
export interface AutomationCheck {
	/** Processes examined under the served session (including the root). */
	readonly processes: number;
	/** Offending flags found anywhere in that tree. */
	readonly flags: readonly FlagHit[];
	/** `navigator.webdriver` as a page read it (`undefined` if not checked). */
	readonly webdriver?: boolean;
	/** Whether the session is free of automation signals. */
	readonly ok: boolean;
}

/** Walk the whole process tree under `rootPid` and report automation flags. */
export async function automationFlagsInTree(
	rootPid: number,
): Promise<{processes: number; flags: FlagHit[]}> {
	const procs = new Map<number, {ppid: number; argv: string[]}>();
	for (const entry of await readdir('/proc')) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			const stat = await readFile(`/proc/${entry}/stat`, 'utf8');
			const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
			const argv = (await readFile(`/proc/${entry}/cmdline`, 'utf8'))
				.split('\0')
				.filter((a) => a !== '');
			procs.set(Number(entry), {ppid, argv});
		} catch {
			// A process that exited mid-scan.
		}
	}
	const tree = [rootPid];
	for (let i = 0; i < tree.length; i++) {
		for (const [pid, p] of procs) if (p.ppid === tree[i]) tree.push(pid);
	}
	const flags: FlagHit[] = [];
	for (const pid of tree) {
		for (const arg of procs.get(pid)?.argv ?? []) {
			if (AUTOMATION_FLAG.test(arg)) flags.push({pid, arg});
		}
	}
	return {processes: tree.length, flags};
}

/** Read `navigator.webdriver` through the session, on a page the harness serves. */
export async function webdriverAsPageSeesIt(
	verbs: VerbClient,
): Promise<boolean> {
	const server = createServer((_req, res) => {
		res.setHeader('content-type', 'text/html; charset=utf-8');
		res.end(
			'<!doctype html><title>webdriver probe</title><script>' +
				'document.documentElement.setAttribute("data-webdriver", String(navigator.webdriver))' +
				'</script>',
		);
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
	try {
		const port = (server.address() as {port: number}).port;
		await verbs.goto(`http://127.0.0.1:${port}/`);
		const value = await verbs.getAttribute(
			`page.locator('html')`,
			'data-webdriver',
		);
		if (value !== 'true' && value !== 'false') {
			throw new Error(`webdriver probe read ${JSON.stringify(value)}`);
		}
		return value === 'true';
	} finally {
		await new Promise<void>((r) => server.close(() => r()));
	}
}

/** Both checks: the process tree under `rootPid`, and optionally the page bit. */
export async function checkAutomationSignals(
	rootPid: number,
	verbs?: VerbClient,
): Promise<AutomationCheck> {
	const tree = await automationFlagsInTree(rootPid);
	const webdriver =
		verbs !== undefined ? await webdriverAsPageSeesIt(verbs) : undefined;
	return {
		processes: tree.processes,
		flags: tree.flags,
		...(webdriver !== undefined ? {webdriver} : {}),
		ok: tree.flags.length === 0 && webdriver !== true,
	};
}
