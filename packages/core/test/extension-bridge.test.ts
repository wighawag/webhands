import {afterEach, describe, expect, it} from 'vitest';
import {
	bridgeProof,
	extensionOrigin,
	startExtensionBridge,
	type ExtensionBridge,
} from '../src/extension-bridge.js';

/**
 * The bridge's handshake, without a browser: a Node WebSocket client plays the
 * extension's worker (ADR-0018). What matters is who gets to talk: only the
 * pinned origin, only a peer that proves the token, and nothing a hostile local
 * peer sends may take the controller down.
 */
const ID = 'ioibflhppapnjicjagljmbejpjeahajb';
const TOKEN = 'test-token-0123456789';

type Ws = WebSocket;

function open(port: number, origin = extensionOrigin(ID)): Promise<Ws> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
			headers: {origin},
		} as unknown as string[]);
		ws.onopen = () => resolve(ws);
		ws.onerror = () => reject(new Error('connection refused'));
	});
}

function next(ws: Ws): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		ws.onmessage = (e) =>
			resolve(JSON.parse(String(e.data)) as Record<string, unknown>);
		ws.onclose = () => reject(new Error('closed'));
	});
}

function closed(ws: Ws): Promise<void> {
	return new Promise((resolve) => {
		if (ws.readyState === WebSocket.CLOSED) resolve();
		ws.onclose = () => resolve();
	});
}

describe('extension bridge handshake', () => {
	let bridge: ExtensionBridge | undefined;
	afterEach(async () => {
		await bridge?.close();
		bridge = undefined;
	});

	it('runs a MUTUAL challenge (the token never crosses), then serves requests', async () => {
		bridge = await startExtensionBridge({extensionId: ID, token: TOKEN});
		const ws = await open(bridge.port);
		ws.send(JSON.stringify({hello: 'client-nonce-0123456789'}));
		const challenge = await next(ws);
		// The server proves it holds the token before the worker gives anything away.
		expect(challenge.proof).toBe(
			bridgeProof(TOKEN, 'server', 'client-nonce-0123456789'),
		);
		expect(JSON.stringify(challenge)).not.toContain(TOKEN);
		ws.send(
			JSON.stringify({
				auth: bridgeProof(TOKEN, 'client', String(challenge.challenge)),
			}),
		);
		expect(await next(ws)).toEqual({welcome: true});
		ws.onmessage = (e) => {
			const m = JSON.parse(String(e.data)) as {id: number};
			ws.send(JSON.stringify({id: m.id, ok: true, result: 'pong'}));
		};
		expect(await bridge.call('ping')).toBe('pong');
		ws.close();
	});

	it('closes a peer whose answer is wrong, and a foreign Origin never upgrades', async () => {
		bridge = await startExtensionBridge({extensionId: ID, token: TOKEN});
		const ws = await open(bridge.port);
		ws.send(JSON.stringify({hello: 'client-nonce-0123456789'}));
		await next(ws);
		ws.send(JSON.stringify({auth: 'not-the-proof'}));
		await closed(ws);
		expect(bridge.connected()).toBe(false);

		await expect(open(bridge.port, 'https://evil.example')).rejects.toThrow();
	});

	it('survives a hostile frame (null, an array) instead of crashing the controller', async () => {
		bridge = await startExtensionBridge({extensionId: ID, token: TOKEN});
		for (const frame of ['null', '[1,2]', '42']) {
			const ws = await open(bridge.port);
			ws.send(frame);
			await closed(ws);
		}
		// Still listening and still able to authenticate a real peer.
		const ws = await open(bridge.port);
		ws.send(JSON.stringify({hello: 'client-nonce-0123456789'}));
		expect((await next(ws)).challenge).toEqual(expect.any(String));
		ws.close();
	});
});
