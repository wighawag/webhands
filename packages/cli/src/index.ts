import type {Driver} from '@my-browser-controller/core';

/**
 * The `incur`-based CLI wrapper around `core` (the `my-browser-controller` /
 * `incur` binary) is wired up in a later task ("cli-incur-wiring-and-errors").
 *
 * This package exists now only to anchor the workspace boundary between the
 * transport-neutral `core` seam and the `cli` wrapper, and to prove the
 * `cli` -> `core` dependency wiring builds end to end. It re-exports the
 * `Driver` seam type so the wrapper task has the boundary in place.
 */
export type {Driver};
