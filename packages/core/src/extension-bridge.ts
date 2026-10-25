import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import type {Duplex} from 'node:stream';

/**
 * The controller half of the extension transport's bridge (ADR-0018).
 *
 * SHAPE. The controller is a loopback WebSocket SERVER and the extension's
 * service worker is its only CLIENT. The controller owns the loop (ADR-0001):
 * the worker is a stateless executor that answers `{id, op, ...}` requests with
 * `{id, ok, result | error}`, so a worker that Chrome kills and restarts loses
 * nothing but the request in flight. That request REJECTS (it is never replayed,
 * because a click is not idempotent), and the next request waits for the worker
 * to reconnect.
 *
 * AUTH, in two independent layers, both checked before any request is sent:
 * 1. the HTTP upgrade must carry `Origin: chrome-extension://<pinned id>`, which a
 *    web page cannot forge (browsers set `Origin` on WebSocket handshakes);
 * 2. the first frame must be `{hello: <token>}` with the per-session token the
 *    controller wrote into the extension's private `config.json`, compared in
 *    constant time.
 * The listener binds 127.0.0.1 only.
 *
 * WHY A HAND-ROLLED WEBSOCKET. The peer is one known client (Chrome) sending
 * small text frames; RFC 6455 for that is ~80 lines, which is cheaper than a new
 * runtime dependency in a package whose dependency list is deliberately short.
 * Unsupported frame types (binary, fragmented control frames) close the socket.
 */

/** The `Origin` a connection must present: the extension's pinned id. */
export function extensionOrigin(extensionId: string): string {
	return `chrome-extension://${extensionId}`;
}

/** The path of the inert start page the bridge serves (see `startUrl`). */
const START_PATH = '/start';

/** A fresh per-session bridge token (URL-safe, 256 bits). */
export function mintBridgeToken(): string {
	return randomBytes(32).toString('base64url');
}

/** A minimal server-side WebSocket connection (text frames only). */
interface WsConnection {
	send(text: string): void;
	close(): void;
	onMessage(handler: (text: string) => void): void;
	onClose(handler: () => void): void;
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptUpgrade(req: IncomingMessage, socket: Duplex): WsConnection {
	const key = String(req.headers['sec-websocket-key'] ?? '');
	const accept = createHash('sha1')
		.update(key + WS_GUID)
		.digest('base64');
	socket.write(
		'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
			`Connection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
	);
	let buffer = Buffer.alloc(0);
	let fragments: Buffer[] = [];
	let messageHandler: (text: string) => void = () => {};
	let closeHandler: () => void = () => {};
	let closed = false;

	const writeFrame = (opcode: number, payload: Buffer) => {
		if (closed) return;
		let header: Buffer;
		if (payload.length < 126) {
			header = Buffer.from([0x80 | opcode, payload.length]);
		} else if (payload.length < 65_536) {
			header = Buffer.alloc(4);
			header[0] = 0x80 | opcode;
			header[1] = 126;
			header.writeUInt16BE(payload.length, 2);
		} else {
			header = Buffer.alloc(10);
			header[0] = 0x80 | opcode;
			header[1] = 127;
			header.writeBigUInt64BE(BigInt(payload.length), 2);
		}
		socket.write(Buffer.concat([header, payload]));
	};
	const close = () => {
		if (closed) return;
		writeFrame(0x8, Buffer.alloc(0));
		closed = true;
		socket.end();
	};

	socket.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			if (buffer.length < 2) return;
			const fin = (buffer[0]! & 0x80) !== 0;
			const opcode = buffer[0]! & 0x0f;
			const masked = (buffer[1]! & 0x80) !== 0;
			let length = buffer[1]! & 0x7f;
			let offset = 2;
			if (length === 126) {
				if (buffer.length < 4) return;
				length = buffer.readUInt16BE(2);
				offset = 4;
			} else if (length === 127) {
				if (buffer.length < 10) return;
				length = Number(buffer.readBigUInt64BE(2));
				offset = 10;
			}
			// A client MUST mask (RFC 6455 5.1); an unmasked frame is not from a browser.
			if (!masked || length > 64 * 1024 * 1024) {
				close();
				return;
			}
			if (buffer.length < offset + 4 + length) return;
			const mask = buffer.subarray(offset, offset + 4);
			const payload = Buffer.from(
				buffer.subarray(offset + 4, offset + 4 + length),
			);
			for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!;
			buffer = buffer.subarray(offset + 4 + length);
			if (opcode === 0x8) {
				close();
				return;
			}
			if (opcode === 0x9) {
				writeFrame(0xa, payload);
				continue;
			}
			if (opcode === 0xa) continue;
			if (opcode === 0x2) {
				close();
				return;
			}
			fragments.push(payload);
			if (fin) {
				const text = Buffer.concat(fragments).toString('utf8');
				fragments = [];
				messageHandler(text);
			}
		}
	});
	socket.on('close', () => {
		closed = true;
		closeHandler();
	});
	socket.on('error', () => {
		// The 'close' event follows; nothing else to do.
	});
	return {
		send: (text) => writeFrame(0x1, Buffer.from(text, 'utf8')),
		close,
		onMessage: (h) => {
			messageHandler = h;
		},
		onClose: (h) => {
			closeHandler = h;
		},
	};
}

/** An error the extension reported for a request. */
export class BridgeRemoteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'Error';
	}
}

/** Thrown when the worker is not (or no longer) connected. */
export class BridgeDisconnectedError extends Error {}

/** Options for {@link startExtensionBridge}. */
export interface ExtensionBridgeOptions {
	/** The extension id whose origin is the only one accepted. */
	readonly extensionId: string;
	/** The per-session token the extension must present. */
	readonly token: string;
	/** Interval of the keep-alive ping that holds the MV3 worker alive. Default 20s. */
	readonly keepAliveMs?: number;
}

/** A running bridge. */
export interface ExtensionBridge {
	/** The bound loopback port (written into the extension's `config.json`). */
	readonly port: number;
	/**
	 * The URL the browser should open first: an inert page whose content-script
	 * load wakes the extension's worker so it connects.
	 */
	readonly startUrl: string;
	/** Resolve once an authenticated worker is connected (or reject at `timeoutMs`). */
	waitForConnection(timeoutMs: number): Promise<void>;
	/** Whether an authenticated worker is connected right now. */
	connected(): boolean;
	/**
	 * Send one request and await its reply. If no worker is connected, waits up
	 * to `connectTimeoutMs` for one (a restarted worker reconnects on its own).
	 * Rejects with {@link BridgeDisconnectedError} if the socket drops while the
	 * request is in flight; it is NOT replayed.
	 */
	call<T = unknown>(
		op: string,
		args?: Record<string, unknown>,
		options?: {timeoutMs?: number; connectTimeoutMs?: number},
	): Promise<T>;
	/** Stop listening and drop the connection. */
	close(): Promise<void>;
}

interface Pending {
	resolve(value: unknown): void;
	reject(cause: unknown): void;
	timer: NodeJS.Timeout;
}

/**
 * Start the bridge on an OS-assigned loopback port.
 */
export async function startExtensionBridge(
	options: ExtensionBridgeOptions,
): Promise<ExtensionBridge> {
	const expectedOrigin = extensionOrigin(options.extensionId);
	const expectedToken = Buffer.from(options.token, 'utf8');
	let current: WsConnection | undefined;
	let nextId = 1;
	const pending = new Map<number, Pending>();
	let waiters: Array<() => void> = [];
	// Every upgraded socket, so `close()` can end them: `server.close()` alone
	// waits for upgraded connections forever.
	const sockets = new Set<Duplex>();

	const server: Server = createServer((req, res) => {
		// The browser's FIRST page. An MV3 worker only runs when an event wakes it,
		// and at browser start nothing does (`about:blank` gets no content script,
		// and alarms are not guaranteed to survive a restart). A real http page does
		// get the content script, whose load message wakes the worker, which then
		// reads config.json and connects. The page itself is empty and inert.
		if (req.method === 'GET' && req.url === START_PATH) {
			res.writeHead(200, {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'no-store',
			});
			res.end('<!doctype html><title>webhands</title>');
			return;
		}
		res.writeHead(404);
		res.end();
	});
	server.on('upgrade', (req, socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
		if (
			req.headers.origin !== expectedOrigin ||
			req.headers.upgrade?.toLowerCase() !== 'websocket'
		) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
			socket.destroy();
			return;
		}
		const conn = acceptUpgrade(req, socket);
		let authed = false;
		// An unauthenticated connection gets a short window to say hello.
		const helloTimer = setTimeout(() => {
			if (!authed) conn.close();
		}, 5_000);
		conn.onMessage((text) => {
			let message: Record<string, unknown>;
			try {
				message = JSON.parse(text) as Record<string, unknown>;
			} catch {
				conn.close();
				return;
			}
			if (!authed) {
				const presented = Buffer.from(String(message.hello ?? ''), 'utf8');
				if (
					presented.length !== expectedToken.length ||
					!timingSafeEqual(presented, expectedToken)
				) {
					conn.close();
					return;
				}
				authed = true;
				clearTimeout(helloTimer);
				// One worker at a time: a reconnect replaces the previous socket.
				const previous = current;
				current = conn;
				if (previous !== undefined) previous.close();
				conn.send(JSON.stringify({welcome: true}));
				const ready = waiters;
				waiters = [];
				for (const w of ready) w();
				return;
			}
			const id = typeof message.id === 'number' ? message.id : undefined;
			if (id === undefined) return;
			const entry = pending.get(id);
			if (entry === undefined) return;
			pending.delete(id);
			clearTimeout(entry.timer);
			if (message.ok === true) {
				entry.resolve(message.result);
			} else {
				const error = (message.error ?? {}) as {message?: string};
				entry.reject(
					new BridgeRemoteError(String(error.message ?? 'extension error')),
				);
			}
		});
		conn.onClose(() => {
			clearTimeout(helloTimer);
			if (current !== conn) return;
			current = undefined;
			for (const [id, entry] of pending) {
				pending.delete(id);
				clearTimeout(entry.timer);
				entry.reject(
					new BridgeDisconnectedError(
						'the extension disconnected while the request was in flight (it is not retried)',
					),
				);
			}
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (address === null || typeof address === 'string') {
		server.close();
		throw new Error('extension bridge failed to bind a loopback port');
	}

	const waitForConnection = (timeoutMs: number): Promise<void> => {
		if (current !== undefined) return Promise.resolve();
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				waiters = waiters.filter((w) => w !== done);
				reject(
					new BridgeDisconnectedError(
						`no extension connected within ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			waiters.push(done);
		});
	};

	const call = async <T>(
		op: string,
		args: Record<string, unknown> = {},
		opts: {timeoutMs?: number; connectTimeoutMs?: number} = {},
	): Promise<T> => {
		await waitForConnection(opts.connectTimeoutMs ?? 10_000);
		const conn = current!;
		const id = nextId++;
		const timeoutMs = opts.timeoutMs ?? 30_000;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(
					new Error(`extension request '${op}' timed out after ${timeoutMs}ms`),
				);
			}, timeoutMs);
			pending.set(id, {
				resolve: resolve as (v: unknown) => void,
				reject,
				timer,
			});
			conn.send(JSON.stringify({id, op, ...args}));
		});
	};

	// Keep-alive: Chrome 116+ keeps an MV3 worker alive while it exchanges
	// WebSocket messages, so a reply-bearing ping every 20s holds it up between
	// verbs. A failed ping is harmless: the worker reconnects on its next start.
	const keepAlive = setInterval(() => {
		if (current !== undefined) {
			call('ping', {}, {timeoutMs: 10_000, connectTimeoutMs: 1}).catch(
				() => {},
			);
		}
	}, options.keepAliveMs ?? 20_000);
	keepAlive.unref();

	return {
		port: address.port,
		startUrl: `http://127.0.0.1:${address.port}${START_PATH}`,
		waitForConnection,
		connected: () => current !== undefined,
		call,
		async close() {
			clearInterval(keepAlive);
			current?.close();
			current = undefined;
			for (const [id, entry] of pending) {
				pending.delete(id);
				clearTimeout(entry.timer);
				entry.reject(new BridgeDisconnectedError('the bridge was closed'));
			}
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
