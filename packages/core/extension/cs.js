// webhands bridge: the content script, injected into EVERY frame (ADR-0018).
//
// It runs in the extension's ISOLATED world, after injected.js (Playwright's own
// InjectedScript, extracted from the pinned playwright-core), so element
// resolution is Playwright's engine in the same kind of isolated world Playwright
// itself uses (its "utility world"). The page cannot see this script, its
// globals or its listeners.
//
// It performs no input. It resolves selectors, reports boxes and state, and
// records the TRUSTED mousemove the controller's OS-level input produces, which
// is how the controller verifies that its pointer landed where it meant to. Its
// only in-page event dispatching is the opt-in `--dom` escape, which is
// documented as untrusted.

(() => {
	'use strict';
	if (globalThis.__webhandsContentScript) return;
	globalThis.__webhandsContentScript = true;

	const InjectedScript = globalThis.__webhandsInjectedScript;
	let injected;
	function engine() {
		if (!injected) {
			injected = new InjectedScript(globalThis, {
				isUnderTest: false,
				sdkLanguage: 'javascript',
				testIdAttributeName: 'data-testid',
				stableRafCount: 1,
				browserName: 'chromium',
				shouldPrependErrorPrefix: false,
				isUtilityWorld: true,
				customEngines: [],
			});
		}
		return injected;
	}

	function resolveAll(selector) {
		const e = engine();
		return e.querySelectorAll(e.parseSelector(selector), document);
	}

	// The last TRUSTED pointer move into this frame. `seq` lets the controller
	// tell "the pointer arrived" from "an older move".
	let move = {seq: 0};
	addEventListener(
		'mousemove',
		(event) => {
			if (!event.isTrusted) return;
			move = {
				seq: move.seq + 1,
				clientX: event.clientX,
				clientY: event.clientY,
				screenX: event.screenX,
				screenY: event.screenY,
			};
		},
		{capture: true, passive: true},
	);

	// The frame-id probe (see sw.js `probeFrame`). Registered at document_start,
	// before any page script, and stopped here, so page listeners never see it.
	addEventListener(
		'message',
		(event) => {
			const data = event.data;
			if (
				data &&
				typeof data === 'object' &&
				typeof data.__webhandsFrameProbe === 'string' &&
				event.source === parent
			) {
				event.stopImmediatePropagation();
				chrome.runtime.sendMessage({frameProbe: data.__webhandsFrameProbe});
			}
		},
		true,
	);

	const rafs = (n) =>
		new Promise((resolve) => {
			const step = (left) =>
				left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
			step(n);
		});

	function rectOf(el) {
		const r = el.getBoundingClientRect();
		return {x: r.x, y: r.y, width: r.width, height: r.height};
	}

	function inViewport(r) {
		return (
			r.x >= 0 &&
			r.y >= 0 &&
			r.x + r.width <= innerWidth &&
			r.y + r.height <= innerHeight
		);
	}

	function geometry() {
		return {
			screenX,
			screenY,
			outerWidth,
			outerHeight,
			innerWidth,
			innerHeight,
			dpr: devicePixelRatio,
			move,
		};
	}

	function strictOne(selector, strict) {
		const els = resolveAll(selector);
		if (els.length === 0) return {retry: 'no element matches yet'};
		if (els.length > 1 && strict) {
			return {
				error: `strict mode violation: ${selector} resolved to ${els.length} elements`,
			};
		}
		return {el: els[0]};
	}

	async function actionTarget(m) {
		const found = strictOne(m.selector, m.strict !== false);
		if (found.retry) return {status: 'retry', reason: found.retry};
		if (found.error) return {status: 'error', message: found.error};
		const el = found.el;
		const e = engine();
		if (!e.elementState(el, 'visible').matches) {
			return {status: 'retry', reason: 'element is not visible'};
		}
		if (m.state === 'editable') {
			const s = e.elementState(el, 'editable');
			if (!s.matches)
				return {status: 'retry', reason: `element is ${s.received}`};
		} else if (m.state !== 'visible') {
			if (!e.elementState(el, 'enabled').matches) {
				return {status: 'retry', reason: 'element is disabled'};
			}
		}
		if (!inViewport(rectOf(el))) {
			el.scrollIntoView({
				block: 'center',
				inline: 'center',
				behavior: 'instant',
			});
		}
		const before = rectOf(el);
		await rafs(2);
		const box = rectOf(el);
		if (
			before.x !== box.x ||
			before.y !== box.y ||
			before.width !== box.width ||
			before.height !== box.height
		) {
			return {status: 'retry', reason: 'element is not stable (still moving)'};
		}
		if (box.width === 0 || box.height === 0) {
			return {status: 'retry', reason: 'element has an empty box'};
		}
		const left = Math.max(box.x, 0);
		const top = Math.max(box.y, 0);
		const right = Math.min(box.x + box.width, innerWidth);
		const bottom = Math.min(box.y + box.height, innerHeight);
		if (right <= left || bottom <= top) {
			return {status: 'retry', reason: 'element is outside the viewport'};
		}
		const point = {x: (left + right) / 2, y: (top + bottom) / 2};
		const hit = e.expectHitTarget(point, el);
		if (hit !== 'done') {
			return {
				status: 'retry',
				reason: `${(hit && hit.hitTargetDescription) || 'another element'} would receive the click`,
			};
		}
		return {status: 'ok', point, box, geometry: geometry()};
	}

	function readRow(el, m) {
		const row = {};
		if (m.attrs && m.attrs.length > 0) {
			row.attrs = {};
			for (const name of m.attrs) row.attrs[name] = el.getAttribute(name);
		}
		if (m.props && m.props.length > 0) {
			row.props = {};
			for (const name of m.props) {
				row.props[name] = cloneValue(el[name]);
			}
		}
		if (m.pw && m.pw.length > 0) {
			row.pw = {};
			if (m.pw.includes('visible')) {
				row.pw.visible = engine().elementState(el, 'visible').matches;
			}
			if (m.pw.includes('bbox')) {
				const r = rectOf(el);
				row.pw.bbox =
					r.width === 0 && r.height === 0 && !el.isConnected ? null : r;
			}
		}
		return row;
	}

	// Extension messaging is JSON, so values cross as JSON: primitives and plain
	// data faithfully, a live host object (a node, a window) as a preview string
	// (the same stand-in the Playwright transports return for one).
	function cloneValue(value) {
		if (value === null || value === undefined) return value;
		if (['string', 'number', 'boolean'].includes(typeof value)) return value;
		if (typeof value === 'function' || typeof value === 'symbol')
			return undefined;
		if (value instanceof Node || value === window) return String(value);
		try {
			return JSON.parse(JSON.stringify(value));
		} catch {
			return String(value);
		}
	}

	function calibrationPoint() {
		// A point whose hit element is in THIS document (not an iframe), so a
		// trusted move there is reported by this content script.
		for (let fy = 0.1; fy < 1; fy += 0.2) {
			for (let fx = 0.1; fx < 1; fx += 0.2) {
				const x = Math.round(innerWidth * fx);
				const y = Math.round(innerHeight * fy);
				const hit = document.elementFromPoint(x, y);
				if (!hit || !/^(IFRAME|FRAME|EMBED|OBJECT)$/.test(hit.tagName)) {
					return {x, y};
				}
			}
		}
		return {x: 2, y: 2};
	}

	function setNativeValue(el, text) {
		const proto = Object.getPrototypeOf(el);
		const desc = Object.getOwnPropertyDescriptor(proto, 'value');
		if (desc && desc.set) desc.set.call(el, text);
		else el.value = text;
	}

	async function handle(m) {
		switch (m.op) {
			case 'ready':
				return {url: location.href, readyState: document.readyState};
			case 'webdriver':
				return navigator.webdriver;
			case 'geometry':
				return geometry();
			case 'lastMove':
				return move;
			case 'calibrationPoint':
				return calibrationPoint();
			case 'isVisibleNow': {
				// What Playwright's strict waitFor() reads: how many match, and whether
				// the (single) match is visible. A read: nothing is scrolled.
				const els = resolveAll(m.selector);
				return {
					count: els.length,
					visible:
						els.length === 1 &&
						engine().elementState(els[0], 'visible').matches,
				};
			}
			case 'count':
				return resolveAll(m.selector).length;
			case 'query': {
				const els = resolveAll(m.selector);
				const limited =
					typeof m.limit === 'number' ? els.slice(0, m.limit) : els;
				return limited.map((el) => readRow(el, m));
			}
			case 'snapshot':
				if (m.full) return document.documentElement.outerHTML;
				return engine().ariaSnapshot(
					document.body || document.documentElement,
					{
						mode: 'ai',
					},
				);
			case 'probeFrame': {
				const found = strictOne(m.selector, true);
				if (found.retry) throw new Error(`no frame matches ${m.selector}`);
				if (found.error) throw new Error(found.error);
				const el = found.el;
				if (!/^(IFRAME|FRAME)$/.test(el.tagName)) {
					throw new Error(
						`${m.selector} is a <${el.tagName.toLowerCase()}>, not a frame`,
					);
				}
				if (m.scroll && !inViewport(rectOf(el))) {
					el.scrollIntoView({
						block: 'center',
						inline: 'center',
						behavior: 'instant',
					});
					await rafs(2);
				}
				const r = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				const offset = {
					offsetX:
						r.left + el.clientLeft + parseFloat(style.paddingLeft || '0'),
					offsetY: r.top + el.clientTop + parseFloat(style.paddingTop || '0'),
				};
				if (!el.contentWindow)
					throw new Error(`${m.selector} has no content window`);
				el.contentWindow.postMessage({__webhandsFrameProbe: m.nonce}, '*');
				return offset;
			}
			case 'actionTarget':
				return actionTarget(m);
			case 'isFocused': {
				const found = strictOne(m.selector, false);
				if (!found.el) return false;
				const active = document.activeElement;
				return active === found.el || found.el.contains(active);
			}
			case 'dispatchClick': {
				const found = strictOne(m.selector, true);
				if (found.retry) throw new Error(`no element matches ${m.selector}`);
				if (found.error) throw new Error(found.error);
				found.el.dispatchEvent(
					new MouseEvent('click', {
						bubbles: true,
						cancelable: true,
						composed: true,
						view: window,
					}),
				);
				return true;
			}
			case 'domType': {
				const found = strictOne(m.selector, true);
				if (found.retry) throw new Error(`no element matches ${m.selector}`);
				if (found.error) throw new Error(found.error);
				setNativeValue(found.el, m.text);
				found.el.dispatchEvent(
					new Event('input', {bubbles: true, composed: true}),
				);
				found.el.dispatchEvent(new Event('change', {bubbles: true}));
				return true;
			}
			default:
				throw new Error(`unknown content-script op ${m.op}`);
		}
	}

	// Wake the worker on every top-level page load: an MV3 worker only runs when
	// an event reaches it, and this message is the one that always does (it is how
	// the worker first connects after the browser starts on the bridge's page).
	if (window === top) {
		chrome.runtime.sendMessage({wake: true}).catch(() => {});
	}

	chrome.runtime.onMessage.addListener((message, sender, reply) => {
		if (
			sender.id !== chrome.runtime.id ||
			!message ||
			typeof message.op !== 'string'
		) {
			return false;
		}
		Promise.resolve()
			.then(() => handle(message))
			.then(
				(result) => reply({ok: true, result}),
				(error) =>
					reply({ok: false, error: String((error && error.message) || error)}),
			);
		return true;
	});
})();
