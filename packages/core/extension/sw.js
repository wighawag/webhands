// webhands bridge: the extension's service worker (ADR-0018).
//
// A STATELESS executor. The controller (`webhands serve --transport extension`)
// owns the loop and every piece of session state; this worker only connects to
// it over a loopback WebSocket, authenticates with the per-session token from
// config.json, and answers `{id, op, ...}` requests. Chrome may kill an MV3
// worker at any time; the top-level `connect()` below and the alarm restart it,
// and nothing is lost except a request that was in flight (the controller
// rejects that one rather than replaying it).
//
// It never acts on its own and accepts no message from web pages (there is no
// externally_connectable and no web_accessible_resources in the manifest).

'use strict';

const RECONNECT_ALARM = 'webhands-reconnect';
const probes = new Map(); // nonce -> resolve(frameId)
let socket;
let retryDelay = 500;

async function readConfig() {
	const response = await fetch(chrome.runtime.getURL('config.json'), {
		cache: 'no-store',
	});
	return response.json();
}

async function connect() {
	if (socket && socket.readyState <= 1) return;
	let config;
	try {
		config = await readConfig();
	} catch {
		return;
	}
	if (!config || !config.port || !config.token) return;
	if (socket && socket.readyState <= 1) return;
	const ws = new WebSocket(`ws://127.0.0.1:${config.port}/`);
	socket = ws;
	ws.onopen = () => ws.send(JSON.stringify({hello: config.token}));
	ws.onmessage = (event) => {
		retryDelay = 500;
		void onMessage(ws, event.data);
	};
	ws.onerror = () => {};
	ws.onclose = () => {
		if (socket === ws) socket = undefined;
		setTimeout(connect, retryDelay);
		retryDelay = Math.min(retryDelay * 2, 5000);
	};
}

async function onMessage(ws, data) {
	let message;
	try {
		message = JSON.parse(data);
	} catch {
		return;
	}
	if (typeof message.id !== 'number' || typeof message.op !== 'string') return;
	let reply;
	try {
		reply = {id: message.id, ok: true, result: await handle(message)};
	} catch (error) {
		reply = {
			id: message.id,
			ok: false,
			error: {message: String((error && error.message) || error)},
		};
	}
	if (ws.readyState === 1) ws.send(JSON.stringify(reply));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Send to one frame's content script, retrying while it is not injected yet. */
async function toFrame(tabId, frameId, msg, timeoutMs) {
	const deadline = Date.now() + (timeoutMs ?? 10000);
	for (;;) {
		let response;
		try {
			response = await chrome.tabs.sendMessage(tabId, msg, {frameId});
		} catch (error) {
			const text = String((error && error.message) || error);
			if (
				/Receiving end does not exist|message port closed|back\/forward cache/i.test(
					text,
				) &&
				Date.now() < deadline
			) {
				await sleep(100);
				continue;
			}
			throw new Error(`frame ${frameId}: ${text}`);
		}
		if (response === undefined && Date.now() < deadline) {
			await sleep(100);
			continue;
		}
		if (!response) throw new Error(`frame ${frameId}: no response`);
		if (!response.ok) throw new Error(response.error);
		return response.result;
	}
}

function waitForLoad(tabId, timeoutMs, startedAt) {
	return new Promise((resolve, reject) => {
		let sawLoading = false;
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`navigation did not finish within ${timeoutMs}ms`));
		}, timeoutMs);
		const listener = (id, change, tab) => {
			if (id !== tabId) return;
			if (change.status === 'loading') sawLoading = true;
			if (change.status === 'complete' && sawLoading) {
				cleanup();
				resolve({url: tab.url});
			}
		};
		// A same-document navigation (a #hash) fires no loading/complete pair, so
		// also accept a tab that is complete and already reports the new URL.
		const poll = setInterval(async () => {
			try {
				const tab = await chrome.tabs.get(tabId);
				if (
					!sawLoading &&
					tab.status === 'complete' &&
					Date.now() - startedAt > 1500
				) {
					cleanup();
					resolve({url: tab.url});
				}
			} catch (error) {
				cleanup();
				reject(error);
			}
		}, 250);
		function cleanup() {
			clearTimeout(timer);
			clearInterval(poll);
			chrome.tabs.onUpdated.removeListener(listener);
		}
		chrome.tabs.onUpdated.addListener(listener);
	});
}

function waitForNextLoad(tabId, timeoutMs) {
	return new Promise((resolve, reject) => {
		let sawLoading = false;
		const timer = setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			reject(new Error(`no navigation within ${timeoutMs}ms`));
		}, timeoutMs);
		const listener = (id, change, tab) => {
			if (id !== tabId) return;
			if (change.status === 'loading') sawLoading = true;
			if (change.status === 'complete' && sawLoading) {
				clearTimeout(timer);
				chrome.tabs.onUpdated.removeListener(listener);
				resolve({url: tab.url});
			}
		};
		chrome.tabs.onUpdated.addListener(listener);
	});
}

async function handle(m) {
	switch (m.op) {
		case 'ping':
			return 'pong';
		case 'init': {
			const windows = await chrome.windows.getAll({
				windowTypes: ['normal'],
				populate: true,
			});
			const win = windows.find((w) => w.focused) || windows[0];
			if (!win) throw new Error('the browser has no normal window');
			const tab = win.tabs.find((t) => t.active) || win.tabs[0];
			return {tabId: tab.id, windowId: win.id, url: tab.url};
		}
		case 'tab': {
			const tab = await chrome.tabs.get(m.tabId);
			return {url: tab.url, status: tab.status, windowId: tab.windowId};
		}
		case 'window': {
			const win = await chrome.windows.get(m.windowId);
			return {
				left: win.left,
				top: win.top,
				width: win.width,
				height: win.height,
				focused: win.focused,
				state: win.state,
			};
		}
		case 'goto': {
			const startedAt = Date.now();
			const done = waitForLoad(m.tabId, m.timeoutMs ?? 30000, startedAt);
			await chrome.tabs.update(m.tabId, {url: m.url, active: true});
			return done;
		}
		case 'waitNavigation':
			return waitForNextLoad(m.tabId, m.timeoutMs ?? 30000);
		case 'frame':
			return toFrame(m.tabId, m.frameId ?? 0, m.msg, m.timeoutMs);
		case 'probeFrame': {
			// Map an <iframe> element (addressed by a selector in its parent frame) to
			// its frameId: the parent posts a nonce into the iframe's window, the
			// child's content script consumes it and reports it here, and the
			// sender's frameId is the answer.
			const nonce = crypto.randomUUID();
			const reported = new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					probes.delete(nonce);
					reject(
						new Error('the frame did not answer (is its document loaded?)'),
					);
				}, m.timeoutMs ?? 5000);
				probes.set(nonce, (frameId) => {
					clearTimeout(timer);
					probes.delete(nonce);
					resolve(frameId);
				});
			});
			const box = await toFrame(
				m.tabId,
				m.frameId ?? 0,
				{
					op: 'probeFrame',
					selector: m.selector,
					nonce,
					scroll: m.scroll === true,
				},
				m.timeoutMs,
			);
			const frameId = await reported;
			return {frameId, offsetX: box.offsetX, offsetY: box.offsetY};
		}
		case 'cookies.getAll':
			return chrome.cookies.getAll({});
		case 'cookies.set': {
			for (const c of m.cookies) await chrome.cookies.set(c);
			return m.cookies.length;
		}
		case 'cookies.remove': {
			for (const c of m.cookies) await chrome.cookies.remove(c);
			return m.cookies.length;
		}
		case 'capture':
			return chrome.tabs.captureVisibleTab(m.windowId, {format: 'png'});
		default:
			throw new Error(`unknown op ${m.op}`);
	}
}

chrome.runtime.onMessage.addListener((message, sender) => {
	if (message && typeof message.frameProbe === 'string') {
		const resolve = probes.get(message.frameProbe);
		if (resolve && sender.tab) resolve(sender.frameId);
	}
	return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === RECONNECT_ALARM) void connect();
});
chrome.alarms.create(RECONNECT_ALARM, {periodInMinutes: 0.5});
chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
void connect();
