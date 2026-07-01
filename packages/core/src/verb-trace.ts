import type {SessionRpcRequest} from './session-rpc.js';

/**
 * The per-session VERB TRACE (task `serve-session-verb-trace`; prd
 * `distill-session-into-hand`, covers story 2 and the "Verb trace lives in
 * `serve`" implementation decision).
 *
 * As verbs drive the ONE live page a `serve` session owns (ADR-0005), the
 * controller accumulates an ORDERED, in-memory record of what actually ran:
 * each entry carries the verb name, the locator/args AS THE AGENT PASSED THEM,
 * and enough of the result's shape to reconstruct the step later. This trace is
 * the portable, ground-truth BACKBONE the later `distill` verb crystallizes into
 * a hand scaffold, so it must be faithful to what drove the page, not a
 * reconstruction.
 *
 * NO LITERAL SECRETS (the load-bearing guarantee, prd resolved decision #1). An
 * entry records the {@link SessionRpcRequest} EXACTLY as it arrived over the
 * wire, BEFORE any `{ENV:NAME}` substitution. `{ENV:NAME}` resolution happens
 * later and IN-PROCESS, inside the `type` verb body (`hand-host.ts`), against
 * the served process's `process.env` — so by the time a verb runs, the request
 * this trace already recorded still holds the TOKEN `{ENV:PASSWORD}`, never the
 * resolved secret. This task therefore does NOT re-introduce the literal: it
 * records the value as passed, and the substitution seam upstream keeps the
 * secret out of the record for free (see `env-substitution.ts`). Non-credential
 * typed values (search terms, addresses, amounts) and returned page content are
 * recorded AS-IS — they are unavoidable and already agent-readable by
 * definition, and this task adds no redaction pass over them.
 *
 * IN-MEMORY + PER-SESSION (the default, prd resolved decision #2). The trace
 * lives with the running session and is read from the same session by `distill`
 * (an in-process accessor, {@link VerbTrace.entries}). Persisting it to the
 * profile dir (surviving `stop`) is an ADDITIVE, later opt-in and is NOT built
 * here. The shape is designed so persistence can be added WITHOUT reshaping it:
 * every field is plain, serializable JSON (a verb string, the request that
 * already crosses the RPC as JSON, and the serializable result the RPC already
 * carries back), so a future writer can dump {@link VerbTrace.entries} straight
 * to disk. Nothing here writes to disk.
 */

/**
 * One recorded verb in the session's trace: the ordered, faithful record of a
 * single step that drove the page.
 *
 * - `verb` — the verb's NAME. For a built-in it is the request's `verb`
 *   discriminant (`goto`/`navigate`, `click`, `type`, `script`, ...); for a
 *   dynamically-loaded hand verb (the generic `{verb: 'hand', name, args}`
 *   request) it is the hand-contributed verb's own `name`, so the trace names
 *   the verb the agent actually called, not the wire envelope.
 * - `request` — the WHOLE {@link SessionRpcRequest} as it arrived, so the
 *   locator/args are captured exactly as the agent passed them (a `type` value
 *   stays the `{ENV:NAME}` token; a locator stays the raw string). Keeping the
 *   whole request (rather than re-extracting per-verb positional args) makes the
 *   record faithful with no per-verb drift and future-proof to new verbs.
 * - `result` — the verb's RETURN VALUE, exactly as it crossed the RPC back to
 *   the client (a `snapshot`'s `{url, view, content}`, a `count`'s number, a
 *   `script`'s serializable return; `undefined` for the void act verbs). This is
 *   "enough result shape to reconstruct the step": it is the same serializable
 *   value the seam already guarantees is transferable (ADR-0003), so it is safe
 *   to keep and, later, to persist.
 * - `at` — the wall-clock time (ms since the epoch) the step was recorded, so a
 *   later reader can order/annotate steps and a persisted trace carries when it
 *   happened. Ordering itself is by array position; `at` is supplementary.
 */
export interface VerbTraceEntry {
	readonly verb: string;
	readonly request: SessionRpcRequest;
	readonly result: unknown;
	readonly at: number;
}

/**
 * The accessor a reader (the future `distill` verb) uses to read the session's
 * trace in-process. Deliberately small: append happens through
 * {@link MutableVerbTrace.record} (owned by the RPC dispatch), and a reader only
 * ever READS the ordered entries.
 */
export interface VerbTrace {
	/**
	 * The recorded steps, in the order they drove the page. Returns a SHALLOW
	 * COPY so a reader cannot mutate the live trace (the entries themselves are
	 * `readonly`). Empty before any verb has run.
	 */
	entries(): readonly VerbTraceEntry[];
}

/**
 * The append side of a {@link VerbTrace}: what the RPC dispatch holds to record
 * each verb as it runs. Separated from the read-only {@link VerbTrace} so the
 * accessor handed to a reader (`distill`) exposes reads only, while the server
 * that owns the session holds the recorder.
 */
export interface MutableVerbTrace extends VerbTrace {
	/**
	 * Append one step to the trace. Called by {@link applySessionRpc} AFTER the
	 * verb returns, with the request AS IT ARRIVED (so `{ENV:NAME}` stays a token)
	 * and the verb's serializable result. `verb` overrides the recorded name for
	 * the generic hand-verb envelope (whose request `verb` is the literal
	 * `'hand'`), so the trace names the contributed verb, not the envelope.
	 */
	record(request: SessionRpcRequest, result: unknown, verb?: string): void;
}

/**
 * Create a fresh, empty in-memory verb trace for one session. The `serve`
 * session server mints one of these per session and passes it to
 * {@link applySessionRpc}; the read-only {@link VerbTrace} view is what a reader
 * (`distill`) is later handed. Nothing here touches disk.
 */
export function createVerbTrace(
	now: () => number = Date.now,
): MutableVerbTrace {
	const entries: VerbTraceEntry[] = [];
	return {
		record(request, result, verb): void {
			entries.push({
				verb: verb ?? verbNameOf(request),
				request,
				result,
				at: now(),
			});
		},
		entries(): readonly VerbTraceEntry[] {
			// Shallow copy so a reader iterating the trace cannot append/splice the
			// live array. The entries are structurally `readonly`.
			return entries.slice();
		},
	};
}

/**
 * The verb NAME to record for a request: the hand-contributed verb's own `name`
 * for the generic hand envelope, else the request's `verb` discriminant. Kept
 * here (not inline) so the naming rule is one place and testable.
 */
export function verbNameOf(request: SessionRpcRequest): string {
	return request.verb === 'hand' ? request.name : request.verb;
}
