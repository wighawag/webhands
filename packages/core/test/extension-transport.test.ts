import {readdir, readFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
	buildExtensionBrowserArgs,
	ExtensionTransport,
	locator,
	resolveProfileLocation,
	XDOTOOL_ENV,
	XVFB_ENV,
	type Session,
} from '../src/index.js';
import {findExecutable} from '../src/os-input.js';

/**
 * The extension transport end to end (ADR-0018): a REAL browser (Playwright's
 * pinned Chrome for Testing, which honours `--load-extension`) started as a plain
 * process with no debugging port, on a private Xvfb, driven through the bridge
 * extension and OS-level input (xdotool), against a LOCAL fixture.
 *
 * What is asserted is what only this transport owns: the page sees
 * `navigator.webdriver === false`, no process in the browser's tree carries a
 * remote-debugging flag, clicks and keystrokes are TRUSTED (the fixture records
 * `event.isTrusted`), and a click lands inside a CROSS-ORIGIN iframe.
 *
 * Needs Xvfb and xdotool. Without them the suite is skipped with a stated reason,
 * the way the stealth tests skip without Patchright. (Point `WEBHANDS_XVFB` /
 * `WEBHANDS_XDOTOOL` at them if they are installed off PATH.)
 */
const xvfb = await findExecutable('Xvfb', XVFB_ENV);
const xdotool = await findExecutable('xdotool', XDOTOOL_ENV);
const missing = [
	...(xvfb === undefined ? ['Xvfb'] : []),
	...(xdotool === undefined ? ['xdotool'] : []),
];
const canRun = process.platform === 'linux' && missing.length === 0;
if (!canRun) {
	console.warn(
		`extension-transport tests SKIPPED: ${
			process.platform !== 'linux'
				? 'only the X11 input backend is built'
				: `${missing.join(' and ')} not found (install them, or set ${XVFB_ENV}/${XDOTOOL_ENV})`
		}`,
	);
}

function topPage(innerOrigin: string): string {
	return `<!doctype html><html><head><title>extension fixture</title></head><body>
<h1>Extension fixture</h1>
<p id="wd"></p>
<button id="go" onclick="this.textContent='clicked:'+event.isTrusted">Go</button>
<label>Name <input id="name"></label>
<p id="keys">no-keys</p>
<iframe id="xo" src="${innerOrigin}/inner" width="400" height="120"></iframe>
<div id="late"></div>
<div style="position:relative;width:200px"><span id="under">under an overlay</span><div style="position:absolute;inset:0;background:white"></div></div>
<div style="height:2500px"></div>
<button id="far" onclick="this.textContent='far:'+event.isTrusted">Far</button>
<script>
document.getElementById('wd').textContent = 'webdriver:' + String(navigator.webdriver);
let trusted = true;
document.getElementById('name').addEventListener('keydown', (e) => {
	trusted = trusted && e.isTrusted;
	document.getElementById('keys').textContent = 'keys-trusted:' + trusted;
});
setTimeout(() => { document.getElementById('late').innerHTML = '<button id="late-btn">Late</button>'; }, 800);
</script></body></html>`;
}

const INNER = `<!doctype html><html><body style="margin:0">
<button style="margin:20px" onclick="this.textContent='inner:'+event.isTrusted">Inner</button>
</body></html>`;

/** Every process whose command line mentions `needle` (Linux /proc). */
async function processesMentioning(needle: string): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir('/proc')) {
		if (!/^\d+$/.test(entry)) continue;
		let cmdline: string;
		try {
			cmdline = (await readFile(`/proc/${entry}/cmdline`, 'utf8')).replace(
				/\0/g,
				' ',
			);
		} catch {
			continue;
		}
		if (cmdline.includes(needle)) found.push(cmdline);
	}
	return found;
}

describe('buildExtensionBrowserArgs', () => {
	it('refuses an operator arg that would bring a debugging port back', () => {
		expect(() =>
			buildExtensionBrowserArgs({
				userDataDir: '/tmp/p',
				extensionDir: '/tmp/e',
				size: {width: 800, height: 600},
				env: {
					WEBHANDS_CHROME_ARGS: '--no-sandbox --remote-debugging-port=9222',
				},
			}),
		).toThrow(/remote-debugging-port/);
	});

	it('starts a plain browser: no debugging port, no automation flag', () => {
		const args = buildExtensionBrowserArgs({
			userDataDir: '/tmp/p',
			extensionDir: '/tmp/e',
			size: {width: 800, height: 600},
			env: {},
		});
		expect(args).toContain('--load-extension=/tmp/e');
		for (const arg of args) {
			expect(arg).not.toMatch(/remote-debugging|enable-automation|headless/);
		}
	});
});

describe.runIf(canRun)('ExtensionTransport (no CDP, trusted OS input)', () => {
	let server: Server;
	let base: string;
	let innerOrigin: string;
	let root: string;
	let profileDir: string;
	let session: Session;

	beforeAll(async () => {
		server = createServer((req, res) => {
			res.setHeader('content-type', 'text/html');
			if (req.url?.startsWith('/inner')) res.end(INNER);
			else if (req.url?.startsWith('/second'))
				res.end('<title>second</title><h1>Second page</h1>');
			else res.end(topPage(innerOrigin));
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
		const port = (server.address() as {port: number}).port;
		base = `http://127.0.0.1:${port}`;
		// `localhost` vs `127.0.0.1` is a different ORIGIN, so the iframe is cross-origin.
		innerOrigin = `http://localhost:${port}`;
		root = await mkdtemp(join(tmpdir(), 'webhands-ext-'));
		profileDir = resolveProfileLocation('ext', {root}).profileDir;
		await mkdir(profileDir, {recursive: true});
		session = await new ExtensionTransport({root}).open({
			mode: 'launch',
			profile: 'ext',
		});
	});

	afterAll(async () => {
		await session?.close();
		await new Promise<void>((r) => server.close(() => r()));
		await rm(root, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
	});

	it('runs with no remote-debugging flag anywhere in the browser process tree', async () => {
		const procs = await processesMentioning(profileDir);
		expect(procs.length).toBeGreaterThan(0);
		for (const cmd of procs) {
			expect(cmd).not.toMatch(
				/--remote-debugging-(port|pipe)|--enable-automation/,
			);
		}
	});

	it('navigates, and the page itself reads navigator.webdriver === false', async () => {
		await session.page.navigate(`${base}/`);
		expect(
			await session.page.getAttribute(locator(`page.locator('#wd')`), 'id'),
		).toBe('wd');
		const rows = await session.page.query(locator(`page.locator('#wd')`), {
			props: ['textContent'],
		});
		expect(rows[0]?.props?.textContent).toBe('webdriver:false');
	});

	it('snapshots the accessibility tree with refs, and clicks a ref with a TRUSTED click', async () => {
		const snap = await session.page.snapshot();
		expect(snap.view).toBe('accessibility');
		const ref = /button "Go" \[ref=(e\d+)\]/.exec(snap.content)?.[1];
		expect(ref).toBeDefined();
		const result = await session.page.click(locator(ref!), {byRef: true});
		expect(result.via).toBe('click');
		expect(
			await session.page.count(
				locator(`page.getByRole('button', { name: 'clicked:true' })`),
			),
		).toBe(1);
	});

	it('types real keystrokes (fill semantics) into a field', async () => {
		const field = locator(`page.getByLabel('Name')`);
		await session.page.type(field, 'first');
		await session.page.type(field, 'héllo wörld');
		const rows = await session.page.query(field, {props: ['value']});
		expect(rows[0]?.props?.value).toBe('héllo wörld');
		const keys = await session.page.query(locator(`page.locator('#keys')`), {
			props: ['textContent'],
		});
		expect(keys[0]?.props?.textContent).toBe('keys-trusted:true');
	});

	it('clicks inside a CROSS-ORIGIN iframe through a frameLocator hop', async () => {
		const inner = `page.frameLocator('#xo').getByRole('button')`;
		await session.page.click(locator(inner));
		const rows = await session.page.query(locator(inner), {
			props: ['textContent'],
			pw: ['bbox'],
		});
		expect(rows[0]?.props?.textContent).toBe('inner:true');
		// The box is in TOP-viewport coordinates (offset by the iframe), like Playwright's.
		expect(rows[0]?.pw?.bbox?.x).toBeGreaterThan(20);
	});

	it('scrolls an off-screen target into view before a trusted click', async () => {
		await session.page.click(locator(`page.locator('#far')`));
		expect(
			await session.page.exists(
				locator(`page.getByRole('button', { name: 'far:true' })`),
			),
		).toBe(true);
	});

	it('waits for a late element, and for a navigation', async () => {
		await session.page.navigate(`${base}/`);
		await session.page.wait({
			kind: 'locator',
			target: locator(`page.locator('#late-btn')`),
		});
		expect(
			await session.page.isVisible(locator(`page.locator('#late-btn')`)),
		).toBe(true);
		// `wait` is a READ (attached + visible), not an actionability check: an
		// element under an overlay satisfies it, and an ambiguous locator is refused.
		await session.page.wait({
			kind: 'locator',
			target: locator(`page.locator('#under')`),
		});
		await expect(
			session.page.wait({
				kind: 'locator',
				target: locator(`page.locator('button')`),
			}),
		).rejects.toThrow(/strict mode violation/);
		await session.page.navigate(`${base}/second`);
		const snap = await session.page.snapshot();
		expect(snap.url).toBe(`${base}/second`);
		expect(snap.content).toContain('Second page');
	});

	it('exports, imports and clears cookies through chrome.cookies', async () => {
		await session.page.setCookies([
			{name: 'wh_a', value: '1', domain: '127.0.0.1', path: '/'},
			{name: 'wh_b', value: '2', domain: '127.0.0.1', path: '/'},
		]);
		const names = (await session.page.cookies()).map((c) => c.name);
		expect(names).toEqual(expect.arrayContaining(['wh_a', 'wh_b']));
		await expect(session.page.clearCookies({})).rejects.toThrow(/empty filter/);
		expect(await session.page.clearCookies({names: ['wh_a']})).toBe(1);
		const after = (await session.page.cookies()).map((c) => c.name);
		expect(after).not.toContain('wh_a');
		expect(after).toContain('wh_b');
	});

	it('takes a viewport screenshot as a PNG path', async () => {
		const shot = await session.page.screenshot();
		expect(shot.path).toMatch(/\.png$/);
		expect(shot.width).toBeGreaterThan(100);
	});

	it('refuses what it does not support, loudly and typed', async () => {
		await expect(session.page.eval('1')).rejects.toMatchObject({
			code: 'unsupported-by-transport',
		});
		await expect(
			session.page.hover(locator(`page.locator('h1')`)),
		).rejects.toMatchObject({
			code: 'unsupported-by-transport',
		});
		await expect(
			session.page.click(locator(`page.locator('h1').evaluate(() => 1)`)),
		).rejects.toMatchObject({code: 'unsupported-by-transport'});
	});

	it('closes the browser and its display on close, leaving no process behind', async () => {
		await session.close();
		await new Promise((r) => setTimeout(r, 500));
		expect(await processesMentioning(profileDir)).toEqual([]);
		// The extension is left INERT, so a later plain start does not dial a port
		// that is no longer ours.
		const config = JSON.parse(
			await readFile(join(root, 'extension', 'config.json'), 'utf8'),
		) as {port: number; token: string};
		expect(config).toEqual({port: 0, token: ''});
	});
});
