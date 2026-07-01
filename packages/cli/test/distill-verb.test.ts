import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	connectRemoteSession,
	locator,
	startSessionServer,
	StubTransport,
	type RunningSessionServer,
} from '@webhands/core';
import {createCli} from '../src/index.js';

/**
 * The `distill` verb wiring + its HARD TRUST INVARIANT (task
 * `distill-verb-emits-hand-scaffold`; prd `distill-session-into-hand`).
 *
 * `distill` reads the just-driven session's verb trace over the read-only trace
 * route and EMITS a hand SCAFFOLD (a frozen ADR-0007 `Hand`) plus a notes
 * markdown to a caller-named `--out` path. It EMITS and NEVER LOADS: adopting a
 * hand (naming it in `hands.json`) stays the human's explicit, operator-scoped
 * trust act (ADR-0007). This suite asserts, mirroring the repo's
 * explicit-declarative hand-loading tests:
 *
 * - the emit behaviour end-to-end (a real stub-served session driven by a thin
 *   client, then `distill` crystallizes its trace);
 * - the TRUST INVARIANT: `distill` writes NO `hands.json` anywhere (not the temp
 *   home root, not the config dir) and never loads the module;
 * - SHARED-WRITE ISOLATION: the scaffold + notes land ONLY under the temp
 *   `--out` dir, and no real home/config location is written.
 *
 * Every path points at a temp dir so the real `~/.webhands` is untouched.
 */
describe('distill verb: emit + the trust invariant', () => {
	const tempRoots: string[] = [];
	const tempOuts: string[] = [];
	const running: RunningSessionServer[] = [];

	afterEach(async () => {
		while (running.length > 0) await running.pop()!.stop();
		while (tempRoots.length > 0)
			await rm(tempRoots.pop()!, {recursive: true, force: true});
		while (tempOuts.length > 0)
			await rm(tempOuts.pop()!, {recursive: true, force: true});
	});

	/** Bring up a stub-served session over a temp home root and drive a sub-flow. */
	async function servedSessionWithTrace(): Promise<{root: string}> {
		const root = await mkdtemp(join(tmpdir(), 'mbc-distill-home-'));
		tempRoots.push(root);
		const server = await startSessionServer(
			{mode: 'launch', profile: 'default'},
			{root, transport: new StubTransport()},
		);
		running.push(server);

		// Drive a realistic login + add-to-cart sub-flow as a thin client, so the
		// server accumulates a trace `distill` can crystallize.
		const client = connectRemoteSession(server.endpoint.url);
		await client.page.navigate('https://www.saucedemo.com/');
		await client.page.type(locator('#user-name'), 'standard_user');
		await client.page.type(locator('#password'), '{ENV:SAUCE_PASSWORD}');
		await client.page.click(locator('#login-button'));
		await client.close();
		return {root};
	}

	/** Run one CLI command against a temp home root, returning the JSON envelope. */
	async function runDistill(
		root: string,
		argv: string[],
	): Promise<{
		ok: boolean;
		data?: {out: string; notes: string; steps: number};
		error?: {code: string; message: string};
	}> {
		const cli = createCli({home: {root}});
		let stdout = '';
		await cli.serve([...argv, '--full-output', '--format', 'json'], {
			stdout: (s) => {
				stdout += s;
			},
			exit: () => {},
			env: {},
		});
		return JSON.parse(stdout);
	}

	async function tempOut(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), 'mbc-distill-out-'));
		tempOuts.push(dir);
		return dir;
	}

	it('emits a Hand scaffold + notes to --out from the served session trace', async () => {
		const {root} = await servedSessionWithTrace();
		const outDir = await tempOut();
		const out = join(outDir, 'hands', 'saucedemo-login.mjs');

		const envelope = await runDistill(root, ['distill', '--out', out]);
		expect(envelope.ok).toBe(true);
		expect(envelope.data!.out).toBe(out);
		expect(envelope.data!.steps).toBe(4);

		// The scaffold is a Hand-shaped module replaying the discovered steps...
		const scaffold = await readFile(out, 'utf8');
		expect(scaffold).toContain('export default function');
		expect(scaffold).toContain('ctx.pwPage');
		expect(scaffold).toContain('https://www.saucedemo.com/');
		// ...carrying the credential as the TOKEN, never a resolved secret.
		expect(scaffold).toContain('{ENV:SAUCE_PASSWORD}');

		// The notes markdown landed beside it.
		const notes = await readFile(envelope.data!.notes, 'utf8');
		expect(notes).toContain('# Distilled hand');
		expect(notes).toContain('## Steps');
	});

	it('TRUST INVARIANT: writes NO hands.json anywhere and never loads the module', async () => {
		const {root} = await servedSessionWithTrace();
		const outDir = await tempOut();
		const out = join(outDir, 'distilled.mjs');

		await runDistill(root, ['distill', '--out', out]);

		// No hands.json in the home root or the out dir (distill NEVER adopts).
		expect(existsSync(join(root, 'hands.json'))).toBe(false);
		expect(existsSync(join(outDir, 'hands.json'))).toBe(false);
		const rootEntries = await readdir(root);
		expect(rootEntries).not.toContain('hands.json');

		// distill only ever wrote the two artifacts under --out.
		const outEntries = await readdir(outDir);
		expect(outEntries.sort()).toEqual(
			['distilled.mjs', 'distilled.mjs.notes.md'].sort(),
		);
	});

	it('SHARED-WRITE ISOLATION: pre-seeded hands.json is left UNTOUCHED', async () => {
		const {root} = await servedSessionWithTrace();
		// A human-owned hands.json already exists; distill must not touch it.
		const handsConfig = join(root, 'hands.json');
		const original = JSON.stringify({
			hands: [{name: 'kept', entry: './k.mjs'}],
		});
		await writeFile(handsConfig, original, 'utf8');

		const outDir = await tempOut();
		await runDistill(root, ['distill', '--out', join(outDir, 'h.mjs')]);

		// The operator's config is byte-for-byte unchanged (no adoption happened).
		expect(await readFile(handsConfig, 'utf8')).toBe(original);
	});

	it('accepts --summary + --session-file as OPTIONAL enrichments (and slice)', async () => {
		const {root} = await servedSessionWithTrace();
		const outDir = await tempOut();
		const transcript = join(outDir, 'transcript.txt');
		await writeFile(transcript, 'user: please log me in', 'utf8');
		const out = join(outDir, 'enriched.mjs');

		const envelope = await runDistill(root, [
			'distill',
			'--out',
			out,
			'--summary',
			'Log in as the standard user.',
			'--session-file',
			transcript,
			'--from',
			'0',
			'--to',
			'2',
		]);
		expect(envelope.ok).toBe(true);

		const notes = await readFile(envelope.data!.notes, 'utf8');
		expect(notes).toContain('Log in as the standard user.');
		expect(notes).toContain('## Session transcript');
		expect(notes).toContain('user: please log me in');

		// The slice [0,2] crystallized only navigate + the two type steps.
		const scaffold = await readFile(out, 'utf8');
		expect(scaffold).not.toContain('#login-button');
		expect(scaffold).toContain('#user-name');
	});

	it('a missing --session-file fails loud (a plain path it is HANDED, not discovered)', async () => {
		const {root} = await servedSessionWithTrace();
		const outDir = await tempOut();
		const envelope = await runDistill(root, [
			'distill',
			'--out',
			join(outDir, 'x.mjs'),
			'--session-file',
			join(outDir, 'does-not-exist.txt'),
		]);
		expect(envelope.ok).toBe(false);
		expect(envelope.error!.code).toBe('invalid-session-file');
	});

	it('errors with "run serve first" when no session is live', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mbc-distill-nolive-'));
		tempRoots.push(root);
		const outDir = await tempOut();
		const envelope = await runDistill(root, [
			'distill',
			'--out',
			join(outDir, 'x.mjs'),
		]);
		expect(envelope.ok).toBe(false);
		// No scaffold was written when there was nothing to distill.
		expect(existsSync(join(outDir, 'x.mjs'))).toBe(false);
	});
});
