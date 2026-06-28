import type {Driver} from '@webhands/core';

/**
 * The `incur`-based CLI wrapper around `core` (the `webhands`
 * binary). It binds ONE `incur` command per verb (`goto`, `snapshot`, `click`,
 * `type`, `eval`, `wait`, `cookies`) plus `setup-profile`/`launch`/`attach`,
 * each with a zod `args`/`options`/`output` schema, returns the structured
 * TOON/JSON envelope with `cta` next-verb hints, and maps `core`'s typed
 * missing-binary / missing-profile errors to an actionable fix command.
 *
 * Because it is built on `incur`, the same binary is ALSO an MCP server
 * (`--mcp` / `mcp add`) and emits a skills / `--llms` manifest with no bespoke
 * MCP code. The executable entry (`bin.ts`) calls `.serve()`; this module
 * exports the builder + its types so a test (or a host) can drive the CLI
 * programmatically (`createCli().serve(argv, {stdout, exit})` / `cli.fetch`).
 */

export {
	createCli,
	CLI_NAME,
	DEFAULT_PROFILE,
	type CliDeps,
	type LaunchPolicy,
	type ServeSession,
} from './cli.js';

export {
	createDefaultSessionProvider,
	type SessionProvider,
	type DefaultSessionProviderOptions,
} from './session-provider.js';

export {mapControllerError, fixCommandFor, type MappedError} from './errors.js';

// Re-export the `core` `Driver` seam type so the boundary stays visible from
// the cli package (it was anchored here by the scaffold).
export type {Driver};
