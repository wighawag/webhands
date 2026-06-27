#!/usr/bin/env node
// Publish hygiene: copy the monorepo's root README.md + LICENSE into a package
// so the published tarball carries them. The copies are generated artifacts
// (gitignored in each package), NOT source. Wired into each package's `prepack`
// so it runs automatically on `npm pack` / `npm publish` / `pnpm publish`.
//
// Safety: every write stays inside the repo. The destination must resolve to a
// path under the repo root, and the assets must already exist at the repo root;
// otherwise we fail loud rather than touch some shared/global location.

import {copyFileSync, existsSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Assets copied into each package, relative to the repo root.
export const PUBLISH_ASSETS = ['README.md', 'LICENSE'];

// The repo root is the parent of the `scripts/` directory holding this file.
export function repoRoot() {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

function isInside(parent, child) {
	const rel = relative(parent, child);
	return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`));
}

// Copy the publish assets from `root` into `packageDir`. Returns the list of
// destination paths written. Throws (without writing) if a source asset is
// missing or the destination would fall outside the repo root.
export function copyPublishAssets({
	packageDir = process.cwd(),
	root = repoRoot(),
	assets = PUBLISH_ASSETS,
} = {}) {
	const absRoot = resolve(root);
	const absPackageDir = resolve(packageDir);

	if (!isInside(absRoot, absPackageDir)) {
		throw new Error(
			`copy-publish-assets: refusing to write outside the repo. ` +
				`packageDir ${absPackageDir} is not inside repo root ${absRoot}.`,
		);
	}

	// Validate every source up front so we never half-copy.
	for (const asset of assets) {
		const src = join(absRoot, asset);
		if (!existsSync(src)) {
			throw new Error(`copy-publish-assets: source asset not found: ${src}`);
		}
	}

	const written = [];
	for (const asset of assets) {
		const src = join(absRoot, asset);
		const dest = join(absPackageDir, asset);
		if (!isInside(absRoot, resolve(dest))) {
			throw new Error(
				`copy-publish-assets: refusing to write outside the repo: ${dest}`,
			);
		}
		copyFileSync(src, dest);
		written.push(dest);
	}
	return written;
}

// Run directly (e.g. from a package's `prepack`): cwd is the package dir.
const invokedDirectly =
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const written = copyPublishAssets();
	for (const dest of written) {
		console.log(`copy-publish-assets: wrote ${relative(repoRoot(), dest)}`);
	}
}
