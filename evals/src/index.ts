/**
 * The agent-capability eval harness (prd `agent-capability-eval-harness`).
 *
 * This is the FOUNDATION spine: a typed eval contract, a launch seam + generic
 * shell adapter (D1), the harness-owned serve lifecycle (ADR-0005), the
 * read-verb end-state assertion + milestone scorer, the three-state
 * pass/fail/INCONCLUSIVE outcome with precheck + bounded retry, the enforced
 * no-priming guard, and the D3 scripted-trace self-test machinery. It lives
 * OUTSIDE `packages/*` so the repo gate can never reach the live-site path.
 *
 * The real-site evals (SauceDemo / stateful / Magento) and the docs are SEPARATE
 * dependent tasks that plug into this surface.
 */

export type {
	EvalEntry,
	EvalTier,
	EndStateCheck,
	Milestone,
	HealthProbe,
	EvalCleanup,
} from './eval-contract.js';
export {
	VerbClient,
	parseEnvelope,
	type WebhandsCommand,
	type VerbClientOptions,
} from './verb-client.js';
export {
	type AgentUnderTest,
	type AgentUsage,
	type LaunchInput,
	type LaunchResult,
	ShellAdapter,
	PlaywrightAdapter,
	WebhandsSkilledAdapter,
	UsageAccumulator,
	extractUsage,
	substituteModel,
	MODEL_PLACEHOLDER,
} from './agent-under-test.js';
export {
	replayTrace,
	type ScriptedTrace,
	type TraceStep,
	type ReplayOptions,
	type ReplayResult,
} from './scripted-trace.js';
export {
	assertNoPriming,
	assertSkilledReferenceUnprimed,
	buildAgentInput,
	PrimingViolationError,
	VERB_SURFACE_REFERENCE,
	WEBHANDS_SKILL_REFERENCE,
	type ProtocolPreamble,
	WEBHANDS_PREAMBLE,
	WEBHANDS_SKILLED_PREAMBLE,
	PLAYWRIGHT_PREAMBLE,
} from './no-priming.js';
export {
	startServe,
	type ServeSession,
	type ServeLaunchOptions,
	type StartServeOptions,
} from './serve-lifecycle.js';
export {runPrecheck, type HealthResult} from './precheck.js';
export {scoreEval, type ScoreResult} from './scorer.js';
export {
	evaluateOutcome,
	type Outcome,
	type OutcomeKind,
	type EvaluateOptions,
} from './outcome.js';
export {
	runEval,
	runPostPassCleanup,
	formatUsage,
	formatComparison,
	type EvalRunResult,
	type RunEvalOptions,
	type CleanupStatus,
	type ComparisonResult,
} from './run-eval.js';
export {buildSelfTestEval} from './catalogue/self-test-fixture.eval.js';
export {buildParabankTransferEval} from './catalogue/parabank-transfer.eval.js';
export {magentoCheckoutEval} from './catalogue/magento-checkout.eval.js';
export {mintNonce, nonceTransferAmount, nonceUsername} from './nonce.js';
