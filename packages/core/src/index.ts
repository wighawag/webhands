export type {
	ActionOptions,
	BoundingBox,
	Cookie,
	Driver,
	EvalOptions,
	LocatorString,
	MouseAction,
	MouseButton,
	MouseInput,
	OpenTarget,
	PwExtra,
	QueryOptions,
	QueryRow,
	Screenshot,
	ScreenshotOptions,
	ScreenshotScope,
	ScriptOptions,
	ScrollTarget,
	SelectChoice,
	WebHandsPage,
	Session,
	Snapshot,
	SnapshotOptions,
	SnapshotView,
	Transport,
	WaitCondition,
} from './seam.js';
export {locator, validateSnapshotOptions} from './seam.js';

export {
	substituteEnvPlaceholders,
	hasEnvPlaceholder,
} from './env-substitution.js';

export {loadWebhandsEnv, type LoadWebhandsEnvOptions} from './env-loading.js';

export {
	serializeCookies,
	deserializeCookies,
	COOKIES_EXPORT_VERSION,
	type CookiesExport,
} from './cookies-export.js';

export {StubTransport, type StubCall} from './stub-transport.js';

export type {Hand, HandContext, HandContribution} from './hand-host.js';

export {
	readHandsConfig,
	normalizeConfig,
	loadHands,
	HandLoadError,
	HANDS_CONFIG_FILENAME,
	type HandEntry,
	type HandsConfig,
	type LoadedHand,
	type LoadHandsOptions,
} from './hand-loading.js';

export {
	PlaywrightLaunchTransport,
	type PlaywrightLaunchTransportOptions,
	type StealthChromiumImporter,
} from './playwright-launch-transport.js';

export {
	parseSocksProxy,
	hostResolverRulesArg,
	type ParsedSocksProxy,
} from './socks-proxy.js';

export {PlaywrightAttachTransport} from './playwright-attach-transport.js';

export {
	setupProfile,
	buildPrompt,
	type PromptSink,
	type SetupProfileOptions,
	type SetupProfileResult,
} from './setup-profile.js';

export {
	ControllerError,
	MissingBrowserBinaryError,
	MissingStealthDependencyError,
	InvalidProxyError,
	MissingProfileError,
	AttachNotChromiumError,
	AttachNoContextError,
	NoLiveServerError,
	SessionAlreadyActiveError,
	CrossOriginFrameError,
	ScreenshotPathError,
	StaleRefError,
	UnresolvedEnvPlaceholderError,
	isControllerError,
	type ControllerErrorCode,
} from './errors.js';

export {
	resolveSessionEndpointPath,
	writeSessionEndpoint,
	readSessionEndpoint,
	clearSessionEndpoint,
	SESSION_ENDPOINT_FILENAME,
	type SessionEndpoint,
} from './session-endpoint.js';

export {
	startSessionServer,
	sessionAlreadyActive,
	type SessionServerOptions,
	type RunningSessionServer,
} from './session-server.js';

export {
	createVerbTrace,
	verbNameOf,
	type VerbTrace,
	type MutableVerbTrace,
	type VerbTraceEntry,
} from './verb-trace.js';

export {connectRemoteSession, readSessionTrace} from './remote-session.js';

export {
	distillTrace,
	sliceTrace,
	DEFAULT_HAND_VERB,
	type DistillOptions,
	type DistillResult,
} from './distill.js';

export {
	SESSION_RPC_PATH,
	SESSION_TRACE_PATH,
	applySessionRpc,
	makeRpcPage,
	callHandVerb,
	type SessionRpcRequest,
	type SessionRpcBuiltInRequest,
	type SessionRpcHandRequest,
	type SessionRpcResponse,
} from './session-rpc.js';

export {
	resolveHomeRoot,
	resolveProfileLocation,
	resolveScreenshotsDir,
	CONTROLLER_HOME_ENV,
	DEFAULT_HOME_DIRNAME,
	PROFILES_DIRNAME,
	SCREENSHOTS_DIRNAME,
	type ProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';

export {
	startFixtureServer,
	type FixtureServer,
} from './test-fixtures/fixture-server.js';
export {FIXTURE_PAGES} from './test-fixtures/fixture-pages.js';
