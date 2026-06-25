#!/usr/bin/env node
import {createCli} from './cli.js';

/**
 * The executable entry for the `my-browser-controller` binary. It builds the
 * `incur` CLI (with its default, real-browser session provider) and serves it:
 * `serve()` parses argv, runs the matched command, writes the structured output
 * envelope, and handles `--mcp` / `--llms` / `mcp add` / `skills add` for free.
 *
 * Kept separate from the builder (`cli.ts`) so tests drive the builder with an
 * injected provider via `serve(argv, {stdout, exit})` without spawning a real
 * browser, and only THIS file performs the real `.serve()`.
 */
void createCli().serve();
