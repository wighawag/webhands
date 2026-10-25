import {createHash} from 'node:crypto';
import {chmod, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {
	resolveHomeRoot,
	type ProfileLocationOptions,
} from './profile-location.js';

/**
 * The files of the webhands bridge extension (ADR-0018), and where they live.
 *
 * ONE STABLE DIRECTORY per webhands home, `<home>/extension/`. Stable because a
 * branded Chrome can only load it by a human "Load unpacked" of a PATH (finding
 * `branded-chrome-extension-install-paths`), and Chrome reads an unpacked
 * extension's files from that path at each start: so `serve` rewrites the
 * contents (code and a fresh `config.json`) before every launch and the one-time
 * install keeps working.
 *
 * The extension id is pinned by the public `key` in the manifest. That makes the
 * id independent of the directory path, which is what lets the bridge accept only
 * `Origin: chrome-extension://<id>`. Only the PUBLIC key is here: an unpacked
 * extension needs no private key, and none exists in this repository.
 */

/** Directory name of the extension under the webhands home. */
export const EXTENSION_DIRNAME = 'extension';

/** The manifest `key` (public, SPKI DER, base64) that pins {@link EXTENSION_ID}. */
export const EXTENSION_PUBLIC_KEY =
	'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0qt1QssGj9duS4cbmHkxZvIxw7d3tcEkz2pGK1YUnW4icgTVdHhTXUO6HljKNfcM6AqLMx7raYClEalCIgnCdYE0R+56UU5g+ArEgcPnqX21wa0kuCuwVd0LPOwtFY+vR+d3H+oRT7S+1Mv5SJHDCvGqwg6EH6ABM+BJCgHtTMvZeC9D/UgdEAihJ3PoZrcuMfGxnybvUfdg7XKVnZ+NT0ZP3CKQK8wU5KwnNHBvnIWwyETZ2ncNkjjiFEXnHqQSeKmEDIDg8cqiKZ/dfkc/pJh3jNlY4CpeWWsfXDPDsAXwSdyeu+LuuJDMkhCu42sZglQbIHCztKDLfmVQ6C7i0wIDAQAB';

/** The extension id Chrome derives from {@link EXTENSION_PUBLIC_KEY}. */
export const EXTENSION_ID = 'ioibflhppapnjicjagljmbejpjeahajb';

/** Where the static worker and content script sources ship (`packages/core/extension`). */
const ASSETS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'extension',
);

/** The script file names a manifest refers to (content-hashed, see {@link writeExtension}). */
export interface ExtensionScripts {
	readonly worker: string;
	readonly injected: string;
	readonly content: string;
}

/** The manifest. Permissions are the minimum the slice's verbs need (ADR-0018). */
export function extensionManifest(
	version: string,
	scripts: ExtensionScripts = {
		worker: 'sw.js',
		injected: 'injected.js',
		content: 'cs.js',
	},
): Record<string, unknown> {
	return {
		manifest_version: 3,
		name: 'webhands bridge',
		version,
		description:
			'Lets the local webhands controller drive this dedicated profile without a debugging port. Obeys only the loopback controller holding this session\u2019s token.',
		key: EXTENSION_PUBLIC_KEY,
		minimum_chrome_version: '116',
		background: {service_worker: scripts.worker},
		permissions: ['cookies', 'alarms'],
		host_permissions: ['<all_urls>'],
		content_scripts: [
			{
				matches: ['<all_urls>'],
				js: [scripts.injected, scripts.content],
				all_frames: true,
				match_about_blank: true,
				match_origin_as_fallback: true,
				run_at: 'document_start',
			},
		],
	};
}

/**
 * Env var naming the extension directory explicitly. A branded-Chrome profile
 * records the ABSOLUTE path it was "Load unpacked" from, so a profile used under
 * another webhands home (a copy in the eval harness's isolated home, say) must
 * keep pointing webhands at that original directory, or the extension Chrome
 * loads would read a stale `config.json` and never connect.
 */
export const EXTENSION_DIR_ENV = 'WEBHANDS_EXTENSION_DIR';

/** Resolve the extension directory: {@link EXTENSION_DIR_ENV}, else `<home>/extension`. */
export function resolveExtensionDir(
	options: ProfileLocationOptions = {},
): string {
	const override = (options.env ?? process.env)[EXTENSION_DIR_ENV];
	if (override !== undefined && override.trim() !== '') return override;
	return join(resolveHomeRoot(options), EXTENSION_DIRNAME);
}

/** The bridge address the worker reads on each (re)connect. */
export interface ExtensionConfig {
	readonly port: number;
	readonly token: string;
}

let cachedInjected: string | undefined;

/**
 * Playwright's `InjectedScript` source, extracted from the pinned
 * `playwright-core` bundle and wrapped to publish the class on the content
 * script's (isolated-world) global.
 *
 * It is the exact string Playwright itself evaluates in its utility world
 * (`generated/injectedScriptSource.ts`). We read it out of the bundle rather than
 * vendoring a copy, so it can never drift from the Playwright version the rest of
 * webhands pins. The marker is checked LOUDLY: a Playwright bump that moves it
 * fails here with a clear message instead of shipping a broken extension.
 */
export async function injectedScriptSource(): Promise<string> {
	if (cachedInjected !== undefined) return cachedInjected;
	const require = createRequire(import.meta.url);
	const playwrightDir = dirname(require.resolve('playwright/package.json'));
	const fromPlaywright = createRequire(join(playwrightDir, 'package.json'));
	const bundlePath = fromPlaywright.resolve('playwright-core/lib/coreBundle');
	const bundle = await readFile(bundlePath, 'utf8');
	const marker =
		'"packages/playwright-core/src/generated/injectedScriptSource.ts"() {';
	const at = bundle.indexOf(marker);
	const assign = at < 0 ? -1 : bundle.indexOf("= '", at);
	if (at < 0 || assign < 0 || assign - at > 200) {
		throw new Error(
			`could not find Playwright's injected script in ${bundlePath}: the ` +
				`extension transport reads it from the pinned playwright-core, and this ` +
				`build's layout differs. Pin playwright back to the version webhands ` +
				`was built against, or update injectedScriptSource().`,
		);
	}
	const start = assign + 2;
	let end = start + 1;
	while (end < bundle.length && bundle[end] !== "'") {
		if (bundle[end] === '\\') end++;
		end++;
	}
	const source = vm.runInNewContext(bundle.slice(start, end + 1)) as unknown;
	if (typeof source !== 'string' || !source.includes('InjectedScript')) {
		throw new Error(
			`the injected script read from ${bundlePath} is not usable`,
		);
	}
	cachedInjected =
		'(() => {\n"use strict";\nif (globalThis.__webhandsInjectedScript) return;\n' +
		`const module = {};\n${source}\n` +
		'globalThis.__webhandsInjectedScript = module.exports.InjectedScript();\n})();\n';
	return cachedInjected;
}

/**
 * Write (or refresh) the extension into `dir`: code, manifest and `config.json`.
 *
 * The directory is 0700 and `config.json` 0600: the token in it is the bridge's
 * credential, readable only by the user who runs `serve` (and by the extension,
 * through its own origin; no `web_accessible_resources` exposes it to pages).
 * Pass no `config` to write an inert one (no port, no token), e.g. for
 * `setup-profile`, where the extension is installed but nothing is serving.
 */
export async function writeExtension(
	dir: string,
	config?: ExtensionConfig,
): Promise<void> {
	await mkdir(dir, {recursive: true, mode: 0o700});
	await chmod(dir, 0o700);
	const sources = {
		worker: await readFile(join(ASSETS_DIR, 'sw.js'), 'utf8'),
		injected: await injectedScriptSource(),
		content: await readFile(join(ASSETS_DIR, 'cs.js'), 'utf8'),
	};
	// CONTENT-HASHED names and version. Chrome keeps an extension's service worker
	// in its own script cache and kept running a STALE worker after the files on
	// disk changed (measured on Chrome 156 with an unpacked install), so a code
	// change must change the script URL. The version moves with it, so the
	// extensions page shows which build is installed.
	const hash = createHash('sha256')
		.update(sources.worker)
		.update('\0')
		.update(sources.injected)
		.update('\0')
		.update(sources.content)
		.digest('hex');
	const tag = hash.slice(0, 10);
	const scripts: ExtensionScripts = {
		worker: `sw.${tag}.js`,
		injected: `injected.${tag}.js`,
		content: `cs.${tag}.js`,
	};
	const version = `0.1.${parseInt(hash.slice(0, 4), 16)}`;
	for (const entry of await readdir(dir)) {
		if (/^(sw|cs|injected|cs0)(\.[0-9a-f]+)?\.js$/.test(entry)) {
			await rm(join(dir, entry), {force: true});
		}
	}
	await writeFile(join(dir, scripts.worker), sources.worker);
	await writeFile(join(dir, scripts.injected), sources.injected);
	await writeFile(join(dir, scripts.content), sources.content);
	await writeFile(
		join(dir, 'manifest.json'),
		JSON.stringify(extensionManifest(version, scripts), null, '\t') + '\n',
	);
	const configPath = join(dir, 'config.json');
	await writeFile(configPath, JSON.stringify(config ?? {port: 0, token: ''}), {
		mode: 0o600,
	});
	await chmod(configPath, 0o600);
}
