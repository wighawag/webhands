/**
 * The eval CONTRACT (prd `agent-capability-eval-harness`, user stories 2, 9, 17).
 *
 * An **eval** is the harness's unit: a typed `{goalPrompt, endStateAssertion,
 * milestones[]}` triple run against a real (preferably sandbox) site. One
 * FILE/ENTRY per eval (work/ contract rule 2: no shared manifest); the
 * catalogue is just the set of `*.eval.ts` modules, each default-exporting one
 * {@link EvalEntry}.
 *
 * The shape is deliberately data-only and free of any agent / browser type: an
 * entry DESCRIBES what to do and how to check it, and the harness machinery
 * (the verb client, the scorer, the precheck) interprets it. That keeps an eval
 * cheap to add (story 17) and reviewable as a flat record (story 2).
 */

import type {VerbClient} from './verb-client.js';

/**
 * Difficulty tier of a target site (prd user stories 6, 7, 8). Recorded on each
 * entry so the scoreboard is legible by difficulty; the foundation ships only a
 * `self-test` tier (the local-fixture machinery proof, never a capability pass).
 */
export type EvalTier = 'self-test' | 'tier-1' | 'tier-2' | 'tier-3';

/**
 * A single end-state check the HARNESS makes via webhands' OWN read verbs
 * (prd property 2; user story 3). It is run AFTER the agent reports done and is
 * what actually decides pass/fail; the agent's self-report only TRIGGERS it and
 * never substitutes for it.
 *
 * A check is `{describe, check}`: a human-legible label plus a predicate that is
 * handed the {@link VerbClient} and answers truthy/falsy by reading the live
 * page (`exists`/`count`/`getAttribute`/`query`/`snapshot`). The harness never
 * trusts the agent's word; it asks the page itself.
 */
export interface EndStateCheck {
	/** A human-legible description of what this check asserts (for the report). */
	readonly describe: string;
	/**
	 * Read the live page through `verbs` and return whether the asserted end
	 * state holds. MUST use only READ verbs (no acting): this is a verdict, not a
	 * step. A throw is treated as "the check could not be made" by the caller.
	 */
	check(verbs: VerbClient): Promise<boolean>;
}

/**
 * An ordered MILESTONE: a partial-credit checkpoint on the way to the goal
 * (prd user story 9). Each milestone is ITSELF a verb-checked end state, so a
 * near-miss ("reached cart but not checkout") is a useful capability signal and
 * not just a flat fail. Milestones are ordered: the scorer reports the longest
 * reached PREFIX, the natural reading of "how far did the agent get".
 */
export interface Milestone {
	/** A short stable id for this milestone (e.g. `reached-login`). */
	readonly id: string;
	/** The verb-checked end state that marks this milestone reached. */
	readonly check: EndStateCheck;
}

/**
 * A site-health PRECHECK probe (prd user story 10): a cheap reachability /
 * landmark read that decides FAIL vs INCONCLUSIVE. If the entry URL does not
 * load or an expected landmark is absent, the site is down / rate-limiting /
 * structurally changed, so a non-PASS is INCONCLUSIVE (retried), never a
 * capability fail. Run by the harness through the SAME read verbs.
 */
export interface HealthProbe {
	/** A human-legible description of the landmark this probe expects. */
	readonly describe: string;
	/** Return whether the expected landmark is present on the entry page. */
	check(verbs: VerbClient): Promise<boolean>;
}

/** A typed eval entry: the harness's unit of work (one file per eval). */
export interface EvalEntry {
	/** A short stable id (matches the file slug), e.g. `self-test-fixture`. */
	readonly id: string;
	/** The difficulty tier this eval belongs to. */
	readonly tier: EvalTier;
	/** A human-legible target name (e.g. `SauceDemo`, or `local-fixture`). */
	readonly target: string;
	/**
	 * The ONE entry URL named in the goal-prompt — the only site URL the
	 * agent-under-test may be given (the no-priming boundary, user story 4). The
	 * harness navigates the SERVE session here for the precheck and may name it
	 * in the goal; nothing BEYOND it is passed to the agent.
	 */
	readonly entryUrl: string;
	/**
	 * The high-level NATURAL-LANGUAGE goal handed to the unaided agent (user
	 * story 4). Precise enough that success is mechanically verifiable, but with
	 * NO selectors, NO step list, NO site foreknowledge beyond {@link entryUrl}.
	 * The no-priming guard ({@link ../no-priming.js}) enforces this property.
	 */
	readonly goalPrompt: string;
	/**
	 * The site-health precheck probes (user story 10). Empty ⇒ the precheck is a
	 * bare reachability check (the entry page loaded at all).
	 */
	readonly health: readonly HealthProbe[];
	/** The ordered milestones, longest-reached-prefix scored (user story 9). */
	readonly milestones: readonly Milestone[];
	/**
	 * The FINAL end-state assertion (user story 3). The eval PASSES iff every
	 * check here passes (read by the harness, not the agent). Usually the same
	 * end state as the last milestone, kept separate so the binary verdict is
	 * explicit and a milestone set can be richer than the single pass bar.
	 */
	readonly endState: readonly EndStateCheck[];
}
