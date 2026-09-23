#!/usr/bin/env node
/**
 * Run a command with an X DISPLAY available, on a machine that may not have
 * one. Used by `@webhands/core`'s test scripts.
 *
 * WHY THIS EXISTS. A large part of that suite drives a REAL browser, and some
 * of it drives a HEADED one on purpose (`setup-profile`, the headed-launch
 * case, `--real-chrome`). A headed launch needs an X server, so on any
 * display-less Linux box (a server, a container, a headless dev machine, CI)
 * `pnpm test` fails in those files with Playwright's "Looks like you launched a
 * headed browser without having a XServer running" box. That is a red suite
 * with NOTHING WRONG IN THE CODE, and the failure text names a tool the reader
 * has to know to reach for.
 *
 * CI already knew the incantation (`xvfb-run -a pnpm -r test`, see
 * .github/workflows/ci.yml) and a contributor had no way to learn it except by
 * meeting the wall first. This script moves that knowledge from the CI file,
 * where only CI benefits, into the test command itself, where everyone does.
 *
 * WHAT IT DOES, in order:
 *
 *   1. A display already exists (`DISPLAY` set, e.g. a desktop, an `ssh -X`
 *      session, or an OUTER `xvfb-run` such as the one in CI): run the command
 *      unchanged. No nesting, no second X server.
 *   2. Not Linux: run unchanged. macOS and Windows have a native window server
 *      and no Xvfb; a headed browser there is simply a window.
 *   3. Linux, no display, `xvfb-run` present: run the command under
 *      `xvfb-run -a`, which starts a throwaway X server, runs the command
 *      against it and kills it afterwards.
 *   4. Linux, no display, no `xvfb-run`: run the command anyway, after printing
 *      ONE actionable line. Not a hard failure: the headless majority of the
 *      suite is still worth running, and this way the reason is at the TOP of
 *      the output instead of buried in the first browser stack trace.
 *
 * WHY WRAPPING, rather than spawning an X server from a test hook: this makes
 * `xvfb-run` the PARENT of the whole test process, exactly as in CI, so its own
 * cleanup kills the X server when the run ends, however it ends. A display
 * spawned from inside the suite would have to be torn down by the suite, and a
 * crashed or killed run would leak an X server and its socket.
 */
import {spawn, spawnSync} from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

if (!command) {
	console.error(
		'with-display: no command given (usage: node scripts/with-display.mjs <command> [args...])',
	);
	process.exit(64); // EX_USAGE
}

/** Spawn as a transparent pass-through: inherited stdio, same exit code. */
function run(cmd, cmdArgs) {
	const child = spawn(cmd, cmdArgs, {stdio: 'inherit'});
	child.on('error', (error) => {
		console.error(`with-display: failed to run ${cmd}: ${error.message}`);
		process.exit(1);
	});
	child.on('exit', (code, signal) => {
		// A signalled child has no exit code; report the conventional 128+n so a
		// caller can still tell success from death-by-signal.
		process.exit(
			signal ? 128 + (Number(signal.replace(/^SIG/, '')) || 1) : (code ?? 1),
		);
	});
}

function hasXvfbRun() {
	// ENOENT on spawn is the only reliable "not installed" signal here; a
	// `which`/`command -v` shell-out would answer the same question with a shell
	// in between.
	return (
		spawnSync('xvfb-run', ['--help'], {stdio: 'ignore'}).error?.code !==
		'ENOENT'
	);
}

if (process.env.DISPLAY || process.platform !== 'linux') {
	run(command, args);
} else if (hasXvfbRun()) {
	run('xvfb-run', ['-a', command, ...args]);
} else {
	console.error(
		'with-display: no DISPLAY and no xvfb-run on this Linux box, so the HEADED browser tests will fail.\n' +
			'with-display: install xvfb (Debian/Ubuntu: `apt install xvfb`, Nix: `pkgs.xvfb-run`), or run the suite on a machine with a display.\n',
	);
	run(command, args);
}
