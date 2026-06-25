import pkg from '../package.json' with {type: 'json'};

/**
 * The CLI version, read from this package's `package.json` at build time via a
 * JSON import attribute (`with { type: 'json' }`). Bundled into the emit, so
 * there is no runtime filesystem read; publish-safe because `dist/version.js`
 * resolves `../package.json` to the package root, which npm always ships.
 *
 * Passed into `Cli.create(..., { version })` so `--version`, the help header,
 * and the MCP server version all report the real package version.
 */
export const VERSION: string = pkg.version;
